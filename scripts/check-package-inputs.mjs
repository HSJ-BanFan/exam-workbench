import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertPackageOutputAbsent, findMissingPackIgnores, findUncoveredPackInputs } from "./package-privacy.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
assertPackageOutputAbsent(root);
const packageJson = JSON.parse(fs.readFileSync(`${root}/package.json`, "utf8"));
const missingIgnores = findMissingPackIgnores(packageJson.scripts?.pack ?? "");
if (missingIgnores.length) throw new Error(`pack command is missing private-file ignores: ${missingIgnores.join(", ")}`);

const trackedTree = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], { cwd: root, encoding: "utf8" });
const modifiedTrackedFiles = [];
for (const entry of trackedTree.split("\0").filter(Boolean)) {
  const tab = entry.indexOf("\t");
  if (tab < 0) continue;
  const [, type, expectedBlob] = entry.slice(0, tab).split(" ");
  if (type !== "blob") continue;
  const relativePath = entry.slice(tab + 1);
  const absolutePath = path.join(root, ...relativePath.split("/"));
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    modifiedTrackedFiles.push(relativePath);
    continue;
  }
  const actualBlob = execFileSync(
    "git",
    ["hash-object", `--path=${relativePath}`, "--stdin"],
    { cwd: root, input: fs.readFileSync(absolutePath), encoding: "utf8" }
  ).trim();
  if (actualBlob !== expectedBlob) modifiedTrackedFiles.push(relativePath);
}
if (modifiedTrackedFiles.length) {
  throw new Error(`pack source contains modified tracked files: ${modifiedTrackedFiles.slice(0, 5).join(", ")}`);
}

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

const stagedTrackedChanges = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "-z"],
  { cwd: root, encoding: "utf8" }
).split("\0").filter(Boolean);
if (stagedTrackedChanges.length) {
  throw new Error(`pack source has staged tracked changes: ${stagedTrackedChanges.slice(0, 5).join(", ")}`);
}

process.stdout.write(`Package inputs checked: ${untracked.length} untracked paths and ${stagedAdditions.length} staged additions are covered by explicit exclusions.\n`);
