import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { findMissingPackIgnores, findPrivatePackagePaths, listFiles } from "./package-privacy.mjs";

const [packageDirArg = "dist/exam-workbench-win32-x64"] = process.argv.slice(2);
const packageDir = path.resolve(packageDirArg);
if (!fs.statSync(packageDir).isDirectory()) throw new Error(`packaged app directory missing: ${packageDir}`);

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const missingIgnores = findMissingPackIgnores(packageJson.scripts?.pack ?? "");
if (missingIgnores.length) throw new Error(`pack command is missing private-file ignores: ${missingIgnores.join(", ")}`);

const archivePath = path.join(packageDir, "resources", "app.asar");
if (!fs.existsSync(archivePath)) throw new Error(`app.asar missing: ${archivePath}`);
const require = createRequire(path.resolve("package.json"));
const { listPackage } = require("@electron/asar");
const externalFiles = listFiles(packageDir).map((value) => value.replaceAll("\\", "/"));
const appFiles = listPackage(archivePath).map((value) => String(value).replaceAll("\\", "/"));
const violations = findPrivatePackagePaths([...externalFiles, ...appFiles]);
if (violations.length) throw new Error(`private local files found in package: ${violations.join(", ")}`);

process.stdout.write(JSON.stringify({
  status: "passed",
  packageDir,
  appAsarEntryCount: appFiles.length,
  checkedExternalFiles: externalFiles.length,
  requiredIgnoreRules: 4,
  privatePathViolations: 0,
}, null, 2));
