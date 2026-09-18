import { readFileSync } from "node:fs";
import { isMap, parseDocument, visit } from "yaml";

const checkoutSha = "de0fac2e4500dabe0009e67214ff5f5447ce83dd";
const setupNodeSha = "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e";
const workflowPath =
  process.argv[2] ?? ".github/workflows/dependency-audit.yml";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function triggerNames(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter((item) => typeof item === "string");
  return isObject(value) ? Object.keys(value) : [];
}

function allSteps(workflow) {
  if (!isObject(workflow.jobs)) return [];
  return Object.values(workflow.jobs).flatMap((job) =>
    isObject(job) && Array.isArray(job.steps) ? job.steps : [],
  );
}

function hasVersionComment(workflowDocument, actionRef, version) {
  let found = false;
  visit(workflowDocument, {
    Pair(_key, pair) {
      if (
        pair.key?.value === "uses" &&
        pair.value?.value === actionRef &&
        pair.value.comment?.trim() === version
      ) {
        found = true;
        return visit.BREAK;
      }
    },
  });
  return found;
}

function runCommands(steps) {
  return steps.flatMap((step, stepIndex) => {
    if (!isObject(step) || typeof step.run !== "string") return [];
    return step.run
      .split(/\r?\n/u)
      .filter((line) => !line.trimStart().startsWith("#"))
      .flatMap((line) => line.split("&&"))
      .map((command) => ({ command: command.trim(), stepIndex }));
  });
}

function evaluatePolicy(workflow, workflowDocument) {
  const triggers = triggerNames(workflow.on);
  const jobs = isObject(workflow.jobs) ? Object.values(workflow.jobs) : [];
  const permissions = workflow.permissions;
  const leastPrivilegePermissions =
    isObject(permissions) &&
    Object.keys(permissions).length === 1 &&
    permissions.contents === "read" &&
    jobs.every((job) => isObject(job) && !Object.hasOwn(job, "permissions"));

  const auditJob = jobs.find(
    (job) =>
      isObject(job) &&
      job["runs-on"] === "ubuntu-latest" &&
      Array.isArray(job.steps),
  );
  const steps = auditJob?.steps ?? [];
  const checkoutRef = `actions/checkout@${checkoutSha}`;
  const setupNodeRef = `actions/setup-node@${setupNodeSha}`;
  const checkoutIndex = steps.findIndex(
    (step) => isObject(step) && step.uses === checkoutRef,
  );
  const setupNodeIndex = steps.findIndex(
    (step) => isObject(step) && step.uses === setupNodeRef,
  );
  const commands = runCommands(steps);
  const installCommandIndex = commands.findIndex(({ command }) =>
    /^npm[ \t]+ci[ \t]+--ignore-scripts(?:[ \t]+#.*)?$/u.test(command),
  );
  const auditCommandIndex = commands.findIndex(({ command }) =>
    /^npm[ \t]+run[ \t]+audit:security(?:[ \t]+#.*)?$/u.test(command),
  );
  const installIndex = commands[installCommandIndex]?.stepIndex ?? -1;
  const auditIndex = commands[auditCommandIndex]?.stepIndex ?? -1;
  const setupNodeStep = steps[setupNodeIndex];
  const externalActionsPinned = allSteps(workflow).every(
    (step) =>
      !isObject(step) ||
      typeof step.uses !== "string" ||
      step.uses.startsWith("./") ||
      /^[^@\s]+@[0-9a-f]{40}$/u.test(step.uses),
  );
  const requiredStepsRun = [
    checkoutIndex,
    setupNodeIndex,
    installIndex,
    auditIndex,
  ].every(
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
      hasVersionComment(workflowDocument, checkoutRef, "v6.0.2") &&
      hasVersionComment(workflowDocument, setupNodeRef, "v6.4.0"),
    nodeAndCache:
      isObject(setupNodeStep?.with) &&
      String(setupNodeStep.with["node-version"]) === "24" &&
      setupNodeStep.with.cache === "npm",
    auditCommandsInOrder:
      requiredStepsRun &&
      checkoutIndex < setupNodeIndex &&
      setupNodeIndex < installIndex &&
      installCommandIndex < auditCommandIndex &&
      !Object.hasOwn(auditJob, "if") &&
      !Object.hasOwn(auditJob, "continue-on-error"),
  };
}

let result;
try {
  const text = readFileSync(workflowPath, "utf8");
  const workflowDocument = parseDocument(text);
  if (workflowDocument.errors.length > 0) {
    throw workflowDocument.errors[0];
  }
  if (!isMap(workflowDocument.contents)) {
    throw new Error("Workflow must contain one top-level mapping");
  }
  const workflow = workflowDocument.toJS();
  result = { validYaml: true, ...evaluatePolicy(workflow, workflowDocument) };
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
