/** @typedef {{ archivePath: string, sourcePath: string, policy: "git-blob" | "packager-package-json" }} AppAsarFile */

const entries = [
  ["package.json", "package.json", "packager-package-json"],
  ["LICENSE", "LICENSE", "git-blob"],
  ["src/main.mjs", "src/main.mjs", "git-blob"],
  ["src/preload.mjs", "src/preload.mjs", "git-blob"],
  ["src/server.mjs", "src/server.mjs", "git-blob"],
  ["src/agent-surface.mjs", "src/agent-surface.mjs", "git-blob"],
  ["src/fenbi-api.mjs", "src/fenbi-api.mjs", "git-blob"],
  ["src/datasets.mjs", "src/datasets.mjs", "git-blob"],
  ["src/naoku.mjs", "src/naoku.mjs", "git-blob"],
  ["src/saduck.mjs", "src/saduck.mjs", "git-blob"],
  ["src/sync.mjs", "src/sync.mjs", "git-blob"],
  ["ui/index.html", "ui/index.html", "git-blob"],
  ["ui/app.js", "ui/app.js", "git-blob"],
  ["ui/style.css", "ui/style.css", "git-blob"],
  ["mcp/server.mjs", "mcp/server.mjs", "git-blob"],
  ["skills/outputs-and-privacy.md", "skills/outputs-and-privacy.md", "git-blob"],
  ["skills/tiku-lookup.md", "skills/tiku-lookup.md", "git-blob"],
  ["skills/naoku-attribution.md", "skills/naoku-attribution.md", "git-blob"],
  ["skills/sync-and-status.md", "skills/sync-and-status.md", "git-blob"],
  ["skills/saduck-data.md", "skills/saduck-data.md", "git-blob"],
].map(([archivePath, sourcePath, policy]) => Object.freeze({ archivePath, sourcePath, policy }));

/** @type {readonly AppAsarFile[]} */
export const APP_ASAR_MANIFEST = Object.freeze(entries);

export const PACKAGER_PACKAGE_JSON_POLICY = Object.freeze({
  version: "20.3.0",
  removeFields: Object.freeze([
    "devDependencies",
    "scripts",
    "workspaces",
    "packageManager",
    "resolutions",
    "overrides",
    "pnpm",
    "private",
    "publishConfig",
    "devEngines",
    "jest",
    "eslintConfig",
    "prettier",
    "browserslist",
    "lint-staged",
    "nano-staged",
    "husky",
    "commitlint",
    "mocha",
    "ava",
    "nyc",
    "c8",
    "tap",
    "xo",
    "standard",
  ]),
});

export function applyPackagerPackageJsonPolicy(packageJson) {
  const result = { ...packageJson };
  for (const field of PACKAGER_PACKAGE_JSON_POLICY.removeFields) delete result[field];
  return result;
}
