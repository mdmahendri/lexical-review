import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL(".", import.meta.url));
const tsc = fileURLToPath(
  new URL("../../node_modules/.bin/tsc", import.meta.url),
);
execFileSync(tsc, ["-p", "tsconfig.json"], { cwd, stdio: "inherit" });
execFileSync(
  tsc,
  [
    "-p",
    "tsconfig.json",
    "--module",
    "ES2022",
    "--outDir",
    "dist/esm",
    "--declaration",
    "false",
  ],
  { cwd, stdio: "inherit" },
);
renameSync(
  new URL("dist/esm/index.js", import.meta.url),
  new URL("dist/index.mjs", import.meta.url),
);
