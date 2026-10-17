import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_ASAR_MANIFEST, applyPackagerPackageJsonPolicy, PACKAGER_PACKAGE_JSON_POLICY } from "../scripts/package-asar-manifest.mjs";
import { createPackagePlan, pack, parsePackArgs, verifyPackage } from "../scripts/pack.mjs";

const checkoutRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const { createPackage } = require("@electron/asar");
const packageJson = JSON.parse(fs.readFileSync(path.join(checkoutRoot, "package.json"), "utf8"));
const installedElectronVersion = JSON.parse(
  fs.readFileSync(path.join(checkoutRoot, "node_modules", "electron", "package.json"), "utf8"),
).version;
const syntheticPackageJson = {
  name: "exam-workbench",
  version: "0.0.0",
  type: "module",
  main: "src/main.mjs",
  private: true,
  scripts: { test: "synthetic" },
  devDependencies: { "synthetic-only": "1.0.0" },
  customManifestField: "retained",
};

test("npm pack uses one package command and accepts an exact output directory", () => {
  assert.equal(packageJson.scripts.pack, "node scripts/pack.mjs");
  assert.equal(parsePackArgs([], checkoutRoot), path.join(checkoutRoot, "dist", "exam-workbench-win32-x64"));
  const requested = path.join(os.tmpdir(), "synthetic-build", "exam-workbench-win32-x64");
  assert.equal(parsePackArgs(["--out", requested], checkoutRoot), requested);
  assert.equal(parsePackArgs([`--out=${requested}`], checkoutRoot), requested);
  assert.throws(() => parsePackArgs(["--unknown"], checkoutRoot), /unknown pack option/);
});

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function createSyntheticCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exam-workbench-package-plan-"));
  const packagerDir = path.join(root, "node_modules", "@electron", "packager");
  fs.mkdirSync(packagerDir, { recursive: true });
  fs.writeFileSync(path.join(packagerDir, "package.json"), JSON.stringify({ version: "20.3.0" }));
  const electronDir = path.join(root, "node_modules", "electron");
  fs.mkdirSync(electronDir, { recursive: true });
  fs.writeFileSync(path.join(electronDir, "package.json"), JSON.stringify({ version: installedElectronVersion }));
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(syntheticPackageJson, null, 2)}\n`);
  for (const spec of APP_ASAR_MANIFEST) {
    if (spec.sourcePath === "package.json") continue;
    const filePath = path.join(root, ...spec.sourcePath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `synthetic fixture for ${spec.archivePath}\n`);
  }
  const extraPath = path.join(root, "test", "extra.mjs");
  fs.mkdirSync(path.dirname(extraPath), { recursive: true });
  fs.writeFileSync(extraPath, "export const fixture = 'tracked extra';\n");

  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Synthetic Test"]);
  git(root, ["config", "user.email", "synthetic@example.invalid"]);
  git(root, ["add", "package.json", "LICENSE", "src", "ui", "mcp", "skills", "test/extra.mjs"]);
  git(root, ["commit", "-m", "synthetic package baseline"]);
  return root;
}

function installSyntheticPackager(root) {
  const cliPath = path.join(root, "node_modules", "@electron", "packager", "bin", "electron-packager.mjs");
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, `import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(${JSON.stringify(path.join(checkoutRoot, "package.json"))});
const { createPackage } = require("@electron/asar");
const packagerRoot = path.join(${JSON.stringify(checkoutRoot)}, "node_modules", "@electron", "packager");
const { defaultSanitizePackageJson } = await import(pathToFileURL(path.join(packagerRoot, "dist", "sanitize-package-json.js")));
const args = process.argv.slice(2);
const sourceRoot = args[0];
const appName = args[1];
const outputRoot = args.find((value) => value.startsWith("--out=")).slice("--out=".length);
const platform = args.find((value) => value.startsWith("--platform=")).slice("--platform=".length);
const arch = args.find((value) => value.startsWith("--arch=")).slice("--arch=".length);
const electronVersionArgument = args.find((value) => value.startsWith("--electron-version="));
if (!electronVersionArgument) throw new Error("Cannot find module 'electron/package.json'");
const electronVersion = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(root)}, "node_modules", "electron", "package.json"), "utf8")).version;
if (electronVersionArgument !== "--electron-version=" + electronVersion) throw new Error("Packager received an Electron version that does not match the installed package");
const packageDir = path.join(outputRoot, appName + "-" + platform + "-" + arch);
const appDir = path.join(path.dirname(packageDir), ".synthetic-packager-app");
fs.cpSync(sourceRoot, appDir, { recursive: true });
const packageJsonPath = path.join(appDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
fs.writeFileSync(packageJsonPath, JSON.stringify(defaultSanitizePackageJson(packageJson), null, 2) + "\\n");
fs.mkdirSync(path.join(packageDir, "resources"), { recursive: true });
await createPackage(appDir, path.join(packageDir, "resources", "app.asar"));
fs.rmSync(appDir, { recursive: true, force: true });
process.stdout.write("Wrote new app to: " + packageDir + "\\n");
`);
}

async function createArchive(plan, packageDir, mutate = () => {}) {
  const appDir = path.join(packageDir, "synthetic-app");
  fs.mkdirSync(path.join(packageDir, "resources"), { recursive: true });
  for (const entry of plan.entries) {
    if (mutate({ kind: "omit", entry }) === true) continue;
    let bytes = entry.spec.policy === "packager-package-json"
      ? Buffer.from(`${JSON.stringify(entry.expectedPackageJson, null, 2)}\n`)
      : entry.expectedBytes;
    const mutatedBytes = mutate({ kind: "payload", entry, bytes });
    if (Buffer.isBuffer(mutatedBytes) || typeof mutatedBytes === "string") bytes = mutatedBytes;
    const filePath = path.join(appDir, ...entry.spec.archivePath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
  }
  if (mutate({ kind: "extra", appDir })) {
    const extraPath = path.join(appDir, "test", "extra.mjs");
    fs.mkdirSync(path.dirname(extraPath), { recursive: true });
    fs.writeFileSync(extraPath, "export const fixture = 'tracked extra';\n");
  }
  await createPackage(appDir, path.join(packageDir, "resources", "app.asar"));
}

test("manifest is the sole immutable 20-entry ASAR inventory", () => {
  assert.equal(APP_ASAR_MANIFEST.length, 20);
  assert.equal(new Set(APP_ASAR_MANIFEST.map((entry) => entry.archivePath)).size, 20);
  assert.equal(new Set(APP_ASAR_MANIFEST.map((entry) => entry.sourcePath)).size, 20);
  assert.ok(APP_ASAR_MANIFEST.every(Object.isFrozen));
  assert.ok(Object.isFrozen(APP_ASAR_MANIFEST));
  assert.deepEqual(APP_ASAR_MANIFEST.filter((entry) => entry.policy !== "git-blob").map((entry) => entry.archivePath), ["package.json"]);
});

test("package.json policy matches the installed Electron Packager sanitizer", async () => {
  const sanitizerPath = path.join(checkoutRoot, "node_modules", "@electron", "packager", "dist", "sanitize-package-json.js");
  const { defaultSanitizePackageJson } = await import(pathToFileURL(sanitizerPath));
  const fixture = Object.fromEntries([
    ...PACKAGER_PACKAGE_JSON_POLICY.removeFields.map((field) => [field, { synthetic: true }]),
    ["name", "synthetic"],
    ["customManifestField", "retained"],
  ]);
  const expected = applyPackagerPackageJsonPolicy(fixture);
  assert.deepEqual(defaultSanitizePackageJson({ ...fixture }), expected);
  assert.equal(JSON.parse(fs.readFileSync(path.join(checkoutRoot, "node_modules", "@electron", "packager", "package.json"), "utf8")).version, "20.3.0");
});

test("runtime dependency sections stay empty until their package files are inventoried", (t) => {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    assert.deepEqual(packageJson[field] ?? {}, {}, `${field} requires a trusted runtime file inventory`);
  }
  for (const field of ["bundleDependencies", "bundledDependencies"]) {
    assert.deepEqual(packageJson[field] ?? [], [], `${field} requires a trusted runtime file inventory`);
  }

  const mapping = new Map([
    ["dependencies", { "synthetic-runtime": "1.0.0" }],
    ["optionalDependencies", { "synthetic-runtime": "1.0.0" }],
    ["peerDependencies", { "synthetic-runtime": "1.0.0" }],
    ["bundleDependencies", ["synthetic-runtime"]],
    ["bundledDependencies", ["synthetic-runtime"]],
  ]);

  for (const [field, value] of mapping) {
    const root = createSyntheticCheckout();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const manifestPath = path.join(root, "package.json");
    const syntheticManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    syntheticManifest[field] = value;
    fs.writeFileSync(manifestPath, `${JSON.stringify(syntheticManifest, null, 2)}\n`);
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-m", `declare synthetic ${field}`]);
    assert.throws(
      () => createPackagePlan({ checkoutRoot: root }),
      new RegExp(`package\\.json ${field} requires an explicit runtime dependency file inventory`),
      field,
    );
  }
});

test("package plan stages pinned HEAD blobs and accepts an exact synthetic archive", async (t) => {
  const root = createSyntheticCheckout();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = createPackagePlan({ checkoutRoot: root });
  assert.match(plan.commitSha, /^[0-9a-f]{40}$/);
  assert.equal(plan.entries.length, APP_ASAR_MANIFEST.length);
  assert.ok(plan.entries.every((entry) => entry.expectedBytes.length > 0));

  const packageDir = path.join(root, "valid-package");
  await createArchive(plan, packageDir);
  assert.deepEqual(verifyPackage({ packageDir, plan, checkoutRoot: root }), {
    outputDir: packageDir,
    commitSha: plan.commitSha,
    appAsarEntryCount: APP_ASAR_MANIFEST.length,
  });
});

test("pack passes the installed Electron version and excludes untracked and extra tracked files", (t) => {
  const root = createSyntheticCheckout();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  installSyntheticPackager(root);
  fs.writeFileSync(path.join(root, "study.local.json"), "synthetic private marker\n");
  const stagedStudyFile = path.join(root, "test", "staged-notes.json");
  fs.writeFileSync(stagedStudyFile, "synthetic staged marker\n");
  git(root, ["add", "test/staged-notes.json"]);

  const outputDir = path.join(root, "build", "exam-workbench-win32-x64");
  const result = pack({ checkoutRoot: root, outputDir });
  assert.equal(result.commitSha, git(root, ["rev-parse", "HEAD"]));
  assert.equal(result.appAsarEntryCount, APP_ASAR_MANIFEST.length);
  assert.equal(fs.existsSync(path.join(outputDir, "resources", "app.asar")), true);
});

test("package verifier rejects tampered tracked archive bytes", async (t) => {
  const root = createSyntheticCheckout();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = createPackagePlan({ checkoutRoot: root });
  const packageDir = path.join(root, "tampered-package");
  await createArchive(plan, packageDir, ({ kind, entry, bytes }) => {
    if (kind === "payload" && entry.spec.archivePath === "src/main.mjs") return Buffer.from("tampered synthetic bytes\n");
    return kind === "omit" ? false : bytes;
  });
  assert.throws(() => verifyPackage({ packageDir, plan, checkoutRoot: root }), /payload differs from HEAD blob: src\/main\.mjs/);
});

test("package verifier rejects a missing required ASAR path", async (t) => {
  const root = createSyntheticCheckout();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = createPackagePlan({ checkoutRoot: root });
  const packageDir = path.join(root, "missing-package");
  await createArchive(plan, packageDir, ({ kind, entry }) => kind === "omit" && entry.spec.archivePath === "skills/tiku-lookup.md");
  assert.throws(() => verifyPackage({ packageDir, plan, checkoutRoot: root }), /missing: skills\/tiku-lookup\.md/);
});

test("package verifier rejects an extra tracked path in app.asar", async (t) => {
  const root = createSyntheticCheckout();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = createPackagePlan({ checkoutRoot: root });
  assert.equal(git(root, ["ls-files", "--error-unmatch", "test/extra.mjs"]), "test/extra.mjs");
  const packageDir = path.join(root, "extra-package");
  await createArchive(plan, packageDir, ({ kind }) => kind === "extra");
  assert.throws(() => verifyPackage({ packageDir, plan, checkoutRoot: root }), /extra: test\/extra\.mjs/);
});

test("package plan rejects missing, modified, symlinked, and non-blob manifest sources", (t) => {
  const scenarios = [
    {
      name: "missing",
      expected: /manifest source is missing from checkout: src\/main\.mjs/,
      mutate(root) { fs.rmSync(path.join(root, "src", "main.mjs")); },
    },
    {
      name: "modified",
      expected: /manifest source differs from HEAD: src\/main\.mjs/,
      mutate(root) { fs.writeFileSync(path.join(root, "src", "main.mjs"), "modified synthetic bytes\n"); },
    },
    {
      name: "symlinked",
      expected: /manifest source is not a regular file: src\/main\.mjs/,
      mutate(root) {
        fs.rmSync(path.join(root, "src", "main.mjs"));
        fs.symlinkSync(path.join(root, "src", "preload.mjs"), path.join(root, "src", "main.mjs"), "file");
      },
    },
    {
      name: "non-blob",
      expected: /manifest source is not a Git blob: src\/main\.mjs/,
      mutate(root) {
        const source = path.join(root, "src", "main.mjs");
        fs.rmSync(source);
        fs.mkdirSync(source);
        fs.writeFileSync(path.join(source, "nested.mjs"), "synthetic tree entry\n");
        git(root, ["add", "-A"]);
        git(root, ["commit", "-m", "replace manifest blob with tree"]);
      },
    },
  ];

  for (const scenario of scenarios) {
    const root = createSyntheticCheckout();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    scenario.mutate(root);
    assert.throws(() => createPackagePlan({ checkoutRoot: root }), scenario.expected, scenario.name);
  }
});

test("pack refuses an existing output and leaves its contents intact", (t) => {
  const root = createSyntheticCheckout();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputDir = path.join(root, "build", "exam-workbench-win32-x64");
  fs.mkdirSync(outputDir, { recursive: true });
  const sentinel = path.join(outputDir, "synthetic-sentinel.txt");
  fs.writeFileSync(sentinel, "preserve me\n");
  assert.throws(() => pack({ checkoutRoot: root, outputDir }), /refusing to overwrite/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve me\n");
});

test("package verifier rejects private files outside app.asar", async (t) => {
  const root = createSyntheticCheckout();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = createPackagePlan({ checkoutRoot: root });
  const packageDir = path.join(root, "private-package");
  await createArchive(plan, packageDir);
  const privateNames = ["config.json", "SESSION.JSON", "saduck-session.json", "study.local.json"];
  for (const name of privateNames) {
    const privatePath = path.join(packageDir, "local", name);
    fs.mkdirSync(path.dirname(privatePath), { recursive: true });
    fs.writeFileSync(privatePath, "synthetic private marker\n");
  }
  assert.throws(() => verifyPackage({ packageDir, plan, checkoutRoot: root }), /private local files found in package/);
});
