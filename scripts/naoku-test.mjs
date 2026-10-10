// 脑库索引层自测。默认用 .selftest 里自合成的迷你 vault；设 NAOKU_VAULT=<真实 vault> 时对真实库再跑一遍。
// 用法: node scripts/naoku-test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, writeIndex, searchIndex, forQuestion, readNote } from "../src/naoku.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SELFTEST = path.join(ROOT, ".selftest");
const FIXTURE = path.join(SELFTEST, "naoku-fixture");
const OUT_DIR = path.join(SELFTEST, "naoku-index-out");

const FILES = {
  "10-真题/资料分析/增长/10000001 年均增长量.md": `---
类型: "真题"
qid: "10000001"
试卷: "2024年广东省公务员录用考试《行测》题（网友回忆版）"
地区: "广东"
年份: "2024"
考点: "增长 / 年均增长量"
tags: ["真题", "资料分析/增长"]
---

# 年均增长量

考点：[[20-考点/资料分析/增长/年均增长量|增长 / 年均增长量]]
材料：[[15-材料/资料分析/9000001 中国对外直接投资：2022年全球格局|9000001 中国对外直接投资]]

## 推理链
1. 第1步：读首末年值

## 相关题
- [[10-真题/资料分析/比重/10000002 基期比重|10000002]]（广东 2024，相关度2）

### 题干
2013-2022年，中国对外直接投资流量年均增加约（    ）亿美元。
`,
  "10-真题/资料分析/比重/10000002 基期比重.md": `---
类型: "真题"
qid: "10000002"
试卷: "2024年广东省公务员录用考试《行测》题（网友回忆版）"
地区: "广东"
年份: "2024"
考点: "比重 / 基期比重"
tags: ["真题", "资料分析/比重"]
---

# 基期比重

考点：[[20-考点/资料分析/比重/基期比重计算|比重 / 基期比重]]
材料：[[15-材料/资料分析/9000001 中国对外直接投资：2022年全球格局|9000001]]

## 相关题
- [[10-真题/资料分析/比重/10000002 基期比重|10000002]]
- [[10-真题/资料分析/增长/10000001 年均增长量|10000001]]
`,
  "10-真题/判断推理/逻辑判断/10000003 无考点链接.md": `---
类型: "真题"
qid: "10000003"
试卷: "2025年江西省公务员录用考试《行测》题"
地区: "江西"
年份: "2025"
考点: "逻辑判断 / 翻译推理"
tags: ["真题", "判断推理/逻辑判断"]
---

# 翻译推理

前置条件 A→B，结论 A→B。
`,
  "15-材料/资料分析/9000001 中国对外直接投资：2022年全球格局.md": `---
类型: "材料"
mid: "9000001"
材料主题: "中国对外直接投资：2022年全球格局与中国流量表现"
小题数: "2"
tags: ["材料", "资料分析"]
---

# 材料 · 中国对外直接投资

## 结构拆解
- 文字第1段：2022年全球对外直接投资流量总貌
`,
  "20-考点/资料分析/增长/年均增长量.md": `---
类型: "考点"
模块: "增长"
考点: "年均增长量"
题数: "1"
地区数: "1"
tags: ["考点", "资料分析/增长"]
---

# 增长 / 年均增长量

> 1 题 · 1 个地区 · 2024年

## 核心立场（母题抽象）
- 🧩 当题干出现'A年到B年间年均增加约多少'时，用(末年值-首年值)÷(末年-首年)，分母是年份差
- 🧩 第二条母题不应被取用

## 真题（跨卷聚合）
- [[10-真题/资料分析/增长/10000001 年均增长量|10000001]] 广东 2024
`,
  "20-考点/资料分析/比重/基期比重计算.md": `---
类型: "考点"
模块: "比重"
考点: "基期比重"
题数: "1"
地区数: "1"
tags: ["考点", "资料分析/比重"]
---

# 比重 / 基期比重

## 核心立场（母题抽象）
- 🧩 基期比重＝现期比重×(1+整体增速)/(1+部分增速)

## 真题（跨卷聚合）
- [[10-真题/资料分析/比重/10000002 基期比重|10000002]] 广东 2024
`,
  "20-考点/00-总览.md": `---
类型: "总览"
tags: ["总览"]
---

# 考点总览（全库）

- [[20-考点/资料分析/00-总览|资料分析]]
`,
  "20-考点/资料分析/00-总览.md": `---
类型: "总览"
模块: "资料分析"
考点数: "2"
题数: "2"
tags: ["总览", "资料分析"]
---

# 资料分析 · 考点总览

## 增长（1 考点 / 1 题）

- [[20-考点/资料分析/增长/年均增长量|年均增长量]] ×1
`,
};

