// 开发者自测：不启动 Electron，直接用已验证的会话文件跑一次同步引擎。
// 输出到一个临时目录，用于快速验证解析与文件生成逻辑。
// 用法: node scripts/dev-sync-test.mjs [输出目录]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../src/sync.mjs";
import { DATASET_IDS } from "../src/datasets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const sessionPath = process.env.SESSION_PATH ?? path.join(ROOT, "session.json");
const outDir = process.argv[2] ?? path.join(ROOT, ".selftest", "sync-scratch");

const saved = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
const cookieHeader = Object.entries(saved.cookies ?? {})
  .map(([k, v]) => `${k}=${v}`)
  .join("; ");

const summary = await runSync({
  cookieHeader,
  dataDir: outDir,
  datasets: DATASET_IDS, // 全数据集（含默认关闭的题目元数据）以覆盖代码路径
  full: true,
  log: (m) => console.log(`  ${m}`),
});

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
