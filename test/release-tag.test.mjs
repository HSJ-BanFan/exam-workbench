import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateReleaseTag } from "../scripts/release-tag.mjs";

test("release tag validator accepts a matching version", () => {
  assert.equal(validateReleaseTag("v0.3.0", "0.3.0"), "v0.3.0");
  assert.equal(validateReleaseTag("v1.2.3-rc.1+build.4", "1.2.3-rc.1+build.4"), "v1.2.3-rc.1+build.4");
});

test("release tag validator rejects unsafe or non-version refs", () => {
  for (const tag of [
    "",
    "v0.3.0/other",
    'v0.3.0"; Write-Output injected #',
    "v0.3.0`nWrite-Output injected",
    "v01.3.0",
    "v1.2.3-01",
  ]) {
    assert.throws(() => validateReleaseTag(tag, "0.3.0"), /v-prefixed semantic version/);
  }
});

test("release tag validator rejects a valid version that differs from the package", () => {
  assert.throws(() => validateReleaseTag("v0.3.1", "0.3.0"), /match package.json version/);
});

test("tag validation writes only a validated tag to the GitHub output file", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exam-workbench-release-tag-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "github-output.txt");
  const scriptPath = fileURLToPath(new URL("../scripts/validate-release-tag.mjs", import.meta.url));
  const valid = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: "v0.3.0", GITHUB_OUTPUT: outputPath },
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(fs.readFileSync(outputPath, "utf8"), "release_tag=v0.3.0\n");

  fs.rmSync(outputPath);
  const invalid = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: "v0.3.0\nrelease_tag=evil", GITHUB_OUTPUT: outputPath },
  });
  assert.notEqual(invalid.status, 0);
  assert.equal(fs.existsSync(outputPath), false, "unvalidated ref must not be written to GitHub outputs");
});
