// 调试探针：用会话文件直接请求粉笔接口。
// 用法: node scripts/probe.mjs <path?query>
// 会话文件路径：环境变量 SESSION_PATH（默认 ./session.json）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionPath = process.env.SESSION_PATH ?? path.join(__dirname, "..", "session.json");
const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/probe.mjs <path?query>");
  process.exit(1);
}

const saved = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
const cookie = Object.entries(saved.cookies ?? {})
  .map(([k, v]) => `${k}=${v}`)
  .join("; ");

const url = target.startsWith("http") ? target : `https://tiku.fenbi.com${target}`;
const res = await fetch(url, {
  headers: {
    accept: "application/json, text/plain, */*",
    cookie,
    referer: "https://www.fenbi.com/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  },
});
const text = await res.text();
console.log(`status=${res.status} len=${text.length}`);
console.log(text.slice(0, 1500));
