import fs from "node:fs";
import { validateReleaseTag } from "./release-tag.mjs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = validateReleaseTag(process.env.RELEASE_TAG, packageJson.version);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_tag=${tag}\n`, "utf8");
}
process.stdout.write(`${tag}\n`);
