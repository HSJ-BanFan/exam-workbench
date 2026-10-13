import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { findMissingPackIgnores, findPrivatePackagePaths, isPrivatePackagePath } from "../scripts/package-privacy.mjs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("pack command explicitly ignores local config, session, and local JSON files", () => {
  assert.deepEqual(findMissingPackIgnores(packageJson.scripts.pack), []);
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
