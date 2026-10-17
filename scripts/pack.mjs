import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_ASAR_MANIFEST, applyPackagerPackageJsonPolicy, PACKAGER_PACKAGE_JSON_POLICY } from "./package-asar-manifest.mjs";

const EXPECTED_OUTPUT_NAME = "exam-workbench-win32-x64";
const PACKAGER_NAME = "exam-workbench";
const thisFile = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(thisFile);
const moduleRequire = createRequire(import.meta.url);

function gitText(checkoutRoot, args) {
  return execFileSync("git", args, { cwd: checkoutRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitBuffer(checkoutRoot, args) {
  return execFileSync("git", args, { cwd: checkoutRoot, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
}

function asarModule() {
  return moduleRequire("@electron/asar");
}

function assertPackagerVersion(checkoutRoot) {
  const packagePath = path.join(checkoutRoot, "node_modules", "@electron", "packager", "package.json");
  const installed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (installed.version !== PACKAGER_PACKAGE_JSON_POLICY.version) {
    throw new Error(`unsupported Electron Packager version ${installed.version}; expected ${PACKAGER_PACKAGE_JSON_POLICY.version}`);
  }
}

const RUNTIME_DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

function assertNoUnmanifestedRuntimeDependencies(packageJson) {
  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    const value = packageJson[field];
    const empty = value == null || value === false || value === ""
      || (Array.isArray(value) && value.length === 0)
      || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
    if (!empty) throw new Error(`package.json ${field} requires an explicit runtime dependency file inventory`);
  }
}

function readTreeEntry(checkoutRoot, commitSha, sourcePath) {
  const output = gitBuffer(checkoutRoot, ["ls-tree", "-z", "--full-tree", commitSha, "--", sourcePath]);
  const entries = output.toString("utf8").split("\0").filter(Boolean);
  const entry = entries.find((value) => value.slice(value.indexOf("\t") + 1) === sourcePath);
  if (!entry) return null;
  const tab = entry.indexOf("\t");
  const [mode, type, objectId] = entry.slice(0, tab).split(" ");
  return { mode, type, objectId };
}

function readWorkingFile(checkoutRoot, sourcePath, expectedBlob) {
  const absolutePath = path.join(checkoutRoot, ...sourcePath.split("/"));
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`manifest source is missing from checkout: ${sourcePath}`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`manifest source is not a regular file: ${sourcePath}`);
  const bytes = fs.readFileSync(absolutePath);
  const actualBlob = execFileSync("git", ["hash-object", `--path=${sourcePath}`, "--stdin"], {
    cwd: checkoutRoot,
    input: bytes,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  if (actualBlob !== expectedBlob) throw new Error(`manifest source differs from HEAD: ${sourcePath}`);
}

export function createPackagePlan({ checkoutRoot }) {
  const root = path.resolve(checkoutRoot);
  const topLevel = path.resolve(gitText(root, ["rev-parse", "--show-toplevel"]));
  if (topLevel !== root) throw new Error(`checkout root does not match Git top level: ${topLevel}`);

  assertPackagerVersion(root);
  const commitSha = gitText(root, ["rev-parse", "HEAD"]);
  const entries = APP_ASAR_MANIFEST.map((spec) => {
    const treeEntry = readTreeEntry(root, commitSha, spec.sourcePath);
    if (!treeEntry) throw new Error(`manifest source is absent from HEAD: ${spec.sourcePath}`);
    if (treeEntry.type !== "blob") throw new Error(`manifest source is not a Git blob: ${spec.sourcePath}`);
    if (treeEntry.mode === "120000") throw new Error(`manifest source is a Git symlink: ${spec.sourcePath}`);

    const expectedBytes = gitBuffer(root, ["cat-file", "blob", treeEntry.objectId]);
    readWorkingFile(root, spec.sourcePath, treeEntry.objectId);
    let expectedPackageJson = null;
    if (spec.policy === "packager-package-json") {
      let sourcePackageJson;
      try {
        sourcePackageJson = JSON.parse(expectedBytes.toString("utf8"));
      } catch (error) {
        throw new Error(`HEAD package.json is invalid: ${error.message}`);
      }
      assertNoUnmanifestedRuntimeDependencies(sourcePackageJson);
      expectedPackageJson = applyPackagerPackageJsonPolicy(sourcePackageJson);
    }
    return Object.freeze({ spec, blob: treeEntry.objectId, expectedBytes, expectedPackageJson });
  });

  return Object.freeze({ commitSha, entries: Object.freeze(entries) });
}

function writeStage(plan, stageRoot) {
  for (const entry of plan.entries) {
    const target = path.join(stageRoot, ...entry.spec.archivePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.expectedBytes);
  }
}

function listRegularFiles(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listRegularFiles(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function flattenAsarFiles(directory, prefix = "") {
  const files = [];
  for (const [name, entry] of Object.entries(directory.files ?? {})) {
    const archivePath = prefix ? `${prefix}/${name}` : name;
    if (entry.link !== undefined) throw new Error(`app.asar contains a link entry: ${archivePath}`);
    if (entry.files !== undefined) files.push(...flattenAsarFiles(entry, archivePath));
    else files.push(archivePath);
  }
  return files;
}

export function verifyPackage({ packageDir, plan, checkoutRoot }) {
  const packageRoot = path.resolve(packageDir);
  if (!fs.statSync(packageRoot).isDirectory()) throw new Error(`packaged app directory missing: ${packageRoot}`);

  const externalFiles = listRegularFiles(packageRoot).map((value) => value.replaceAll("\\", "/"));
  const privatePaths = externalFiles.filter(isPrivatePackagePath);
  if (privatePaths.length) throw new Error(`private local files found in package: ${privatePaths.join(", ")}`);

  const archivePath = path.join(packageRoot, "resources", "app.asar");
  if (!fs.existsSync(archivePath)) throw new Error(`app.asar missing: ${archivePath}`);
  const { extractFile, getRawHeader } = asarModule();
  const archiveFiles = flattenAsarFiles(getRawHeader(archivePath).header);
  const expectedByPath = new Map(plan.entries.map((entry) => [entry.spec.archivePath, entry]));
  const actualPaths = new Set(archiveFiles);
  const missingPaths = [...expectedByPath.keys()].filter((value) => !actualPaths.has(value));
  const extraPaths = archiveFiles.filter((value) => !expectedByPath.has(value));
  if (missingPaths.length || extraPaths.length || actualPaths.size !== archiveFiles.length) {
    throw new Error(`app.asar path set mismatch; missing: ${missingPaths.join(", ") || "none"}; extra: ${extraPaths.join(", ") || "none"}`);
  }

  for (const entry of plan.entries) {
    const bytes = extractFile(archivePath, entry.spec.archivePath);
    if (entry.spec.policy === "packager-package-json") {
      let actualPackageJson;
      try {
        actualPackageJson = JSON.parse(bytes.toString("utf8"));
      } catch (error) {
        throw new Error(`packaged package.json is invalid: ${error.message}`);
      }
      if (!isDeepStrictEqual(actualPackageJson, entry.expectedPackageJson)) {
        throw new Error("packaged package.json does not match the pinned Packager sanitization policy");
      }
    } else if (!bytes.equals(entry.expectedBytes)) {
      throw new Error(`app.asar payload differs from HEAD blob: ${entry.spec.archivePath}`);
    }
  }

  return { outputDir: packageRoot, commitSha: plan.commitSha, appAsarEntryCount: archiveFiles.length };
}

function isPrivatePackagePath(value) {
  const basename = String(value).replaceAll("\\", "/").split("/").at(-1).toLowerCase();
  return basename === "config.json" || basename === "session.json" || basename === "saduck-session.json" || basename.endsWith(".local.json");
}

function pathExists(value) {
  try {
    fs.lstatSync(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function parsePackArgs(argv, checkoutRoot) {
  let outputDir = path.join(checkoutRoot, "dist", EXPECTED_OUTPUT_NAME);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--out requires an output directory");
      outputDir = path.resolve(argv[++index]);
    } else if (arg.startsWith("--out=")) {
      if (!arg.slice("--out=".length)) throw new Error("--out requires an output directory");
      outputDir = path.resolve(arg.slice("--out=".length));
    } else {
      throw new Error(`unknown pack option: ${arg}`);
    }
  }
  return path.resolve(outputDir);
}

export function pack({ checkoutRoot, outputDir }) {
  const root = path.resolve(checkoutRoot);
  const destination = path.resolve(outputDir);
  if (path.basename(destination) !== EXPECTED_OUTPUT_NAME) {
    throw new Error(`output directory must end in ${EXPECTED_OUTPUT_NAME}: ${destination}`);
  }
  if (pathExists(destination)) throw new Error(`package output already exists; refusing to overwrite: ${destination}`);

  const plan = createPackagePlan({ checkoutRoot: root });
  const outputParent = path.dirname(destination);
  fs.mkdirSync(outputParent, { recursive: true });
  const stageRoot = fs.mkdtempSync(path.join(outputParent, ".exam-workbench-stage-"));
  try {
    writeStage(plan, stageRoot);
    const electronVersion = JSON.parse(
      fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8"),
    ).version;
    if (typeof electronVersion !== "string" || !electronVersion) {
      throw new Error("installed Electron package does not declare a version");
    }
    const packagerCli = path.join(root, "node_modules", "@electron", "packager", "bin", "electron-packager.mjs");
    const packagerOutput = execFileSync(process.execPath, [
      packagerCli,
      stageRoot,
      PACKAGER_NAME,
      `--electron-version=${electronVersion}`,
      "--platform=win32",
      "--arch=x64",
      `--out=${outputParent}`,
      "--prune",
      "--asar",
    ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], windowsHide: true });

    process.stdout.write(packagerOutput);
    const outputLine = packagerOutput.match(/^Wrote new app to: (.+)$/m);
    if (!outputLine) throw new Error("Packager did not report exactly one generated app directory");
    const actualOutput = path.resolve(outputLine[1].trim());
    if (actualOutput !== destination) throw new Error(`Packager output mismatch: ${actualOutput}`);
    return verifyPackage({ packageDir: actualOutput, plan, checkoutRoot: root });
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function runCli(argv) {
  const checkoutRoot = path.resolve(scriptDirectory, "..");
  const outputDir = parsePackArgs(argv, checkoutRoot);
  const result = pack({ checkoutRoot, outputDir });
  process.stdout.write(`${JSON.stringify({ status: "passed", ...result }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Package operation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
