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
const lexicalPackageNames = [
  "@lexical/clipboard",
  "@lexical/react",
  "@lexical/utils",
  "lexical",
];
const reactPackageNames = ["react", "react-dom"];
const playwrightProjects = ["chromium", "firefox", "webkit"];
const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const developmentVersionPattern = /^\^?(\d+\.\d+\.\d+)$/;
const lexicalPeerIntervalPattern = /^>=(\d+\.\d+\.\d+)\s+<(\d+\.\d+\.\d+)$/;
function isExactVersion(version) {
  return typeof version === "string" && exactVersionPattern.test(version);
}

function isLexicalPackage(name) {
  return name === "lexical" || name.startsWith("@lexical/");
}

function isReactPackage(name) {
  return reactPackageNames.includes(name);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadCompatibilityConfig() {
  return readJson(compatibilityConfigPath);
}

function parseNumericVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match == null) {
    throw new Error(`Expected a numeric Lexical version, received ${version}.`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareNumericVersions(left, right) {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

function getLexicalVersions(packageJson, field) {
  const dependencies = packageJson[field] ?? {};
  const missingPackages = lexicalPackageNames.filter(
    (name) => dependencies[name] == null,
  );

  if (missingPackages.length > 0) {
    throw new Error(
      `${field} must declare all aligned Lexical packages: ${missingPackages.join(", ")}.`,
    );
  }

  return lexicalPackageNames.map((name) => ({
    name,
    version: dependencies[name],
  }));
}

function getReactVersions(packageJson, field) {
  const dependencies = packageJson[field] ?? {};
  const missingPackages = reactPackageNames.filter(
    (name) => dependencies[name] == null,
  );

  if (missingPackages.length > 0) {
    throw new Error(
      `${field} must declare aligned React packages: ${missingPackages.join(", ")}.`,
    );
  }

  return reactPackageNames.map((name) => ({
    name,
    version: dependencies[name],
  }));
}

function getDevelopmentVersion(version, field, packageName) {
  if (typeof version !== "string") {
    throw new Error(
      `${field} ${packageName} must use an exact or caret version, received ${String(version)}.`,
    );
  }

  const match = developmentVersionPattern.exec(version);
  if (match == null) {
    throw new Error(
      `${field} ${packageName} must use an exact or caret version, received ${version}.`,
    );
  }

  return match[1];
}

function getAlignedLexicalDevelopmentVersion(packageJson) {
  const versions = getLexicalVersions(packageJson, "devDependencies");
  const invalidVersions = versions.filter(
    ({ version }) => !isExactVersion(version),
  );

  if (invalidVersions.length > 0) {
    throw new Error(
      `development Lexical packages must use exact versions: ${invalidVersions
        .map(({ name, version }) => `${name}@${String(version)}`)
        .join(", ")}.`,
    );
  }

  const uniqueVersions = new Set(versions.map(({ version }) => version));
  if (uniqueVersions.size !== 1) {
    throw new Error(
      `development Lexical packages must use one exact version: ${versions
        .map(({ name, version }) => `${name}@${version}`)
        .join(", ")}.`,
    );
  }

  return versions[0].version;
}

function getLexicalPeerInterval(packageJson) {
  const ranges = getLexicalVersions(packageJson, "peerDependencies");
  const uniqueRanges = new Set(ranges.map(({ version }) => version));

  if (uniqueRanges.size !== 1) {
    throw new Error(
      `Lexical peerDependencies must use one shared range: ${ranges
        .map(({ name, version }) => `${name}@${String(version)}`)
        .join(", ")}.`,
    );
  }

  const range = ranges[0].version;
  const match = lexicalPeerIntervalPattern.exec(range);
  if (match == null) {
    throw new Error(
      `Lexical peerDependencies must use one shared range in the form >=X.Y.Z <X.Y.Z, received ${range}.`,
    );
  }

  const lower = parseNumericVersion(match[1]);
  const upper = parseNumericVersion(match[2]);
  if (
    lower.major !== upper.major ||
    compareNumericVersions(lower, upper) >= 0
  ) {
    throw new Error(
      `Lexical peerDependencies must use one shared range within one major, received ${range}.`,
    );
  }

  return { range, lower, lowerVersion: match[1], upper };
}

export function getCurrentLexicalVersion(
  packageJson = readJson(currentPackagePath),
) {
  return getAlignedLexicalDevelopmentVersion(packageJson);
}

export function getCurrentReactVersion(
  packageJson = readJson(currentPackagePath),
) {
  const versions = getReactVersions(packageJson, "devDependencies").map(
    ({ name, version }) => ({
      name,
      version: getDevelopmentVersion(version, "devDependencies", name),
    }),
  );
  const uniqueVersions = new Set(versions.map(({ version }) => version));

  if (uniqueVersions.size !== 1) {
    throw new Error(
      `development React packages must use one aligned version: ${versions
        .map(({ name, version }) => `${name}@${version}`)
        .join(", ")}.`,
    );
  }

  return versions[0].version;
}

function getReactPeerRange(packageJson) {
  const ranges = getReactVersions(packageJson, "peerDependencies");
  const uniqueRanges = new Set(ranges.map(({ version }) => version));

  if (uniqueRanges.size !== 1) {
    throw new Error(
      `React peerDependencies must use one shared range: ${ranges
        .map(({ name, version }) => `${name}@${String(version)}`)
        .join(", ")}.`,
    );
  }

  return ranges[0].version;
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
  packageJson = readJson(currentPackagePath),
) {
  validateVersionList("unitVersions", config.unitVersions);
  validateVersionList("e2eVersions", config.e2eVersions);
  validateVersionList("e2eReactVersions", config.e2eReactVersions);

  const developmentVersion = getCurrentLexicalVersion(packageJson);
  if (developmentVersion !== currentVersion) {
    throw new Error(
      `The current Lexical version ${currentVersion} does not match the aligned development version ${developmentVersion}.`,
    );
  }

  const peerInterval = getLexicalPeerInterval(packageJson);
  const currentNumericVersion = parseNumericVersion(currentVersion);
  if (
    compareNumericVersions(currentNumericVersion, peerInterval.lower) < 0 ||
    compareNumericVersions(currentNumericVersion, peerInterval.upper) >= 0
  ) {
    throw new Error(
      `The current Lexical version ${currentVersion} is outside the shared peer range ${peerInterval.range}.`,
    );
  }

  const expectedUpper = {
    major: currentNumericVersion.major,
    minor: currentNumericVersion.minor + 1,
    patch: 0,
  };
  if (compareNumericVersions(peerInterval.upper, expectedUpper) !== 0) {
    throw new Error(
      `The shared peer range ${peerInterval.range} must end at the exclusive next minor ${expectedUpper.major}.${expectedUpper.minor}.0 after the current development version.`,
    );
  }

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

  if (!config.unitVersions.includes(peerInterval.lowerVersion)) {
    throw new Error(
      `unitVersions must include the exact lower-bound version ${peerInterval.lowerVersion}.`,
    );
  }

  const missingMinorVersions = [];
  for (
    let minor = peerInterval.lower.minor;
    minor < peerInterval.upper.minor;
    minor += 1
  ) {
    const hasMinor = config.unitVersions.some((version) => {
      const numericVersion = parseNumericVersion(version);
      return (
        numericVersion.major === peerInterval.lower.major &&
        numericVersion.minor === minor
      );
    });
    if (!hasMinor) {
      missingMinorVersions.push(`${peerInterval.lower.major}.${minor}`);
    }
  }

  if (missingMinorVersions.length > 0) {
    throw new Error(
      `unitVersions must include every Lexical minor in the shared peer range; missing: ${missingMinorVersions.join(", ")}.`,
    );
  }

  const unsupportedUnitVersions = config.unitVersions.filter((version) => {
    const numericVersion = parseNumericVersion(version);
    return (
      compareNumericVersions(numericVersion, peerInterval.lower) < 0 ||
      compareNumericVersions(numericVersion, peerInterval.upper) >= 0
    );
  });
  if (unsupportedUnitVersions.length > 0) {
    throw new Error(
      `unitVersions contains versions outside the shared peer range ${peerInterval.range}: ${unsupportedUnitVersions.join(", ")}.`,
    );
  }

  if (!config.e2eVersions.includes(peerInterval.lowerVersion)) {
    throw new Error(
      `e2eVersions must include the exact lower-bound version ${peerInterval.lowerVersion}.`,
    );
  }

  if (!config.e2eVersions.includes(currentVersion)) {
    throw new Error(
      `e2eVersions must include the exact current development version ${currentVersion}.`,
    );
  }

  const currentReactVersion = getCurrentReactVersion(packageJson);
  const reactPeerRange = getReactPeerRange(packageJson);
  const unsupportedReactVersions = [
    currentReactVersion,
    ...config.e2eReactVersions,
  ].filter((version) => {
    const major = parseNumericVersion(version).major;
    return !reactPeerRange.includes(`^${major}.0.0`);
  });

  if (unsupportedReactVersions.length > 0) {
    throw new Error(
      `React peerDependencies ${reactPeerRange} do not include tested versions: ${unsupportedReactVersions.join(", ")}.`,
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
  packageJson = readJson(currentPackagePath),
) {
  validateCompatibilityConfig(config, currentVersion, packageJson);

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

export function createE2ECompatibilityMatrix(
  config = loadCompatibilityConfig(),
  currentVersion = getCurrentLexicalVersion(),
  requestedVersion = getRequestedVersion(),
  packageJson = readJson(currentPackagePath),
) {
  validateCompatibilityConfig(config, currentVersion, packageJson);

  const lexicalVersions =
    requestedVersion == null ? config.e2eVersions : [requestedVersion];
  if (lexicalVersions.some((version) => !isExactVersion(version))) {
    throw new Error(
      `The requested E2E compatibility version must be exact, received ${String(requestedVersion)}.`,
    );
  }

  const currentReactVersion = getCurrentReactVersion(packageJson);
  const baselineLanes = lexicalVersions.map((lexicalVersion) => ({
    lexicalVersion,
    reactVersion: currentReactVersion,
    project: "all",
  }));
  const focusedReactLanes = config.e2eReactVersions.flatMap((reactVersion) =>
    lexicalVersions.map((lexicalVersion) => ({
      lexicalVersion,
      reactVersion,
      project: "chromium",
    })),
  );

  return [...baselineLanes, ...focusedReactLanes].filter(
    (lane, index, lanes) =>
      lanes.findIndex(
        (candidate) =>
          candidate.lexicalVersion === lane.lexicalVersion &&
          candidate.reactVersion === lane.reactVersion &&
          candidate.project === lane.project,
      ) === index,
  );
}

function collectResolvedPackages(
  value,
  isTargetPackage,
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

    if (name != null && version != null && isTargetPackage(name)) {
      const versions = packages.get(name) ?? new Set();
      versions.add(version);
      packages.set(name, versions);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    collectResolvedPackages(
      child,
      isTargetPackage,
      packages,
      isTargetPackage(key) ? key : undefined,
    );
  }

  return packages;
}

export function collectResolvedLexicalPackages(
  value,
  packages = new Map(),
  hintedName,
) {
  return collectResolvedPackages(value, isLexicalPackage, packages, hintedName);
}

export function collectResolvedReactPackages(
  value,
  packages = new Map(),
  hintedName,
) {
  return collectResolvedPackages(value, isReactPackage, packages, hintedName);
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

export function assertReactGraphAligned(graph, expectedVersion) {
  if (!isExactVersion(expectedVersion)) {
    throw new Error(
      `The expected React version must be exact, received ${String(expectedVersion)}.`,
    );
  }

  const packages = collectResolvedReactPackages(graph);
  const resolvedPackages = [...packages.entries()].flatMap(([name, versions]) =>
    [...versions].map((version) => ({ name, version })),
  );

  if (!packages.has("react") || !packages.has("react-dom")) {
    throw new Error(
      "The resolved package graph must contain both react and react-dom.",
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
      `The resolved React package graph is not aligned to ${expectedVersion}: ${details}.`,
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

export function verifyInstalledReactGraph(expectedVersion, env = process.env) {
  const graph = readPnpmJson(
    ["list", "--recursive", "--depth", "Infinity", "--json"],
    env,
  );
  const resolvedPackages = assertReactGraphAligned(graph, expectedVersion);

  console.log(
    `Verified ${resolvedPackages.length} React packages at ${expectedVersion}.`,
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
  return parseArgument(args, "--version", "Lexical");
}

function parseReactVersionArgument(args) {
  return parseArgument(args, "--react-version", "React");
}

function parseArgument(args, option, name) {
  const versionIndex = args.indexOf(option);
  if (versionIndex === -1) {
    return undefined;
  }

  const version = args[versionIndex + 1];
  if (version == null || version.startsWith("--")) {
    throw new Error(`${option} requires an exact ${name} version.`);
  }

  return version;
}

function parsePlaywrightProjects(args) {
  const projectArgument = parseArgument(
    args,
    "--project",
    "Playwright project",
  );
  const requestedProjects =
    projectArgument == null || projectArgument === "all"
      ? playwrightProjects
      : projectArgument.split(",");
  const invalidProjects = requestedProjects.filter(
    (project) => !playwrightProjects.includes(project),
  );

  if (invalidProjects.length > 0) {
    throw new Error(
      `Unknown Playwright project(s): ${invalidProjects.join(", ")}. Expected one of ${playwrightProjects.join(", ")}.`,
    );
  }

  return requestedProjects;
}

function runCompatibility(version) {
  const config = loadCompatibilityConfig();
  const currentVersion = getCurrentLexicalVersion();
  const currentReactVersion = getCurrentReactVersion();
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
    delete environment.REACT_COMPATIBILITY_VERSION;
  } else {
    environment.LEXICAL_COMPATIBILITY_VERSION = version;
    environment.REACT_COMPATIBILITY_VERSION = currentReactVersion;
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
    verifyInstalledReactGraph(currentReactVersion, environment);
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

function runCompatibilityE2E(version, reactVersion, projects) {
  const config = loadCompatibilityConfig();
  const currentLexicalVersion = getCurrentLexicalVersion();
  const currentReactVersion = getCurrentReactVersion();
  validateCompatibilityConfig(config, currentLexicalVersion);

  if (!isExactVersion(version)) {
    throw new Error(
      `The E2E compatibility version must be exact, received ${String(version)}.`,
    );
  }
  if (!isExactVersion(reactVersion)) {
    throw new Error(
      `The E2E React compatibility version must be exact, received ${String(reactVersion)}.`,
    );
  }

  const isCurrentLexicalVersion = version === currentLexicalVersion;
  const isCurrentReactVersion = reactVersion === currentReactVersion;
  const isCurrentLane = isCurrentLexicalVersion && isCurrentReactVersion;
  const environment = { ...process.env };

  if (isCurrentLexicalVersion) {
    delete environment.LEXICAL_COMPATIBILITY_VERSION;
  } else {
    environment.LEXICAL_COMPATIBILITY_VERSION = version;
  }
  if (isCurrentReactVersion) {
    if (isCurrentLexicalVersion) {
      delete environment.REACT_COMPATIBILITY_VERSION;
    } else {
      environment.REACT_COMPATIBILITY_VERSION = currentReactVersion;
    }
  } else {
    environment.REACT_COMPATIBILITY_VERSION = reactVersion;
  }

  const trackedDependencyFiles = snapshotFiles(getDependencyManifestPaths());

  try {
    runPnpm(
      [
        "install",
        ...(isCurrentLane
          ? ["--frozen-lockfile"]
          : ["--no-lockfile", "--force"]),
        "--config.optimistic-repeat-install=false",
      ],
      environment,
    );
    verifyInstalledLexicalGraph(version, environment);
    verifyInstalledReactGraph(reactVersion, environment);
    runPnpm(["typecheck:e2e"], environment);

    if (process.env.PLAYWRIGHT_INSTALL_BROWSERS === "true") {
      runPnpm(
        ["exec", "playwright", "install", "--with-deps", ...projects],
        environment,
      );
    }

    const projectArguments =
      projects.length === playwrightProjects.length
        ? []
        : projects.flatMap((project) => ["--project", project]);
    runPnpm(["test:e2e", ...projectArguments], environment);
  } finally {
    assertFilesUnchanged(trackedDependencyFiles);
  }

  console.log(
    `Lexical/React E2E checks passed for Lexical ${version} and React ${reactVersion}${isCurrentLane ? " (current frozen lane)" : " (ephemeral lane)"}.`,
  );
}

function printMatrix(githubOutput) {
  const matrix = {
    include: createCompatibilityMatrix(),
  };
  const e2eLanes = createE2ECompatibilityMatrix();
  const e2eVersions = [
    ...new Set(e2eLanes.map(({ lexicalVersion }) => lexicalVersion)),
  ];

  if (githubOutput) {
    console.log(`include=${JSON.stringify(matrix.include)}`);
    console.log(`e2e=${JSON.stringify(e2eLanes)}`);
    return;
  }

  console.log(JSON.stringify({ ...matrix, e2eVersions, e2eLanes }, null, 2));
}

function printHelp() {
  console.log(`Usage:
  pnpm compatibility
  pnpm compatibility -- --version <exact-version>
  pnpm compatibility:matrix
  pnpm compatibility:validate
  pnpm compatibility:verify -- --version <exact-version>
  pnpm compatibility:e2e -- --version <exact-version> --react-version <exact-version> --project <name|all>`);
}

function main(args) {
  const command = ["validate", "matrix", "verify", "run", "e2e"].includes(
    args[0],
  )
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
    case "e2e": {
      const version =
        parseVersionArgument(commandArgs) ?? getCurrentLexicalVersion();
      const reactVersion =
        parseReactVersionArgument(commandArgs) ?? getCurrentReactVersion();
      runCompatibilityE2E(
        version,
        reactVersion,
        parsePlaywrightProjects(commandArgs),
      );
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
