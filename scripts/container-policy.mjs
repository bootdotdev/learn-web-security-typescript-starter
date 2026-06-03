import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";

const taxFixturePath =
  [
    "data/fixtures/mystery-shack-tax-exemption.pdf",
    "data/uploads/mystery-shack-tax-exemption.pdf",
  ].find((filePath) => existsSync(filePath)) ?? "data/uploads/mystery-shack-tax-exemption.pdf";

function readDockerfileInstructions(filePath) {
  const instructions = [];
  let logicalLine = "";

  for (const physicalLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmedLine = physicalLine.trim();
    if (!logicalLine && (!trimmedLine || trimmedLine.startsWith("#"))) {
      continue;
    }

    logicalLine += `${logicalLine ? " " : ""}${trimmedLine}`;
    if (logicalLine.endsWith("\\")) {
      logicalLine = logicalLine.slice(0, -1).trimEnd();
      continue;
    }

    const match = logicalLine.match(/^([A-Za-z]+)\s+(.+)$/);
    if (match) {
      instructions.push({ name: match[1].toUpperCase(), value: match[2].trim() });
    }
    logicalLine = "";
  }

  return instructions;
}

function parseFromInstruction(value) {
  const parts = value.split(/\s+/);
  const asIndex = parts.findIndex((part) => part.toUpperCase() === "AS");
  return {
    image: parts[0].toLowerCase(),
    name: asIndex >= 0 ? parts[asIndex + 1]?.toLowerCase() : undefined,
  };
}

