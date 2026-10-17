import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(checkoutRoot, "package.json"));
const { createPackage } = require("@electron/asar");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sourceFromHead(relativePath) {
  return execFileSync("git", ["show", `HEAD:${relativePath}`], { cwd: checkoutRoot, encoding: "utf8" });
}

async function assertLegacyRejects(t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exam-workbench-package-red-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist", "exam-workbench-win32-x64", "resources"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
  fs.writeFileSync(path.join(root, "package.json"), sourceFromHead("package.json"));
  fs.writeFileSync(path.join(root, "LICENSE"), "Synthetic license\n");
  fs.writeFileSync(path.join(root, "src", "main.mjs"), "export const main = 'HEAD bytes';\n");
  fs.writeFileSync(path.join(root, "src", "other.mjs"), "export const other = true;\n");
  if (scenario === "extra-tracked") fs.writeFileSync(path.join(root, "src", "unused.mjs"), "tracked extra\n");
  fs.writeFileSync(path.join(root, "scripts", "package-privacy.mjs"), sourceFromHead("scripts/package-privacy.mjs"));
  fs.writeFileSync(path.join(root, "scripts", "verify-package-privacy.mjs"), sourceFromHead("scripts/verify-package-privacy.mjs"));
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Synthetic Test"]);
  git(root, ["config", "user.email", "synthetic@example.invalid"]);
  git(root, ["add", ".gitignore", "package.json", "LICENSE", "src", "scripts"]);
  git(root, ["commit", "-m", "synthetic package baseline"]);

  const packageDir = path.join(root, "dist", "exam-workbench-win32-x64");
  const appDir = path.join(root, "app");
  const archivePath = path.join(packageDir, "resources", "app.asar");
  fs.mkdirSync(appDir, { recursive: true });
  for (const relative of git(root, ["ls-files", "-z"]).split("\0").filter(Boolean)) {
    if (scenario === "missing" && relative === "src/main.mjs") continue;
    let bytes = fs.readFileSync(path.join(root, relative));
    if (scenario === "tampered" && relative === "src/main.mjs") bytes = Buffer.from("export const main = 'tampered';\n");
    const destination = path.join(appDir, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  await createPackage(appDir, archivePath);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "verify-package-privacy.mjs"), packageDir], {
    cwd: root,
    env: { ...process.env, NODE_PATH: path.join(checkoutRoot, "node_modules") },
    encoding: "utf8",
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0, `${scenario}: legacy verifier accepted the invalid archive\n${result.stdout}`);
}

test("legacy verifier rejects tampered archive bytes", async (t) => assertLegacyRejects(t, "tampered"));
test("legacy verifier requires every tracked app file", async (t) => assertLegacyRejects(t, "missing"));
test("legacy verifier rejects extra tracked app files", async (t) => assertLegacyRejects(t, "extra-tracked"));
