#!/usr/bin/env node
/* global process */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, "../..");
const compatibilityConfigPath = path.join(scriptDirectory, "lexical.json");
const currentPackagePath = path.join(
  repositoryDirectory,
  "packages/lexical-review/package.json",
);
const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function isExactVersion(version) {
  return typeof version === "string" && exactVersionPattern.test(version);
}

function isLexicalPackage(name) {
  return name === "lexical" || name.startsWith("@lexical/");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadCompatibilityConfig() {
  return readJson(compatibilityConfigPath);
}

export function getCurrentLexicalVersion() {
  const packageJson = readJson(currentPackagePath);
  const version = packageJson.devDependencies?.lexical;

  if (!isExactVersion(version)) {
    throw new Error(
      `packages/lexical-review/package.json must declare an exact development lexical version, received ${String(version)}.`,
    );
  }

  return version;
}

function validateVersionList(name, versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error(`${name} must be a non-empty array of exact versions.`);
  }

  const invalidVersions = versions.filter(
    (version) => !isExactVersion(version),
  );
  if (invalidVersions.length > 0) {
    throw new Error(
      `${name} contains non-exact versions: ${invalidVersions.join(", ")}.`,
    );
  }

  if (new Set(versions).size !== versions.length) {
    throw new Error(`${name} must not contain duplicate versions.`);
  }
}

export function validateCompatibilityConfig(
  config = loadCompatibilityConfig(),
  currentVersion = getCurrentLexicalVersion(),
) {
  validateVersionList("unitVersions", config.unitVersions);
  validateVersionList("e2eVersions", config.e2eVersions);

  if (!config.unitVersions.includes(currentVersion)) {
    throw new Error(
      `unitVersions must include the current development version ${currentVersion}.`,
    );
  }

  const e2eVersionsMissingFromUnitVersions = config.e2eVersions.filter(
    (version) => !config.unitVersions.includes(version),
  );
  if (e2eVersionsMissingFromUnitVersions.length > 0) {
    throw new Error(
      `e2eVersions must be a subset of unitVersions; missing unit lanes: ${e2eVersionsMissingFromUnitVersions.join(", ")}.`,
    );
  }

  return config;
}

function getRequestedVersion() {
  return process.env.LEXICAL_COMPATIBILITY_MATRIX_VERSION?.trim() || undefined;
}

export function createCompatibilityMatrix(
  config = loadCompatibilityConfig(),
  currentVersion = getCurrentLexicalVersion(),
  requestedVersion = getRequestedVersion(),
) {
  validateCompatibilityConfig(config, currentVersion);

  const versions =
    requestedVersion == null ? config.unitVersions : [requestedVersion];
  if (versions.some((version) => !isExactVersion(version))) {
    throw new Error(
      `The requested compatibility version must be exact, received ${String(requestedVersion)}.`,
    );
  }

  return versions.map((version) => ({
    version,
    current: version === currentVersion,
    e2e: config.e2eVersions.includes(version),
  }));
}

export function collectResolvedLexicalPackages(
  value,
  packages = new Map(),
  hintedName,
) {
  if (value == null || typeof value !== "object") {
    return packages;
  }

  if (!Array.isArray(value)) {
    const name =
      typeof value.from === "string"
        ? value.from
        : typeof value.name === "string"
          ? value.name
          : hintedName;
    const version =
      typeof value.version === "string" ? value.version : undefined;

    if (name != null && version != null && isLexicalPackage(name)) {
      const versions = packages.get(name) ?? new Set();
      versions.add(version);
      packages.set(name, versions);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    collectResolvedLexicalPackages(
      child,
      packages,
      isLexicalPackage(key) ? key : undefined,
    );
  }

  return packages;
}

export function assertLexicalGraphAligned(graph, expectedVersion) {
  if (!isExactVersion(expectedVersion)) {
    throw new Error(
      `The expected compatibility version must be exact, received ${String(expectedVersion)}.`,
    );
  }

  const packages = collectResolvedLexicalPackages(graph);
  const resolvedPackages = [...packages.entries()].flatMap(([name, versions]) =>
    [...versions].map((version) => ({ name, version })),
  );

  if (resolvedPackages.length === 0) {
    throw new Error(
      "The resolved package graph does not contain Lexical packages.",
    );
  }

  const missingCorePackage = !packages.has("lexical");
  if (missingCorePackage) {
    throw new Error(
      "The resolved package graph does not contain the lexical package.",
    );
  }

  const mismatches = resolvedPackages.filter(
    ({ version }) => version !== expectedVersion,
  );
  if (mismatches.length > 0) {
    const details = mismatches
      .map(({ name, version }) => `${name}@${version}`)
      .sort()
      .join(", ");
    throw new Error(
      `The resolved Lexical package graph is not aligned to ${expectedVersion}: ${details}.`,
    );
  }

  return resolvedPackages.sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(
      `${right.name}@${right.version}`,
    ),
  );
}

