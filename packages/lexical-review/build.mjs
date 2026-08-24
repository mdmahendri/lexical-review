/* global process */

import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { rolldown } from "rolldown";

const execFileAsync = promisify(execFile);
const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(packageDirectory, "../..");
const distDirectory = path.join(packageDirectory, "dist");
const buildInfoFile = path.join(packageDirectory, "tsconfig.build.tsbuildinfo");

const inputs = {
  index: path.join(packageDirectory, "src/index.ts"),
  client: path.join(packageDirectory, "src/client.ts"),
};

const external = [
  /^@lexical(?:\/|$)/,
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^lexical$/,
];

async function buildRuntime() {
  const bundle = await rolldown({
    input: inputs,
    external,
    tsconfig: path.join(packageDirectory, "tsconfig.json"),
  });

  try {
    await bundle.write({
      cleanDir: true,
      dir: distDirectory,
      entryFileNames: "[name].mjs",
      chunkFileNames: "chunks/[name]-[hash].mjs",
      exports: "named",
      format: "es",
    });

    await bundle.write({
      dir: distDirectory,
      entryFileNames: "[name].js",
      chunkFileNames: "chunks/[name]-[hash].js",
      exports: "named",
      format: "cjs",
    });
  } finally {
    await bundle.close();
  }
}

async function buildDeclarations() {
  const tsc = path.join(
    repositoryDirectory,
    "node_modules/.bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  const { stdout, stderr } = await execFileAsync(
    tsc,
    ["-p", path.join(packageDirectory, "tsconfig.build.json")],
    { cwd: packageDirectory },
  );
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

await rm(distDirectory, { force: true, recursive: true });
await rm(buildInfoFile, { force: true });
await mkdir(distDirectory, { recursive: true });
await buildRuntime();
await buildDeclarations();
