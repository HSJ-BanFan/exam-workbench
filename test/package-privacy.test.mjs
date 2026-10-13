import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  findMissingPackIgnores,
  findPrivatePackagePaths,
  findUncoveredPackInputs,
  findUntrackedPackagedPaths,
  listProductionPackageRoots,
  isPrivatePackagePath,
} from "../scripts/package-privacy.mjs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("pack command explicitly ignores local config, session, and local JSON files", () => {
  assert.deepEqual(findMissingPackIgnores(packageJson.scripts.pack), []);
  assert.match(packageJson.scripts.pack, /node scripts\/check-package-inputs\.mjs/);
});

test("package audit rejects private basenames at any depth", () => {
  assert.deepEqual(findPrivatePackagePaths([
    "config.json",
    "nested/session.json",
    "resources/saduck-session.json",
    "nested/settings.local.json",
  ]), [
    "config.json",
    "nested/session.json",
    "resources/saduck-session.json",
    "nested/settings.local.json",
  ]);
});

test("package audit allows ordinary app files", () => {
  for (const value of ["package.json", "src/config.mjs", "src/session-store.mjs", "ui/settings.js"]) {
    assert.equal(isPrivatePackagePath(value), false);
  }
});

test("package input guard blocks untracked study data and keeps covered build inputs", () => {
  assert.deepEqual(findUncoveredPackInputs([
    "node_modules/@electron/asar/index.js",
    "dist/exam-workbench-win32-x64.zip",
    ".selftest/window.png",
    "config.json",
    "nested/settings.local.json",
    "CONFIG.json",
    "data/history.json",
    "考公脑库/20-考点/Synthetic.md",
  ]), ["CONFIG.json", "data/history.json", "考公脑库/20-考点/Synthetic.md"]);
});

test("packaged source audit detects paths missing from the checked-in tree", () => {
  assert.deepEqual(findUntrackedPackagedPaths([
    "src/main.mjs",
    "data/history.json",
    "考公脑库/20-考点/Synthetic.md",
    "node_modules/runtime/index.js",
    "node_modules/unlisted/index.js",
  ], ["src/main.mjs"], ["node_modules/runtime"]), [
    "data/history.json",
    "考公脑库/20-考点/Synthetic.md",
    "node_modules/unlisted/index.js",
  ]);
});

test("production package roots exclude development-only dependencies", () => {
  assert.deepEqual(listProductionPackageRoots({
    packages: {
      "": {},
      "node_modules/runtime": {},
      "node_modules/optional-runtime": { optional: true },
      "node_modules/dev-tool": { dev: true },
      "node_modules/dev-optional-tool": { dev: true, optional: true, devOptional: true },
    },
  }), ["node_modules/runtime", "node_modules/optional-runtime"]);
});
