import { readFileSync } from "node:fs";

const checkoutSha = "de0fac2e4500dabe0009e67214ff5f5447ce83dd";
const setupNodeSha = "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e";
const workflowPath = process.argv[2] ?? ".github/workflows/dependency-audit.yml";

function splitComment(line) {
  let quote;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && line[index + 1] === "'") {
          index += 1;
        } else if (quote === '"' && line[index - 1] === "\\") {
          continue;
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return { source: line.slice(0, index).trimEnd(), comment: line.slice(index + 1).trim() };
    }
  }

  if (quote) throw new Error("Unclosed quoted scalar");
  return { source: line.trimEnd(), comment: "" };
}

function tokenize(text) {
  const tokens = [];

  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    if (rawLine.includes("\t")) throw new Error(`Tabs are not allowed on line ${index + 1}`);
    const { source, comment } = splitComment(rawLine);
    if (!source.trim()) continue;

    const indent = source.length - source.trimStart().length;
    if (indent % 2 !== 0) throw new Error(`Unexpected indentation on line ${index + 1}`);
    tokens.push({ content: source.trim(), indent, comment, line: index + 1 });
  }

  return tokens;
}

function splitFlowItems(value) {
  const items = [];
  let current = "";
  let quote;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      current += character;
      if (character === quote && value[index - 1] !== "\\") quote = undefined;
    } else if (character === "'" || character === '"') {
      quote = character;
      current += character;
    } else if (character === ",") {
      items.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (quote) throw new Error("Unclosed flow-sequence quote");
  if (current.trim()) items.push(current.trim());
  return items;
}

function parseScalar(value) {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid double-quoted scalar: ${value}`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error(`Invalid single-quoted scalar: ${value}`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new Error(`Invalid flow sequence: ${value}`);
    const contents = value.slice(1, -1).trim();
    return contents ? splitFlowItems(contents).map(parseScalar) : [];
  }
  if (value.startsWith("{") || value.endsWith("}")) {
    throw new Error("Flow mappings are not supported in this workflow");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  return value;
}

function parsePair(content, line) {
  const separator = content.indexOf(":");
  if (separator < 1) throw new Error(`Expected a mapping entry on line ${line}`);

  const rawKey = content.slice(0, separator).trim();
  const key = parseScalar(rawKey);
  if (typeof key !== "string" || !key) throw new Error(`Invalid mapping key on line ${line}`);
  return { key, rawValue: content.slice(separator + 1).trim() };
}

function addPair(target, key, value, line) {
  if (Object.hasOwn(target, key)) throw new Error(`Duplicate key '${key}' on line ${line}`);
  target[key] = value;
}

function parseMapping(tokens, startIndex, indent, initial = {}) {
  const result = initial;
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indent < indent) break;
    if (token.indent > indent || token.content.startsWith("-")) {
      throw new Error(`Unexpected structure on line ${token.line}`);
    }

    const { key, rawValue } = parsePair(token.content, token.line);
    index += 1;
    if (rawValue) {
      addPair(result, key, parseScalar(rawValue), token.line);
    } else if (index < tokens.length && tokens[index].indent > indent) {
      if (tokens[index].indent !== indent + 2) {
        throw new Error(`Unexpected indentation on line ${tokens[index].line}`);
      }
      const parsed = parseBlock(tokens, index, indent + 2);
      addPair(result, key, parsed.value, token.line);
      index = parsed.index;
    } else {
      addPair(result, key, null, token.line);
    }
  }

  return { value: result, index };
}

function parseSequence(tokens, startIndex, indent) {
  const result = [];
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indent < indent) break;
    if (token.indent > indent || !token.content.startsWith("-")) {
      throw new Error(`Unexpected sequence structure on line ${token.line}`);
    }

    const item = token.content.slice(1).trim();
    index += 1;
    if (!item) {
      if (index >= tokens.length || tokens[index].indent !== indent + 2) {
        throw new Error(`Missing sequence value on line ${token.line}`);
      }
      const parsed = parseBlock(tokens, index, indent + 2);
      result.push(parsed.value);
      index = parsed.index;
      continue;
    }

    if (!item.includes(":")) {
      result.push(parseScalar(item));
      continue;
    }

    const object = {};
    const { key, rawValue } = parsePair(item, token.line);
    if (rawValue) {
      addPair(object, key, parseScalar(rawValue), token.line);
    } else if (index < tokens.length && tokens[index].indent === indent + 4) {
      const parsed = parseBlock(tokens, index, indent + 4);
      addPair(object, key, parsed.value, token.line);
      index = parsed.index;
    } else {
      addPair(object, key, null, token.line);
    }

    if (index < tokens.length && tokens[index].indent === indent + 2) {
      const parsed = parseMapping(tokens, index, indent + 2, object);
      index = parsed.index;
    }
    result.push(object);
  }

  return { value: result, index };
}

function parseBlock(tokens, index, indent) {
  if (index >= tokens.length || tokens[index].indent !== indent) {
    throw new Error("Invalid YAML block");
  }
  return tokens[index].content.startsWith("-")
    ? parseSequence(tokens, index, indent)
    : parseMapping(tokens, index, indent);
}

function parseYaml(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0 || tokens[0].indent !== 0) throw new Error("Missing top-level mapping");
  const parsed = parseBlock(tokens, 0, 0);
  if (parsed.index !== tokens.length || Array.isArray(parsed.value)) {
    throw new Error("Workflow must contain one top-level mapping");
  }
  return parsed.value;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function triggerNames(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  return isObject(value) ? Object.keys(value) : [];
}

function allSteps(workflow) {
  if (!isObject(workflow.jobs)) return [];
  return Object.values(workflow.jobs).flatMap((job) =>
    isObject(job) && Array.isArray(job.steps) ? job.steps : [],
  );
}

function hasVersionComment(text, action, sha, version) {
  const escapedAction = action.replaceAll("/", "\\/");
  const pattern = new RegExp(
    `^\\s*-\\s+uses:\\s*${escapedAction}@${sha}\\s+#\\s*${version.replaceAll(".", "\\.")}\\s*$`,
    "mu",
  );
  return pattern.test(text);
}