function splitShellWords(value) {
  return [...value.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
}

function parseCopyInstruction(value) {
  const options = {};
  let remaining = value.trim();

  while (remaining.startsWith("--")) {
    const optionMatch = remaining.match(/^--([^=\s]+)(?:=([^\s]+))?\s+(.+)$/);
    if (!optionMatch) {
      break;
    }
    options[optionMatch[1].toLowerCase()] = optionMatch[2] ?? true;
    remaining = optionMatch[3].trim();
  }

  let paths;
  if (remaining.startsWith("[")) {
    try {
      paths = JSON.parse(remaining);
    } catch {
      return { options, sources: [], destination: undefined, valid: false };
    }
  } else {
    paths = splitShellWords(remaining);
  }

  if (!Array.isArray(paths) || paths.length < 2 || paths.some((path) => typeof path !== "string")) {
    return { options, sources: [], destination: undefined, valid: false };
  }

  return {
    options,
    sources: paths.slice(0, -1),
    destination: paths.at(-1),
    valid: true,
  };
}

function normalizeContextSource(source) {
  let normalized = source.replaceAll("\\", "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized.replace(/\/$/, "") || ".";
}

function buildDockerfileStages(instructions) {
  const stages = [];
  let currentStage;

  for (const instruction of instructions) {
    if (instruction.name === "FROM") {
      currentStage = {
        index: stages.length,
        ...parseFromInstruction(instruction.value),
        instructions: [],
      };
      stages.push(currentStage);
      continue;
    }
    currentStage?.instructions.push(instruction);
  }

  return stages;
}

function hasProductionInstall(stage) {
  return stage.instructions.some(
    (instruction) =>
      instruction.name === "RUN" && /(?:^|\s)npm\s+ci\s+--omit=dev(?:\s|$)/.test(instruction.value),
  );
}

function inspectProductionDependencySetup(stage) {
  let workdir = "/";
  const copiedManifests = new Set();

  for (const instruction of stage.instructions) {
    if (instruction.name === "WORKDIR") {
      workdir = resolveContainerPath(instruction.value, workdir);
      continue;
    }

    if (instruction.name === "COPY") {
      const parsedCopy = parseCopyInstruction(instruction.value);
      if (!parsedCopy.valid || parsedCopy.options.from) {
        continue;
      }

      const destination = resolveContainerPath(parsedCopy.destination, workdir);
      const destinationIsDirectory =
        parsedCopy.sources.length > 1 ||
        parsedCopy.destination.endsWith("/") ||
        parsedCopy.destination === "." ||
        parsedCopy.destination === "./" ||
        destination === workdir;

      for (const source of parsedCopy.sources) {
        const normalizedSource = normalizeContextSource(source);
        if (normalizedSource === "package*.json" && destinationIsDirectory) {
          if (destination === "/app") {
            copiedManifests.add("package.json");
            copiedManifests.add("package-lock.json");
          }
          continue;
        }
        if (!["package.json", "package-lock.json"].includes(normalizedSource)) {
          continue;
        }

        const target = destinationIsDirectory
          ? posix.join(destination, posix.basename(normalizedSource))
          : destination;
        if (target === `/app/${normalizedSource}`) {
          copiedManifests.add(normalizedSource);
        }
      }
      continue;
    }

    if (
      instruction.name === "RUN" &&
      /(?:^|\s)npm\s+ci\s+--omit=dev(?:\s|$)/.test(instruction.value)
    ) {
      return {
        dependencyWorkdir: workdir === "/app",
        dependencyManifests:
          copiedManifests.has("package.json") && copiedManifests.has("package-lock.json"),
      };
    }
  }

  return { dependencyWorkdir: false, dependencyManifests: false };
}

function stageReferenceMatches(reference, stage) {
  return reference === String(stage.index) || reference.toLowerCase() === stage.name;
}

function resolveContainerPath(value, workdir) {
  const normalized = value.replaceAll("\\", "/");
  return posix.normalize(normalized.startsWith("/") ? normalized : posix.join(workdir, normalized));
}

function resolveCopyTarget(parsedCopy, source, sourceKind, workdir) {
  if (parsedCopy.sources.length !== 1) {
    return undefined;
  }

  const destination = parsedCopy.destination;
  const resolvedDestination = resolveContainerPath(destination, workdir);
  if (["dependencies", "source", "public"].includes(sourceKind)) {
    return resolvedDestination;
  }

  const destinationIsDirectory =
    destination.endsWith("/") ||
    destination === "." ||
    destination === "./" ||
    resolvedDestination === workdir;
  return destinationIsDirectory
    ? posix.join(resolvedDestination, posix.basename(source.replace(/\/$/, "")))
    : resolvedDestination;
}

function inspectDockerfile(filePath) {
  const instructions = readDockerfileInstructions(filePath);
  const dockerfileStages = buildDockerfileStages(instructions);
  const dependencyCandidates = dockerfileStages.slice(0, -1).filter(hasProductionInstall);
  const dependencyStage = dependencyCandidates.length === 1 ? dependencyCandidates[0] : undefined;
  const runtimeStage = dockerfileStages.at(-1);
  const runtimeInstructions = runtimeStage?.instructions ?? [];
  const dependencySetup = dependencyStage
    ? inspectProductionDependencySetup(dependencyStage)
    : { dependencyWorkdir: false, dependencyManifests: false };
  const stages = Boolean(
    dependencyStage?.image === "node:24-alpine" &&
    runtimeStage?.image === "node:24-alpine" &&
    dependencyStage.index < runtimeStage.index,
  );
  const productionDependencies = Boolean(
    dependencyStage && dependencySetup.dependencyWorkdir && dependencySetup.dependencyManifests,
  );

  const contextSources = new Map([
    ["package.json", { key: "context:package.json", kind: "file", target: "/app/package.json" }],
    ["src", { key: "context:src", kind: "source", target: "/app/src" }],
    ["public", { key: "context:public", kind: "public", target: "/app/public" }],
    [
      taxFixturePath,
      {
        key: `context:${taxFixturePath}`,
        kind: "file",
        target: `/app/${taxFixturePath}`,
      },
    ],
  ]);
  const dependencySource = {
    key: "dependencies:/app/node_modules",
    kind: "dependencies",
    target: "/app/node_modules",
  };
  const requiredRuntimeSources = new Set([
    dependencySource.key,
    ...[...contextSources.values()].map((source) => source.key),
  ]);
  const foundRuntimeSources = new Set();
  const unexpectedRuntimeSources = [];
  let fixtureOwnedByNode = false;
  let workdir = "/";

  for (const instruction of runtimeInstructions) {
    if (instruction.name === "WORKDIR") {
      workdir = resolveContainerPath(instruction.value, workdir);
      continue;
    }
    if (instruction.name === "ADD") {
      unexpectedRuntimeSources.push(`ADD ${instruction.value}`);
      continue;
    }
    if (instruction.name !== "COPY") {
      continue;
    }

    const parsedCopy = parseCopyInstruction(instruction.value);
    if (!parsedCopy.valid) {
      unexpectedRuntimeSources.push(`COPY ${instruction.value}`);
      continue;
    }

    const fromStage =
      typeof parsedCopy.options.from === "string" ? parsedCopy.options.from : undefined;
    for (const source of parsedCopy.sources) {
      let expectedSource;
      if (
        fromStage &&
        dependencyStage &&
        stageReferenceMatches(fromStage, dependencyStage) &&
        posix.normalize(source) === "/app/node_modules"
      ) {
        expectedSource = dependencySource;
      } else if (!fromStage) {
        expectedSource = contextSources.get(normalizeContextSource(source));
      }

      if (!expectedSource) {
        unexpectedRuntimeSources.push(source);
        continue;
      }

      const target = resolveCopyTarget(parsedCopy, source, expectedSource.kind, workdir);
      if (target !== expectedSource.target) {
        unexpectedRuntimeSources.push(`${source} -> ${target ?? "multiple destinations"}`);
        continue;
      }

      foundRuntimeSources.add(expectedSource.key);
      if (expectedSource.key === `context:${taxFixturePath}`) {
        fixtureOwnedByNode = parsedCopy.options.chown === "node:node";
      }
    }
  }

  const runtimeCopies =
    unexpectedRuntimeSources.length === 0 &&
    [...requiredRuntimeSources].every((source) => foundRuntimeSources.has(source));
  const runtimeCommands = runtimeInstructions
    .filter((instruction) => instruction.name === "RUN")
    .map((instruction) => instruction.value)
    .join(" && ");
  const writableData =
    runtimeCommands.includes("data/uploads") &&
    runtimeCommands.includes("data/bulk-tax-documents") &&
    /chown(?:\s+-R)?\s+node(?::node)?\s+data(?:\s|$)/.test(runtimeCommands) &&
    fixtureOwnedByNode;

  const lastUser = runtimeInstructions.filter((instruction) => instruction.name === "USER").at(-1);
  const nonRootRuntime = ["node", "node:node"].includes(lastUser?.value.toLowerCase());

  const lastCommand = runtimeInstructions
    .filter((instruction) => instruction.name === "CMD")
    .at(-1);
  let commandParts = [];
  if (lastCommand?.value.startsWith("[")) {
    try {
      commandParts = JSON.parse(lastCommand.value);
    } catch {
      commandParts = [];
    }
  } else if (lastCommand) {
    commandParts = splitShellWords(lastCommand.value);
  }
  const directTypeScript =
    !runtimeInstructions.some((instruction) => instruction.name === "ENTRYPOINT") &&
    commandParts.length === 2 &&
    commandParts[0] === "node" &&
    normalizeContextSource(commandParts[1]) === "src/main.ts";

  return {
    stages,
    productionDependencies,
    ...dependencySetup,
    runtimeCopies,
    writableData,
    nonRootRuntime,
    directTypeScript,
    unexpectedRuntimeSources,
  };
}

function globToRegexSource(pattern) {
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+*.]/g, "\\$&");
    }
  }

  return source;
}

