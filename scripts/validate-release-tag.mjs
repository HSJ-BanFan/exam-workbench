import fs from "node:fs";
import { validateReleaseTag } from "./release-tag.mjs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = validateReleaseTag(process.env.RELEASE_TAG, packageJson.version);
process.stdout.write(`${tag}\n`);