function evaluatePolicy(workflow, text) {
  const triggers = triggerNames(workflow.on);
  const jobs = isObject(workflow.jobs) ? Object.values(workflow.jobs) : [];
  const permissions = workflow.permissions;
  const leastPrivilegePermissions =
    isObject(permissions) &&
    Object.keys(permissions).length === 1 &&
    permissions.contents === "read" &&
    jobs.every((job) => isObject(job) && !Object.hasOwn(job, "permissions"));

  const auditJob = jobs.find(
    (job) => isObject(job) && job["runs-on"] === "ubuntu-latest" && Array.isArray(job.steps),
  );
  const steps = auditJob?.steps ?? [];
  const checkoutRef = `actions/checkout@${checkoutSha}`;
  const setupNodeRef = `actions/setup-node@${setupNodeSha}`;
  const checkoutIndex = steps.findIndex((step) => isObject(step) && step.uses === checkoutRef);
  const setupNodeIndex = steps.findIndex((step) => isObject(step) && step.uses === setupNodeRef);
  const installIndex = steps.findIndex(
    (step) => isObject(step) && step.run === "npm ci --ignore-scripts",
  );
  const auditIndex = steps.findIndex(
    (step) => isObject(step) && step.run === "npm run audit:security",
  );
  const setupNodeStep = steps[setupNodeIndex];
  const externalActionsPinned = allSteps(workflow).every(
    (step) =>
      !isObject(step) ||
      typeof step.uses !== "string" ||
      step.uses.startsWith("./") ||
      /^[^@\s]+@[0-9a-f]{40}$/u.test(step.uses),
  );
  const requiredStepsRun = [checkoutIndex, setupNodeIndex, installIndex, auditIndex].every(
    (stepIndex) =>
      stepIndex >= 0 &&
      !Object.hasOwn(steps[stepIndex], "if") &&
      !Object.hasOwn(steps[stepIndex], "continue-on-error"),
  );

  return {
    requiredTriggers:
      triggers.includes("push") &&
      triggers.includes("pull_request") &&
      !triggers.includes("pull_request_target"),
    leastPrivilegePermissions,
    pinnedActions:
      checkoutIndex >= 0 &&
      setupNodeIndex >= 0 &&
      externalActionsPinned &&
      hasVersionComment(text, "actions/checkout", checkoutSha, "v6.0.2") &&
      hasVersionComment(text, "actions/setup-node", setupNodeSha, "v6.4.0"),
    nodeAndCache:
      isObject(setupNodeStep?.with) &&
      String(setupNodeStep.with["node-version"]) === "24" &&
      setupNodeStep.with.cache === "npm",
    auditCommandsInOrder:
      requiredStepsRun &&
      checkoutIndex < setupNodeIndex &&
      setupNodeIndex < installIndex &&
      installIndex < auditIndex &&
      !Object.hasOwn(auditJob, "if") &&
      !Object.hasOwn(auditJob, "continue-on-error"),
  };
}

let result;
try {
  const text = readFileSync(workflowPath, "utf8");
  const workflow = parseYaml(text);
  result = { validYaml: true, ...evaluatePolicy(workflow, text) };
} catch (error) {
  result = {
    validYaml: false,
    requiredTriggers: false,
    leastPrivilegePermissions: false,
    pinnedActions: false,
    nodeAndCache: false,
    auditCommandsInOrder: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

console.log(JSON.stringify(result));
