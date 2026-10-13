import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPackageOutputAbsent,
  findMissingPackIgnores,
  findPrivatePackagePaths,
  findUncoveredPackInputs,
  findUntrackedPackagedPaths,
  isPrivatePackagePath,
} from "../scripts/package-privacy.mjs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const require = createRequire(new URL("../package.json", import.meta.url));
const { createPackage } = require("@electron/asar");

test("pack command explicitly ignores local config, session, and local JSON files", () => {
  assert.deepEqual(findMissingPackIgnores(packageJson.scripts.pack), []);
  assert.match(packageJson.scripts.pack, /node scripts\/check-package-inputs\.mjs/);
  assert.doesNotMatch(packageJson.scripts.pack, /--overwrite(?:\s|$)/);
});

test("package preflight refuses an existing output without changing its contents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exam-workbench-package-output-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.doesNotThrow(() => assertPackageOutputAbsent(root));

  const outputDir = path.join(root, "dist", "exam-workbench-win32-x64");
  fs.mkdirSync(outputDir, { recursive: true });
  const sentinel = path.join(outputDir, "synthetic-sentinel.txt");
  fs.writeFileSync(sentinel, "synthetic data\n", "utf8");
  assert.throws(() => assertPackageOutputAbsent(root), /refusing to overwrite/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "synthetic data\n");
});

test("package preflight rejects staged study data that git no longer lists as untracked", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exam-workbench-package-staged-input-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scriptsDir = path.join(root, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of ["check-package-inputs.mjs", "package-privacy.mjs"]) {
    fs.copyFileSync(new URL("../scripts/" + name, import.meta.url), path.join(scriptsDir, name));
  }
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson, null, 2) + "\n", "utf8");
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Synthetic Test"]);
  git(["config", "user.email", "synthetic@example.invalid"]);
  git(["add", "package.json", "scripts"]);
  git(["commit", "-m", "synthetic package preflight baseline"]);

  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "history.json"), "{\"synthetic\":true}\n", "utf8");
  git(["add", "data/history.json"]);
  const script = path.join(scriptsDir, "check-package-inputs.mjs");
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /staged additions not excluded/);
  assert.match(result.stderr, /data\/history\.json/);
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
    "node_modules/runtime/injected-study-data.json",
    "node_modules/unlisted/index.js",
    "node_modules/.package-lock.json",
  ], ["src/main.mjs"]), [
    "data/history.json",
    "考公脑库/20-考点/Synthetic.md",
    "node_modules/runtime/index.js",
    "node_modules/runtime/injected-study-data.json",
    "node_modules/unlisted/index.js",
    "node_modules/.package-lock.json",
  ]);
});

test("packaged source audit rejects study data inside any dependency directory", () => {
  assert.deepEqual(findUntrackedPackagedPaths([
    "node_modules/runtime/user-study-data.md",
    "node_modules/runtime/config.json",
  ], []), [
    "node_modules/runtime/user-study-data.md",
    "node_modules/runtime/config.json",
  ]);
});

test("package privacy verifier inspects a synthetic app.asar", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exam-workbench-package-verifier-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appDir = path.join(root, "app");
  const packageDir = path.join(root, "package");
  fs.mkdirSync(path.join(appDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(packageDir, "resources"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "package.json"), "{}\n");
  fs.writeFileSync(path.join(appDir, "src", "main.mjs"), "export {};\n");
  await createPackage(appDir, path.join(packageDir, "resources", "app.asar"));

  const verifier = fileURLToPath(new URL("../scripts/verify-package-privacy.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [verifier, packageDir], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status": "passed"/);
});

test("package privacy verifier rejects private and untracked files in app.asar", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exam-workbench-package-verifier-negative-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const verifier = fileURLToPath(new URL("../scripts/verify-package-privacy.mjs", import.meta.url));
  const checkout = fileURLToPath(new URL("../", import.meta.url));

  for (const scenario of [
    { name: "study-data", entries: { "data/history.json": "{\"synthetic\":true}\n" }, expected: /not tracked by this checkout/ },
    { name: "credential", entries: { "nested/session.json": "{\"synthetic\":true}\n" }, expected: /private local files found in package/ },
    { name: "npm-generated-lock", entries: { "node_modules/.package-lock.json": "{\"synthetic\":true}\n" }, expected: /not tracked by this checkout/ },
  ]) {
    const appDir = path.join(root, scenario.name + "-app");
    const packageDir = path.join(root, scenario.name + "-package");
    fs.mkdirSync(path.join(packageDir, "resources"), { recursive: true });
    fs.mkdirSync(path.join(appDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(appDir, "package.json"), "{}\n");
    fs.writeFileSync(path.join(appDir, "src", "main.mjs"), "export {};\n");
    for (const [relativePath, contents] of Object.entries(scenario.entries)) {
      const filePath = path.join(appDir, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents);
    }
    await createPackage(appDir, path.join(packageDir, "resources", "app.asar"));
    const result = spawnSync(process.execPath, [verifier, packageDir], {
      cwd: checkout,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, scenario.name + " must fail privacy verification");
    assert.match(result.stderr, scenario.expected);
  }
});
