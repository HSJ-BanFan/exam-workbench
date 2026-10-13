import fs from "node:fs";

const PRIVATE_BASENAMES = new Set(["config.json", "session.json", "saduck-session.json"]);
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