function getPnpmExecutable() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function runPnpm(args, env = process.env) {
  const result = spawnSync(getPnpmExecutable(), args, {
    cwd: repositoryDirectory,
    env,
    stdio: "inherit",
  });

  if (result.error != null) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${args.join(" ")} failed with exit code ${result.status}.`,
    );
  }
}

function readPnpmJson(args, env = process.env) {
  const result = spawnSync(getPnpmExecutable(), args, {
    cwd: repositoryDirectory,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.error != null) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${args.join(" ")} failed with exit code ${result.status}.`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `pnpm ${args.join(" ")} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

export function verifyInstalledLexicalGraph(
  expectedVersion,
  env = process.env,
) {
  const graph = readPnpmJson(
    ["list", "--recursive", "--depth", "Infinity", "--json"],
    env,
  );
  const resolvedPackages = assertLexicalGraphAligned(graph, expectedVersion);

  console.log(
    `Verified ${resolvedPackages.length} Lexical packages at ${expectedVersion}.`,
  );
  return resolvedPackages;
}

function getDependencyManifestPaths() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repositoryDirectory,
    encoding: "utf8",
  });

  if (result.error != null) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ls-files failed with exit code ${result.status}.`);
  }

  return result.stdout
    .split("\0")
    .filter(
      (filePath) =>
        filePath === "pnpm-lock.yaml" ||
        filePath === "pnpm-workspace.yaml" ||
        path.basename(filePath) === "package.json",
    )
    .map((filePath) => path.join(repositoryDirectory, filePath));
}

function snapshotFiles(filePaths) {
  return new Map(
    filePaths.map((filePath) => [filePath, readFileSync(filePath)]),
  );
}

function assertFilesUnchanged(snapshot) {
  const changedFiles = [];

  for (const [filePath, contents] of snapshot) {
    let currentContents;
    try {
      currentContents = readFileSync(filePath);
    } catch {
      changedFiles.push(path.relative(repositoryDirectory, filePath));
      continue;
    }

    if (!contents.equals(currentContents)) {
      changedFiles.push(path.relative(repositoryDirectory, filePath));
    }
  }

  if (changedFiles.length > 0) {
    throw new Error(
      `Compatibility checks changed tracked dependency files: ${changedFiles.join(", ")}.`,
    );
  }
}

function parseVersionArgument(args) {
  const versionIndex = args.indexOf("--version");
  if (versionIndex === -1) {
    return undefined;
  }

  const version = args[versionIndex + 1];
  if (version == null || version.startsWith("--")) {
    throw new Error("--version requires an exact Lexical version.");
  }

  return version;
}

function runCompatibility(version) {
  const config = loadCompatibilityConfig();
  const currentVersion = getCurrentLexicalVersion();
  validateCompatibilityConfig(config, currentVersion);

  if (!isExactVersion(version)) {
    throw new Error(
      `The compatibility version must be exact, received ${String(version)}.`,
    );
  }

  const isCurrentVersion = version === currentVersion;
  const environment = { ...process.env };
  if (isCurrentVersion) {
    delete environment.LEXICAL_COMPATIBILITY_VERSION;
  } else {
    environment.LEXICAL_COMPATIBILITY_VERSION = version;
  }

  const trackedDependencyFiles = snapshotFiles(getDependencyManifestPaths());

  try {
    runPnpm(
      [
        "install",
        ...(isCurrentVersion
          ? ["--frozen-lockfile"]
          : ["--no-lockfile", "--force"]),
        "--config.optimistic-repeat-install=false",
      ],
      environment,
    );
    verifyInstalledLexicalGraph(version, environment);
    runPnpm(["--filter", "lexical-review", "build"], environment);
    runPnpm(["test", "--run"], environment);

    if (isCurrentVersion) {
      runPnpm(["lint"], environment);
      runPnpm(["prettier:check"], environment);
    }
  } finally {
    assertFilesUnchanged(trackedDependencyFiles);
  }

  console.log(
    `Lexical compatibility checks passed for ${version}${isCurrentVersion ? " (current frozen lane)" : " (ephemeral lane)"}.`,
  );
}

function printMatrix(githubOutput) {
  const matrix = {
    include: createCompatibilityMatrix(),
  };
  const e2eVersions = matrix.include
    .filter(({ e2e }) => e2e)
    .map(({ version }) => version);

  if (githubOutput) {
    console.log(`include=${JSON.stringify(matrix.include)}`);
    console.log(`e2e=${JSON.stringify(e2eVersions)}`);
    return;
  }

  console.log(JSON.stringify({ ...matrix, e2eVersions }, null, 2));
}

function printHelp() {
  console.log(`Usage:
  pnpm compatibility
  pnpm compatibility -- --version <exact-version>
  pnpm compatibility:matrix
  pnpm compatibility:validate
  pnpm compatibility:verify -- --version <exact-version>`);
}

function main(args) {
  const command = ["validate", "matrix", "verify", "run"].includes(args[0])
    ? args[0]
    : "run";
  const commandArgs = command === args[0] ? args.slice(1) : args;

  if (commandArgs.includes("--help")) {
    printHelp();
    return;
  }

  switch (command) {
    case "validate":
      validateCompatibilityConfig();
      console.log("Lexical compatibility configuration is valid.");
      break;
    case "matrix":
      printMatrix(commandArgs.includes("--github-output"));
      break;
    case "verify": {
      const version = parseVersionArgument(commandArgs);
      if (!isExactVersion(version)) {
        throw new Error(
          "compatibility:verify requires --version <exact-version>.",
        );
      }
      verifyInstalledLexicalGraph(version);
      break;
    }
    case "run": {
      const version =
        parseVersionArgument(commandArgs) ?? getCurrentLexicalVersion();
      runCompatibility(version);
      break;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
