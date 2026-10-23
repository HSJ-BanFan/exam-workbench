const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const NON_NUMERIC_IDENTIFIER = "[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*";
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_IDENTIFIER})`;
const BUILD_IDENTIFIER = "[0-9A-Za-z-]+";
const SEMVER_TAG = new RegExp(
  `^v${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?(?:\\+${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*)?$`
);

export function validateReleaseTag(tag, packageVersion) {
  if (typeof tag !== "string" || !SEMVER_TAG.test(tag)) {
    throw new Error("Release tag must be a v-prefixed semantic version.");
  }
  if (typeof packageVersion !== "string" || tag.slice(1) !== packageVersion) {
    throw new Error("Release tag must match package.json version.");
  }
  return tag;
}
