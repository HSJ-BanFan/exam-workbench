import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { findMissingPackIgnores, findUncoveredPackInputs } from "./package-privacy.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const packageJson = JSON.parse(fs.readFileSync(`${root}/package.json`, "utf8"));
const missingIgnores = findMissingPackIgnores(packageJson.scripts?.pack ?? "");
if (missingIgnores.length) throw new Error(`pack command is missing private-file ignores: ${missingIgnores.join(", ")}`);

const untracked = execFileSync(
  "git",
  ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
  { cwd: root, encoding: "utf8" }
).split("\0").filter(Boolean);
const uncovered = findUncoveredPackInputs(untracked);
if (uncovered.length) {
  throw new Error(`pack source contains untracked files not excluded by the pack command: ${uncovered.join(", ")}`);
}

process.stdout.write(`Package inputs checked: ${untracked.length} untracked or ignored paths are covered by explicit exclusions.\n`);
