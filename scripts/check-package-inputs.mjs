import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { assertPackageOutputAbsent, findMissingPackIgnores, findUncoveredPackInputs } from "./package-privacy.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
assertPackageOutputAbsent(root);
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

const stagedAdditions = execFileSync(
  "git",
  ["diff", "--cached", "--diff-filter=A", "--name-only", "-z"],
  { cwd: root, encoding: "utf8" }
).split("\0").filter(Boolean);
const uncoveredStaged = findUncoveredPackInputs(stagedAdditions);
if (uncoveredStaged.length) {
  throw new Error(`pack source contains staged additions not excluded by the pack command: ${uncoveredStaged.join(", ")}`);
}

process.stdout.write(`Package inputs checked: ${untracked.length} untracked paths and ${stagedAdditions.length} staged additions are covered by explicit exclusions.\n`);
