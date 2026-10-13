import assert from "node:assert/strict";
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
  ]) {
    assert.throws(() => validateReleaseTag(tag, "0.3.0"), /v-prefixed semantic version/);
  }
});

test("release tag validator rejects a valid version that differs from the package", () => {
  assert.throws(() => validateReleaseTag("v0.3.1", "0.3.0"), /match package.json version/);
});
