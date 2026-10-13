const SEMVER_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function validateReleaseTag(tag, packageVersion) {
  if (typeof tag !== "string" || !SEMVER_TAG.test(tag)) {
    throw new Error("Release tag must be a v-prefixed semantic version.");
  }
  if (typeof packageVersion !== "string" || tag.slice(1) !== packageVersion) {
    throw new Error("Release tag must match package.json version.");
  }
  return tag;
}
