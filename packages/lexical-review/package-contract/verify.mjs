/* global process */

import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const packageContractDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(packageContractDirectory, "..");
const repositoryDirectory = path.resolve(packageDirectory, "../..");
const fixtureDirectory = path.join(packageContractDirectory, "fixtures");

const coreDependencies = ["@lexical", "lexical"];
const clientDependencies = [
  ...coreDependencies,
  "@types",
  "react",
  "react-dom",
];

async function linkDependencies(consumerDirectory, dependencies) {
  const nodeModulesDirectory = path.join(consumerDirectory, "node_modules");
  await mkdir(nodeModulesDirectory, { recursive: true });

  for (const dependency of dependencies) {
    const source = path.join(packageDirectory, "node_modules", dependency);
    const target = path.join(nodeModulesDirectory, dependency);

    await mkdir(path.dirname(target), { recursive: true });
    await symlink(source, target, "dir");
  }
}

async function createConsumer(temporaryDirectory, name, dependencies) {
  const consumerDirectory = path.join(temporaryDirectory, name);
  const packageTarget = path.join(
    consumerDirectory,
    "node_modules",
    "lexical-review",
  );

  await mkdir(packageTarget, { recursive: true });
  await writeFile(
    path.join(consumerDirectory, "package.json"),
    JSON.stringify(
      {
        name: `lexical-review-${name}-consumer`,
        private: true,
        type: "module",
      },
      null,
      2,
    ) + "\n",
  );
  await cp(
    path.join(packageDirectory, "package.json"),
    path.join(packageTarget, "package.json"),
  );
  await cp(
    path.join(packageDirectory, "dist"),
    path.join(packageTarget, "dist"),
    { recursive: true },
  );
  await linkDependencies(consumerDirectory, dependencies);

  return consumerDirectory;
}

async function copyFixtures(consumerDirectory, fixtures, typecheckFiles) {
  for (const fixture of fixtures) {
    await cp(
      path.join(fixtureDirectory, fixture),
      path.join(consumerDirectory, fixture),
    );
  }

  await writeFile(
    path.join(consumerDirectory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          lib: ["ESNext", "DOM", "DOM.Iterable"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        files: typecheckFiles,
      },
      null,
      2,
    ) + "\n",
  );
}

async function runTypecheck(consumerDirectory) {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  try {
    await execFileAsync(
      pnpmCommand,
      [
        "exec",
        "tsc",
        "--noEmit",
        "--project",
        path.join(consumerDirectory, "tsconfig.json"),
      ],
      { cwd: repositoryDirectory },
    );
  } catch (error) {
    if (error && typeof error === "object") {
      const output = [error.stdout, error.stderr]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join("\n");
      if (output !== "") {
        console.error(output);
      }
    }
    throw error;
  }
}

async function runRuntimeFixture(consumerDirectory, fixture) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(consumerDirectory, fixture)],
    { cwd: consumerDirectory },
  );
  process.stdout.write(stdout);
}

const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "lexical-review-package-contract-"),
);

try {
  const serverConsumer = await createConsumer(
    temporaryDirectory,
    "server",
    coreDependencies,
  );
  const clientConsumer = await createConsumer(
    temporaryDirectory,
    "client",
    clientDependencies,
  );

  await copyFixtures(
    serverConsumer,
    ["root.ts", "runtime-root.mjs"],
    ["root.ts"],
  );
  await copyFixtures(
    clientConsumer,
    ["client.ts", "cjs.cts", "runtime-client.mjs", "runtime-cjs.cjs"],
    ["client.ts", "cjs.cts"],
  );
  await runTypecheck(serverConsumer);
  await runTypecheck(clientConsumer);
  await runRuntimeFixture(serverConsumer, "runtime-root.mjs");
  await runRuntimeFixture(clientConsumer, "runtime-client.mjs");
  await runRuntimeFixture(clientConsumer, "runtime-cjs.cjs");
  console.log("package contract passed");
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