function parseDockerignore(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      let pattern = negated ? line.slice(1) : line;
      pattern = pattern.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\//, "");
      const directoryPattern = pattern.endsWith("/");
      pattern = pattern.replace(/\/$/, "");
      const anchored = pattern.includes("/");
      const prefix = anchored ? "^" : "(?:^|.*/)";
      const suffix = directoryPattern ? "(?:/.*)?$" : "$";
      return {
        negated,
        regex: new RegExp(`${prefix}${globToRegexSource(pattern)}${suffix}`),
      };
    });
}

function listProjectFiles(projectRoot, directoryName) {
  const directoryPath = join(projectRoot, directoryName);
  if (!existsSync(directoryPath)) {
    return [];
  }

  const fileNames = [];
  const visit = (currentDirectory) => {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        fileNames.push(relative(projectRoot, entryPath).replaceAll("\\", "/"));
      }
    }
  };
  visit(directoryPath);
  return fileNames.sort();
}

function inspectDockerignore(filePath, projectRoot) {
  const patterns = parseDockerignore(filePath);
  const isExcluded = (fileName) => {
    let excluded = false;
    for (const pattern of patterns) {
      if (pattern.regex.test(fileName)) {
        excluded = !pattern.negated;
      }
    }
    return excluded;
  };

  const paths = {
    manifests: ["package.json", "package-lock.json"],
    environment: [".env", ".env.local", ".env.production"],
    git: [".git/config"],
    dependencies: ["node_modules/express/index.js"],
    compiledOutput: ["dist/server.js"],
    coverage: ["coverage/index.html"],
    temporary: ["tmp/build-cache.json"],
    logs: ["debug.log", "data/bearly-secure.log"],
    databases: ["data/bearly-secure.sqlite", "data/bearly-secure.sqlite-wal"],
    bulkImports: ["data/bulk-tax-documents/incoming.pdf"],
    runtimeUploads: ["data/uploads/customer-tax-document.pdf"],
    source: ["src/main.ts"],
    publicAssets: ["public/styles.css"],
    fixture: [taxFixturePath],
  };
  const results = Object.fromEntries(
    Object.entries(paths).map(([name, fileNames]) => [
      name,
      Object.fromEntries(fileNames.map((fileName) => [fileName, isExcluded(fileName)])),
    ]),
  );
  const everyExcluded = (names) => names.every((name) => isExcluded(name));
  const sourceFiles = listProjectFiles(projectRoot, "src");
  const publicFiles = listProjectFiles(projectRoot, "public");
  const requiredRuntimeFiles = [
    ...paths.manifests,
    ...sourceFiles,
    ...publicFiles,
    ...paths.fixture,
  ];
  const unexpectedExcludedRuntimeFiles = requiredRuntimeFiles.filter(isExcluded);

  return {
    sensitiveAndLocalFilesExcluded: everyExcluded([
      ...paths.environment,
      ...paths.git,
      ...paths.dependencies,
      ...paths.compiledOutput,
      ...paths.coverage,
      ...paths.temporary,
      ...paths.logs,
      ...paths.databases,
    ]),
    generatedDataExcluded: everyExcluded([...paths.bulkImports, ...paths.runtimeUploads]),
    runtimeFilesIncluded:
      sourceFiles.length > 0 &&
      publicFiles.length > 0 &&
      unexpectedExcludedRuntimeFiles.length === 0,
    runtimeFileCounts: {
      manifests: paths.manifests.length,
      source: sourceFiles.length,
      publicAssets: publicFiles.length,
    },
    unexpectedExcludedRuntimeFiles,
    paths: results,
  };
}

const mode = process.argv[2];
const filePath = process.argv[3] ?? (mode === "dockerfile" ? "Dockerfile" : ".dockerignore");

try {
  if (mode === "dockerfile") {
    console.log(JSON.stringify(inspectDockerfile(filePath)));
  } else if (mode === "dockerignore") {
    console.log(JSON.stringify(inspectDockerignore(filePath, resolve(process.argv[4] ?? "."))));
  } else {
    throw new Error("Usage: node scripts/container-policy.mjs <dockerfile|dockerignore> [path]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
