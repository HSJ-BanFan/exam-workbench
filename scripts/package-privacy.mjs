import fs from "node:fs";
import path from "node:path";

const PRIVATE_BASENAMES = new Set(["config.json", "session.json", "saduck-session.json"]);
const PACK_IGNORED_ROOTS = new Set([".git", "node_modules", "dist", ".selftest"]);
const PACK_GENERATED_FILES = new Set(["node_modules/.package-lock.json"]);
const REQUIRED_PACK_IGNORES = [
  "config\\.json$",
  "session\\.json$",
  "saduck-session\\.json$",
  "\\.local\\.json$",
];

export function isPrivatePackagePath(value) {
  const basename = String(value).replaceAll("\\", "/").split("/").at(-1).toLowerCase();
  return PRIVATE_BASENAMES.has(basename) || basename.endsWith(".local.json");
}

export function findPrivatePackagePaths(values) {
  return values.map(String).filter(isPrivatePackagePath);
}

export function assertPackageOutputAbsent(root) {
  const outputDir = path.join(root, "dist", "exam-workbench-win32-x64");
  if (fs.existsSync(outputDir)) {
    throw new Error("package output already exists; refusing to overwrite: " + outputDir);
  }
}

function normalizePackagePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function findUncoveredPackInputs(values) {
  return values
    .map(normalizePackagePath)
    .filter((value) => {
      const basename = value.split("/").at(-1);
      const privateIgnoreMatches = PRIVATE_BASENAMES.has(basename) || basename.endsWith(".local.json");
      return value && !PACK_IGNORED_ROOTS.has(value.split("/")[0]) && !privateIgnoreMatches;
    });
}

export function listProductionPackageRoots(packageLock) {
  return Object.entries(packageLock?.packages ?? {})
    .filter(([packagePath, metadata]) =>
      packagePath.startsWith("node_modules/") && metadata?.dev !== true && metadata?.devOptional !== true
    )
    .map(([packagePath]) => packagePath);
}

export function listProductionPackageFiles(root, packageLock) {
  const files = new Set();
  const absoluteRoot = path.resolve(root);
  for (const packageRoot of listProductionPackageRoots(packageLock)) {
    const segments = packageRoot.split("/");
    if (!packageRoot.startsWith("node_modules/") || segments.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`invalid production package path in lockfile: ${packageRoot}`);
    }
    const packageDirectory = path.resolve(absoluteRoot, ...segments);
    const relative = path.relative(absoluteRoot, packageDirectory);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`production package path escapes the project root: ${packageRoot}`);
    }
    if (!fs.existsSync(packageDirectory) || !fs.statSync(packageDirectory).isDirectory()) continue;
    for (const file of listFiles(root, packageRoot)) files.add(normalizePackagePath(file));
  }
  return [...files];
}

export function findUntrackedPackagedPaths(values, trackedValues, productionPackageFiles = []) {
  const tracked = new Set(trackedValues.map(normalizePackagePath).map((value) => value.toLowerCase()));
  const allowedDependencyFiles = new Set(productionPackageFiles
    .map(normalizePackagePath)
    .map((value) => value.toLowerCase()));
  return values
    .map(normalizePackagePath)
    .filter((value) => {
      const normalized = value.toLowerCase();
      const productionDependency = allowedDependencyFiles.has(normalized);
      return value && !tracked.has(normalized) && !productionDependency && !PACK_GENERATED_FILES.has(normalized);
    });
}

export function findMissingPackIgnores(script) {
  return REQUIRED_PACK_IGNORES.filter((pattern) => !script.includes(`--ignore=${pattern}`));
}

export function listFiles(root, relative = "") {
  const directory = relative ? `${root}/${relative}` : root;
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}