// 越界守卫的靶子：故意放在 vault 外面。
const OUTSIDE_FILE = "naoku-fixture-outside.md";

function makeFixture() {
  fs.mkdirSync(FIXTURE, { recursive: true });
  for (const [rel, text] of Object.entries(FILES)) {
    const target = path.join(FIXTURE, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, "utf8");
  }
  fs.writeFileSync(path.join(SELFTEST, OUTSIDE_FILE), "不该被读到\n", "utf8");
}

const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

check("fixture 索引字段与计数", async (index) => {
  const counts = index.counts;
  assert.deepEqual(
    [counts.真题, counts.考点, counts.材料],
    [3, 2, 1],
    "真题/考点/材料 计数应为 3/2/1"
  );
  assert.equal(counts.考点链接未命中, 1, "10000003 无考点链接，应记 1 处未命中");
  const row = index.真题.find((r) => r.qid === "10000001");
  assert.equal(row.模块, "资料分析", "模块取自路径");
  assert.equal(row.大类, "增长", "大类取自路径");
  assert.equal(row.考点, "增长 / 年均增长量", "考点取自 frontmatter");
  assert.equal(row.考点路径, "20-考点/资料分析/增长/年均增长量", "考点路径来自正文 wikilink 目标");
  assert.equal(row.地区, "广东");
  assert.equal(row.年份, "2024");
  assert.equal(row.标题, "年均增长量", "标题取文件名去掉 qid");
  assert.equal(row.材料, "9000001", "材料 mid 取链接文件名前导数字");
  assert.deepEqual(row.相关题, ["10000002"], "相关题只保留其他真题");
  assert.equal(row.path, "10-真题/资料分析/增长/10000001 年均增长量.md", "path 是相对 vault 的正斜杠路径");
  assert.deepEqual(index.模块列表, ["判断推理", "资料分析"], "模块列表来自路径");
});

check("真题自链接被排除", (index) => {
  const row = index.真题.find((r) => r.qid === "10000002");
  assert.deepEqual(row.相关题, ["10000001"], "自链接不应进入相关题");
});

check("考点按链接反向分组", (index) => {
  const point = index.考点.find((r) => r.考点 === "年均增长量");
  assert.deepEqual(point.真题, ["10000001"], "考点.真题来自真题侧反查，不采信 MOC 正文");
  assert.equal(point.题数, 1, "题数取 frontmatter");
  assert.equal(point.模块, "资料分析", "考点.模块取自路径而非 frontmatter 的模块字段");
  assert.equal(point.大类, "增长");
  assert.ok(point.母题.startsWith("当题干出现"), `母题去掉 🧩 标记，实际: ${point.母题}`);
  assert.ok(point.母题.length <= 300, "母题截断到 300 字符");
  assert.ok(!point.母题.includes("第二条母题"), "母题只取第一条 bullet");
});

check("材料按链接反向分组", (index) => {
  const material = index.材料.find((r) => r.mid === "9000001");
  assert.deepEqual(material.真题, ["10000001", "10000002"], "材料.真题是引用该材料的 qid，按 qid 升序");
  assert.equal(material.小题数, 2);
  assert.equal(material.模块, "资料分析");
});

check("总览笔记被容忍并跳过", (index) => {
  assert.equal(
    index.考点.filter((r) => r.path.includes("00-总览")).length,
    0,
    "两种形状的总览都不应进入考点索引"
  );
  assert.equal(index.counts.笔记总数, Object.keys(FILES).length, "扫描到的笔记数含被跳过的总览");
});

check("search 过滤与 limit 上限", (index) => {
  assert.equal(searchIndex(index, { type: "真题", q: "年均增长量" }).items.length, 1, "关键字命中标题");
  assert.equal(searchIndex(index, { type: "真题", 地区: "江西" }).items[0]?.qid, "10000003", "地区过滤");
  assert.equal(searchIndex(index, { type: "真题", 模块: "判断推理", 大类: "逻辑判断" }).total, 1);
  assert.equal(searchIndex(index, { type: "考点", q: "基期" }).items[0]?.考点, "基期比重");
  assert.equal(searchIndex(index, { type: "材料", q: "投资" }).items[0]?.mid, "9000001");
  assert.equal(searchIndex(index, { limit: 999 }).limit, 200, "limit 上限 200");
  assert.equal(searchIndex(index, { limit: 0 }).limit, 50, "非法 limit 回落到默认 50");
  assert.equal(searchIndex(index, {}).limit, 50);
  assert.throws(() => searchIndex(index, { type: "不存在" }), /未知索引类型/, "未知 type 应抛错");
});

