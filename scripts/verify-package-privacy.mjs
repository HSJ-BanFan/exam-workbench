import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  findMissingPackIgnores,
  findPrivatePackagePaths,
  listProductionPackageRoots,
  findUncoveredPackInputs,
  findUntrackedPackagedPaths,
  listFiles,
} from "./package-privacy.mjs";

const [packageDirArg = "dist/exam-workbench-win32-x64"] = process.argv.slice(2);
const packageDir = path.resolve(packageDirArg);
if (!fs.statSync(packageDir).isDirectory()) throw new Error(`packaged app directory missing: ${packageDir}`);

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const missingIgnores = findMissingPackIgnores(packageJson.scripts?.pack ?? "");
if (missingIgnores.length) throw new Error(`pack command is missing private-file ignores: ${missingIgnores.join(", ")}`);
const root = process.cwd();
const untrackedInputs = execFileSync(
  "git",
  ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
  { cwd: root, encoding: "utf8" }
).split("\0").filter(Boolean);
const uncoveredInputs = findUncoveredPackInputs(untrackedInputs);
if (uncoveredInputs.length) {
  throw new Error(`pack source contains untracked files not excluded by the pack command: ${uncoveredInputs.join(", ")}`);
}

const archivePath = path.join(packageDir, "resources", "app.asar");
if (!fs.existsSync(archivePath)) throw new Error(`app.asar missing: ${archivePath}`);
const require = createRequire(path.resolve("package.json"));
const { listPackage } = require("@electron/asar");
const externalFiles = listFiles(packageDir).map((value) => value.replaceAll("\\", "/"));
const appFiles = listPackage(archivePath).map((value) => String(value).replaceAll("\\", "/"));
const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const productionPackageRoots = listProductionPackageRoots(packageLock);
const violations = findPrivatePackagePaths([...externalFiles, ...appFiles]);
if (violations.length) throw new Error(`private local files found in package: ${violations.join(", ")}`);
const untrackedPackagedFiles = findUntrackedPackagedPaths(appFiles, trackedFiles, productionPackageRoots);
if (untrackedPackagedFiles.length) {
  throw new Error(`package contains source files that are not tracked by this checkout: ${untrackedPackagedFiles.join(", ")}`);
}

process.stdout.write(JSON.stringify({
  status: "passed",
  packageDir,
  appAsarEntryCount: appFiles.length,
  checkedExternalFiles: externalFiles.length,
  requiredIgnoreRules: 4,
  privatePathViolations: 0,
  untrackedPackagedFiles: 0,
}, null, 2));