check("forQuestion 拼接三种记录", (index) => {
  const hit = forQuestion(index, "10000001");
  assert.equal(hit.qid, "10000001");
  assert.equal(hit.笔记.path, "10-真题/资料分析/增长/10000001 年均增长量.md");
  assert.equal(hit.考点.path, "20-考点/资料分析/增长/年均增长量.md");
  assert.equal(hit.材料.path, "15-材料/资料分析/9000001 中国对外直接投资：2022年全球格局.md");
  assert.equal(hit.相关题[0].qid, "10000002");
  assert.ok(hit.相关题[0].path, "相关题带 path 供读正文");
  const miss = forQuestion(index, "99999999");
  assert.deepEqual([miss.笔记, miss.考点, miss.材料, miss.相关题.length], [null, null, null, 0], "未收录的 qid 返回空结构");
});

check("readNote 读正文并挡住越界", (_index, vaultDir) => {
  const note = readNote({ vaultDir, relPath: "20-考点/资料分析/增长/年均增长量.md" });
  assert.ok(note.content.includes("核心立场"), "能读到笔记正文");
  assert.equal(note.path, "20-考点/资料分析/增长/年均增长量.md");
  const cases = [
    `../${OUTSIDE_FILE}`,
    "../../../etc/hosts",
    "..\\..\\Windows\\win.ini",
    path.join(SELFTEST, OUTSIDE_FILE),
    "",
  ];
  for (const relPath of cases) {
    assert.throws(
      () => readNote({ vaultDir, relPath }),
      /必填|越界|相对路径|非法/,
      `越界或非法路径应抛错: ${relPath}`
    );
  }
  assert.ok(fs.existsSync(path.join(SELFTEST, OUTSIDE_FILE)), "靶子文件确实存在于 vault 之外");
});

check("writeIndex 落盘四文件与 README", (_index, vaultDir) => {
  const index = _index;
  const manifest = writeIndex({
    outDir: OUT_DIR,
    index,
    manifest: { vault: index.vault, 许可: "CC BY-NC 4.0" },
  });
  for (const name of ["真题.json", "考点.json", "材料.json", "manifest.json", "README.md"]) {
    assert.ok(fs.existsSync(path.join(OUT_DIR, name)), `应写出 ${name}`);
  }
  assert.equal(manifest.counts.真题, 3, "manifest 计数来自索引");
  assert.equal(manifest.vault.dir, vaultDir, "manifest 记录 vault 路径");
  const written = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "真题.json"), "utf8"));
  assert.equal(written.length, 3, "真题.json 是 JSON 数组");
  assert.ok(
    fs.readFileSync(path.join(OUT_DIR, "README.md"), "utf8").includes("CC BY-NC 4.0"),
    "README 含许可说明"
  );
});

async function runFixture() {
  makeFixture();
  const started = Date.now();
  const index = await buildIndex({ vaultDir: FIXTURE });
  for (const { name, fn } of checks) {
    await fn(index, FIXTURE);
    console.log(`PASS ${name}`);
  }
  console.log(`fixture 自测通过（${checks.length} 项，${Date.now() - started}ms）`);
}

async function runRealVault(vaultDir) {
  const started = Date.now();
  const index = await buildIndex({ vaultDir });
  assert.equal(index.counts.真题, 11282, `真实库真题应为 11282，实际 ${index.counts.真题}`);
  assert.ok(index.counts.考点 >= 10375, `真实库考点应 ≥ 10375，实际 ${index.counts.考点}`);
  const hit = forQuestion(index, "10204443");
  assert.ok(hit.笔记, "10204443 应在真题索引中");
  assert.ok(hit.考点, "10204443 应能连到考点");
  assert.ok(hit.考点.真题.includes("10204443"), "考点应反向包含 10204443");
  assert.equal(hit.材料?.mid, "4463712", "10204443 应连到材料 4463712");
  assert.ok(hit.相关题.length > 0, "10204443 应有相关题");
  console.log(
    `真实库通过：真题 ${index.counts.真题}、考点 ${index.counts.考点}、材料 ${index.counts.材料}、` +
      `考点 ${hit.考点.考点}、相关题 ${hit.相关题.length}、耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
}

try {
  await runFixture();
  const realVault = process.env.NAOKU_VAULT;
  if (realVault) await runRealVault(realVault);
  else console.log("未设置 NAOKU_VAULT，跳过真实库校验");
} catch (error) {
  console.error("脑库自测失败:", error?.message ?? error);
  process.exitCode = 1;
}
