// 同步编排：拉取粉笔只读接口 → 写入「一个根目录 + 按数据集分子目录」。
// 所有写入均为纯文本（Markdown + JSON），供本地 AI agent 读取分析。

import fs from "node:fs";
import path from "node:path";
import {
  makeClient,
  redactUser,
  flattenErrorTree,
  summarizeReport,
  buildQuestionRows,
  fmtTime,
  todayShanghai,
} from "./fenbi-api.mjs";
import { DATASETS, datasetById, NEVER_EXPOSED } from "./datasets.mjs";
import { buildIndex, writeIndex } from "./naoku.mjs";

const APP_VERSION = "0.1.0";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function writeJson(file, data) {
  writeText(file, JSON.stringify(data, null, 2));
}

function yamlScalar(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${yamlScalar(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function noteHeader(extra = {}) {
  return frontmatter({
    type: "generated",
    status: "active",
    sample: false,
    来源: "粉笔（本人账号只读同步）",
    同步时间: fmtTime(Date.now()),
    ...extra,
  });
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await fn(items.slice(i, i + size))));
  }
  return out;
}

function renderQuestionMd(row, idx) {
  const lines = [];
  lines.push(`### 第 ${idx + 1} 题（${row.isCorrect ? "✅ 正确" : "❌ 错误"}）`);
  lines.push("");
  lines.push(row.content);
  lines.push("");
  for (const o of row.options) lines.push(`- ${o.letter}. ${o.text}`);
  lines.push("");
  lines.push(`- 我的答案：${row.myChoice}`);
  lines.push(`- 正确答案：${row.correctChoice}`);
  if (row.keypoints?.length) lines.push(`- 知识点：${row.keypoints.join(" / ")}`);
  if (row.time != null) lines.push(`- 用时（原始值）：${row.time}`);
  lines.push("");
  lines.push("**解析**");
  lines.push("");
  lines.push(row.explanation || "（未获取到解析）");
  lines.push("");
  return lines.join("\n");
}

function renderHistoryMd({ history, syncedAt }) {
  const items = history.historyItems ?? [];
  const tabOf = (h) => (h.historyTab === "paper" ? "试卷" : "练习");
  const lines = [
    noteHeader({ 数据集: "练习记录" }),
    "# 练习记录",
    "",
    `共 ${items.length} 场（「练习」与「试卷」两个 tab 合并去重，按时间倒序）。`,
    "",
    "| 时间 | 来源 | 状态 | 名称 | 正确 | 题数 | 难度 | key |",
    "|---|---|---|---|---|---|---|---|",
    ...items.map(
      (h) =>
        `| ${fmtTime(h.updatedTime)} | ${tabOf(h)} | ${h.status === 1 ? "已完成" : "未完成"} | ${h.sheetName} | ${h.correctCount} | ${h.questionCount} | ${h.difficulty?.toFixed?.(1) ?? h.difficulty} | \`${h.exerciseKey}\` |`
    ),
    "",
    `> 同步时间：${fmtTime(syncedAt)}。未完成场次不出现在题解目录中。`,
    "",
  ];
  return lines.join("\n");
}

async function fetchAllHistory(client) {
  // 前端（673.js udpateNavTabs）硬编码：练习历史 = 练习(type 3) + 试卷(type 1)
  const tabs = [
    { id: "practice", title: "练习", categoryId: 3 },
    { id: "paper", title: "试卷", categoryId: 1 },
  ];
  const meta = {};
  const merged = new Map();
  for (const tab of tabs) {
    const data = await client.getHistory({ categoryId: tab.categoryId, maxItems: 500 });
    meta[tab.id] = { title: tab.title, categoryId: tab.categoryId, count: data.historyItems.length };
    for (const item of data.historyItems) {
      if (!merged.has(item.exerciseKey)) merged.set(item.exerciseKey, { ...item, historyTab: tab.id });
    }
  }
  const historyItems = [...merged.values()].sort((a, b) => (b.updatedTime ?? 0) - (a.updatedTime ?? 0));
  return { tabs: meta, historyItems };
}

function renderMockMd({ mock, syncedAt }) {
  const items = mock?.items ?? [];
  const lines = [noteHeader({ 数据集: "模考记录" }), "# 模考记录", ""];
  if (!items.length) {
    lines.push("当前账号没有模考（模考大赛）完成记录。");
    lines.push("");
    lines.push("> 接口已接入；完成模考后数据会自动出现在这里。列表字段结构尚未验证。");
  } else {
    lines.push(`共 ${items.length} 条记录。`);
    lines.push("");
    for (const item of items) {
      const name = item.name ?? item.paperName ?? item.awardExamName ?? `记录 ${item.id ?? item.exerciseId ?? ""}`;
      lines.push(`- ${name}`);
    }
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(items, null, 2).slice(0, 20000));
    lines.push("```");
  }
  lines.push("");
  lines.push(`> 同步时间：${fmtTime(syncedAt)}。`);
  lines.push("");
  return lines.join("\n");
}

function renderShenlunHistoryMd({ shenlunUser, combineHistory, briefs, syncedAt }) {
  const items = briefs?.items ?? [];
  const combineItems = combineHistory?.historyItems ?? [];
  const lines = [noteHeader({ 数据集: "申论练习记录" }), "# 申论练习记录", ""];
  if (shenlunUser && !shenlunUser.error) {
    lines.push(
      `- 批改额度：智能批改剩余 ${shenlunUser.pdpgLeftCount ?? "-"}；其他剩余 ${shenlunUser.leftCount ?? "-"} / ${shenlunUser.unitLeftCount ?? "-"}（会员：${shenlunUser.member ? "是" : "否"}）`
    );
    lines.push("");
  }
  lines.push("## 申论练习历史（列表接口）");
  lines.push("");
  if (items.length) {
    lines.push("| 时间 | 名称 | 状态 | id |");
    lines.push("|---|---|---|---|");
    for (const it of items) {
      lines.push(
        `| ${fmtTime(it.updatedTime ?? it.submitTime ?? it.createdTime)} | ${it.sheetName ?? it.name ?? "-"} | ${it.status ?? "-"} | \`${it.exerciseId ?? it.id ?? "-"}\` |`
      );
    }
  } else {
    lines.push("当前账号没有申论练习记录。");
  }
  lines.push("");
  lines.push("## 题库侧历史（combine）");
  lines.push("");
  if (combineItems.length) {
    lines.push("| 时间 | 名称 | 状态 | key |");
    lines.push("|---|---|---|---|");
    for (const it of combineItems) {
      lines.push(
        `| ${fmtTime(it.updatedTime)} | ${it.sheetName ?? "-"} | ${it.status === 1 ? "已完成" : "未完成"} | \`${it.exerciseKey ?? "-"}\` |`
      );
    }
  } else {
    lines.push("题库侧没有申论练习记录。");
  }
  lines.push("");
  lines.push(`> 同步时间：${fmtTime(syncedAt)}。`);
  lines.push("");
  return lines.join("\n");
}

function renderShenlunExerciseMd({ id, item, detail, reportHtml, manualReportHtml, questions, syncedAt }) {
  const lines = [
    noteHeader({ 数据集: "申论作答与批改", 练习id: String(id) }),
    `# 申论练习 ${item?.sheetName ?? detail?.name ?? id}`,
  ];
  lines.push("");
  lines.push(`- 练习 id：\`${id}\``);
  const time = item?.updatedTime ?? item?.submitTime ?? detail?.updatedTime;
  if (time) lines.push(`- 时间：${fmtTime(time)}`);
  const score = detail?.score ?? detail?.userScore ?? detail?.totalScore;
  if (score != null) lines.push(`- 得分：${score}`);
  lines.push("");
  if (questions.length) {
    lines.push("## 题目");
    lines.push("");
    questions.forEach((q, i) => {
      lines.push(`### 第 ${i + 1} 题`);
      lines.push("");
      lines.push(htmlToText(q.content) || "（无题干）");
      lines.push("");
    });
  }
  lines.push("## 批改报告");
  lines.push("");
  lines.push(
    `- 智能批改报告：${reportHtml ? `已保存 \`批改报告-${id}.html\`（${reportHtml.length} 字符）` : "无"}`
  );
  lines.push(
    `- 人工批改报告：${manualReportHtml ? `已保存 \`人工批改-${id}.html\`（${manualReportHtml.length} 字符）` : "无"}`
  );
  lines.push("");
  if (detail) {
    lines.push("## 练习数据（原始字段）");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(detail, null, 2).slice(0, 12000));
    lines.push("```");
    lines.push("");
  }
  lines.push(`> 同步时间：${fmtTime(syncedAt)}。字段结构以账号实际数据为准（首版未逐字段解释）。`);
  lines.push("");
  return lines.join("\n");
}

function renderExerciseMd({ key, historyItem, reportSummary, rows }) {
  const lines = [];
  lines.push(noteHeader({ 数据集: "题解与逐题作答", 练习key: String(key) }));
  lines.push(`# 练习：${historyItem?.sheetName ?? reportSummary?.name ?? key}`);
  lines.push("");
  lines.push(`- 练习 key：\`${key}\``);
  if (historyItem) {
    lines.push(`- 完成时间：${fmtTime(historyItem.updatedTime)}`);
    lines.push(`- 题数：${historyItem.questionCount}，答对：${historyItem.correctCount}`);
    lines.push(`- 难度：${historyItem.difficulty}`);
  }
  if (reportSummary) {
    lines.push(
      `- 报告：${reportSummary.questionCount} 题 / 答对 ${reportSummary.correctCount} / 难度 ${reportSummary.difficulty}`
    );
    lines.push("");
    lines.push("## 知识点表现");
    lines.push("");
    lines.push("| 知识点 | 题数 | 答对 | 用时(原始值) |");
    lines.push("|---|---|---|---|");
    for (const d of reportSummary.details) {
      lines.push(`| ${d.name} | ${d.questionCount} | ${d.correctCount} | ${d.time} |`);
    }
  }
  lines.push("");
  lines.push("## 逐题明细");
  lines.push("");
  rows.forEach((row, idx) => lines.push(renderQuestionMd(row, idx)));
  return lines.join("\n");
}

function renderAbilityMd(analysis, syncedAt) {
  const report = analysis?.tikuReport ?? {};
  const lines = [
    noteHeader({ 数据集: "能力报告" }),
    "# 能力报告（粉笔官方计算）",
    "",
    `- 累计作答：${report.answerCount ?? "-"} 题，练习场次：${report.exerciseCount ?? "-"}，答对：${report.correctCount ?? "-"}`,
    `- 预测分：${report.forecastScore?.toFixed?.(1) ?? "-"} / ${report.fullMark ?? 100}（平台平均 ${report.avgForecastScore?.toFixed?.(1) ?? "-"}）`,
    `- 排名：${report.scoreRankIndex ?? "-"} / ${report.totalUserCount ?? "-"}（作答量排名 ${report.answerCountRankIndex ?? "-"}）`,
    `- 练习天数：${report.exerciseDay ?? "-"}`,
    "",
    "| 模块 | 作答数 | 正确率 | 目标正确率 | 预估得分 |",
    "|---|---|---|---|---|",
    ...(report.keypoints ?? []).map(
      (k) =>
        `| ${k.name} | ${k.answerCount} | ${Number(k.correctRatio).toFixed(1)}% | ${k.targetCorrectRatio}% | ${Number(k.score).toFixed(2)} |`
    ),
    "",
  ];
  if ((report.trends ?? []).length) {
    lines.push("## 预测分趋势");
    lines.push("");
    lines.push("| 时间 | 预测分 |");
    lines.push("|---|---|");
    for (const t of report.trends) lines.push(`| ${fmtTime(t.time)} | ${Number(t.score).toFixed(1)} |`);
    lines.push("");
  }
  lines.push(`> 同步时间：${fmtTime(syncedAt)}。分数为平台模型估算，非真实考试成绩。`);
  lines.push("");
  return lines.join("\n");
}

function renderWrongMd({ flatErrors, wrongIds, rowById, extraById, syncedAt }) {
  const lines = [
    noteHeader({ 数据集: "错题本快照" }),
    "# 错题本快照",
    "",
    `共 ${wrongIds.length} 道错题（去重后）。`,
    "",
    "## 知识点分布",
    "",
  ];
  for (const node of flatErrors) {
    const indent = "　".repeat(node.depth);
    const ids = node.questionIds.length ? `：${node.questionIds.join(", ")}` : "";
    lines.push(`- ${indent}${node.name}（${node.questionIds.length} 道）${ids}`);
  }
  lines.push("");
  lines.push("## 错题明细（按首次出现去重）");
  lines.push("");
  const seen = new Set();
  let idx = 0;
  for (const node of flatErrors) {
    for (const id of node.questionIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const r = rowById.get(id) ?? extraById.get(id);
      if (!r) continue;
      idx++;
      lines.push(`### 错题 ${idx} · 题目 ${id}`);
      lines.push("");
      lines.push(r.content);
      lines.push("");
      for (const o of r.options ?? []) lines.push(`- ${o.letter}. ${o.text}`);
      lines.push("");
      lines.push(`- 我的答案：${r.myChoice}`);
      lines.push(`- 正确答案：${r.correctChoice}`);
      if (r.keypoints?.length) lines.push(`- 知识点：${r.keypoints.join(" / ")}`);
      lines.push("");
      if (r.explanation) {
        lines.push("**解析**");
        lines.push("");
        lines.push(r.explanation);
        lines.push("");
      } else {
        lines.push("（解析未包含在已同步的练习中）");
        lines.push("");
      }
    }
  }
  lines.push(`> 同步时间：${fmtTime(syncedAt)}。`);
  lines.push("");
  return lines.join("\n");
}

function renderNotesCollectsMd({ counts, notesRows, collectRows, syncedAt }) {
  const lines = [noteHeader({ 数据集: "笔记与收藏" }), "# 笔记与收藏", ""];
  lines.push("| 类型 | 数量 |");
  lines.push("|---|---|");
  for (const c of counts ?? []) lines.push(`| ${c.name} | ${c.allCount} |`);
  lines.push("");
  if (collectRows.length) {
    lines.push("## 收藏题目");
    lines.push("");
    lines.push("| 题目ID | 题干摘要 |");
    lines.push("|---|---|");
    for (const r of collectRows) lines.push(`| ${r.id} | ${r.content.slice(0, 60).replace(/\n/g, " ")} |`);
    lines.push("");
  }
  if (notesRows.length) {
    lines.push("## 我的笔记");
    lines.push("");
    for (const r of notesRows) {
      lines.push(`### 题目 ${r.id}`);
      lines.push("");
      lines.push(`- 题干：${r.content.slice(0, 120).replace(/\n/g, " ")}`);
      lines.push(`- 笔记：${r.note}`);
      lines.push("");
    }
  }
  if (!collectRows.length && !notesRows.length) {
    lines.push("> 当前没有收藏或笔记记录（或未同步到内容）。");
    lines.push("");
  }
  lines.push(`> 同步时间：${fmtTime(syncedAt)}。`);
  lines.push("");
  return lines.join("\n");
}

function renderQuestionMetaMd({ rows, syncedAt }) {
  const lines = [
    noteHeader({ 数据集: "题目元数据" }),
    "# 题目元数据（全站统计）",
    "",
    "| 题目ID | 全站正确率 | 最多人选错项 | 我是否做对 | 知识点 |",
    "|---|---|---|---|---|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.correctRatio != null ? Number(r.correctRatio).toFixed(1) + "%" : "-"} | ${r.mostWrong ?? "-"} | ${r.mine === true ? "✅" : r.mine === false ? "❌" : "-"} | ${(r.keypoints ?? []).join(" / ")} |`
    );
  }
  lines.push("");
  lines.push(`> 同步时间：${fmtTime(syncedAt)}。数据为平台统计口径，可用于区分「普遍难」与「个别薄弱」。`);
  lines.push("");
  return lines.join("\n");
}

function renderReadmeMd({ dataDir }) {
  return [
    noteHeader({ 数据集: "说明" }),
    "# 粉笔同步目录说明",
    "",
    "本目录由本地应用「备考工作台」（webview）写入：只读同步**本人账号**的练习数据，",
    "供本地 AI agent（Codex / Claude 等）做分析、聚类与复盘。请勿手动改写机器文件。",
    "",
    "## 目录结构",
    "",
    "```",
    "粉笔同步/",
    "├── manifest.json      # 机器可读索引：数据集列表、文件清单、同步时间",
    "├── 00-说明.md          # 本文件",
    "├── 状态/同步状态.md     # 最近一次同步的人类可读摘要",
    "├── 练习记录/           # 练习历史索引（md + json）",
    "├── 题解/               # 每场已完成练习的逐题明细（题干/选项/我的答案/解析）",
    "├── 错题本/             # 错题快照（按知识点聚合）",
    "├── 能力报告/           # 官方预测分/排名/模块正确率",
    "├── 笔记与收藏/          # 本人笔记与收藏（可能为空）",
    "├── 模考记录/            # 模考大赛完成记录（可能为空）",
    "├── 申论练习记录/        # 申论历史与批改额度（可能为空）",
    "├── 申论作答与批改/      # 申论逐场题目/作答/批改报告（可能为空）",
    "└── 题目元数据/          # 可选：全站正确率/易错项（默认关闭）",
    "```",
    "",
    "## 边界",
    "",
    "- 只包含本人练习过的题目与作答；不包含未练习的题库内容。",
    "- 不含登录凭据；账号手机号等个人信息已脱敏（如 `151****5169`）。",
    "- 本目录是「数据快照」，不是学习记录：把它当作复盘素材，确认后的人工结论应写入库中",
    "  `20-日志`（学习记录）或 `40-错题`（错题卡），不要把快照本身当学习效果证据。",
    "",
    "## 本机接口",
    "",
    "- 应用在本机 `127.0.0.1` 上暴露只读同步接口：`GET /api/status`、`GET /api/datasets`、",
    "  `POST /api/sync`（触发一次同步）、`GET /api/manifest`。端口与开关可在应用「设置」中调整。",
    "",
    `> 生成时间：${fmtTime(Date.now())}（数据目录：\`${dataDir}\`）`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- main

export async function runSync({ cookieHeader, dataDir, datasets, full = false, log = () => {}, naokuDir = "" }) {
  const startedAt = Date.now();
  const selected = new Set(datasets);
  const warnings = [];
  const summary = { ok: false, startedAt, dataDir, datasets: {}, warnings };

  ensureDir(dataDir);

  // 脑库在本地，先建索引：没导入也只记 warning，不影响粉笔侧数据。
  if (selected.has("naoku-index")) {
    const vaultDir = naokuDir ? path.resolve(naokuDir) : path.join(dataDir, "考公脑库");
    if (!fs.existsSync(vaultDir)) {
      const hint = `脑库未导入（${vaultDir}）：先运行 naoku 导入（--naoku-import 或 POST /api/naoku/import）`;
      warnings.push(hint);
      log(hint);
    } else {
      log("建脑库索引…");
      const index = await buildIndex({ vaultDir, log });
      writeIndex({ outDir: path.join(dataDir, "脑库索引"), index });
      summary.datasets["naoku-index"] = {
        title: "考公脑库索引",
        items: index.counts.真题,
        counts: index.counts,
        vault: index.vault,
        files: [
          "脑库索引/真题.json",
          "脑库索引/考点.json",
          "脑库索引/材料.json",
          "脑库索引/manifest.json",
          "脑库索引/README.md",
        ],
      };
      for (const w of index.warnings) warnings.push(`脑库：${w}`);
      log(`脑库索引 ✓（真题 ${index.counts.真题} / 考点 ${index.counts.考点} / 材料 ${index.counts.材料}）`);
    }
  }

  // 只要选了粉笔侧数据集才需要登录会话与账号信息。
  const needFenbi = [...selected].some((id) => datasetById(id)?.source !== "naoku");
  let client = null;
  let user = null;
  let category = null;
  let prefix = "xingce";
  if (needFenbi) {
    log("读取账号信息…");
    client = makeClient(cookieHeader);
    user = redactUser(await client.getUser());
    category = await client.getExamCategory();
    prefix = category?.currentCourse?.prefix ?? "xingce";
    if (prefix !== "xingce") client = makeClient(cookieHeader, { prefix });
  }

  const needHistory = ["history", "exercises", "wrong", "notes-collects"].some((id) => selected.has(id));
  const history = needHistory ? await fetchAllHistory(client) : { tabs: {}, historyItems: [] };
  log(`练习历史 ${history.historyItems?.length ?? 0} 场`);

  const rowById = new Map();

  if (selected.has("history")) {
    const dir = path.join(dataDir, "练习记录");
    writeText(path.join(dir, "练习记录.md"), renderHistoryMd({ history, syncedAt: startedAt }));
    writeJson(path.join(dir, "history.json"), history);
    summary.datasets.history = { title: "练习记录", items: history.historyItems?.length ?? 0, files: ["练习记录/练习记录.md", "练习记录/history.json"] };
    log("练习记录 ✓");
  }

  if (selected.has("exercises") || selected.has("wrong") || selected.has("question-meta")) {
    const completed = (history.historyItems ?? []).filter((h) => h.status === 1);
    const skipped = (history.historyItems ?? []).length - completed.length;
    if (skipped > 0) warnings.push(`跳过 ${skipped} 场未完成练习（无完整题解）`);
    let fetched = 0;
    let cached = 0;
    for (const h of completed) {
      const key = h.exerciseKey;
      const rawPath = path.join(dataDir, "题解", `练习-${key}.json`);
      let bundle = null;
      if (!full && fs.existsSync(rawPath)) {
        try {
          bundle = JSON.parse(fs.readFileSync(rawPath, "utf8"));
          cached++;
        } catch {
          bundle = null;
        }
      }
      if (!bundle) {
        log(`拉取题解 ${key} …`);
        const solution = await client.getExerciseSolution(key);
        const report = await client.getExerciseReport(key);
        const requestKey = solution?.switchVO?.requestKey;
        const staticData = requestKey ? await client.getStaticSolution(requestKey) : null;
        bundle = { key, fetchedAt: Date.now(), solution, report, staticData };
        writeJson(rawPath, bundle);
        fetched++;
      }
      const rows = buildQuestionRows(bundle.solution, bundle.staticData);
      for (const r of rows) rowById.set(r.id, r);
      if (selected.has("exercises")) {
        const md = renderExerciseMd({
          key,
          historyItem: h,
          reportSummary: summarizeReport(bundle.report),
          rows,
        });
        writeText(path.join(dataDir, "题解", `练习-${key}.md`), md);
      }
    }
    if (selected.has("exercises")) {
      const files = [];
      for (const h of completed) {
        files.push(`题解/练习-${h.exerciseKey}.md`, `题解/练习-${h.exerciseKey}.json`);
      }
      summary.datasets.exercises = { title: "题解与逐题作答", items: completed.length, fetched, cached, files };
      log(`题解 ✓（新拉取 ${fetched}，缓存 ${cached}）`);
    }

    if (selected.has("wrong")) {
      log("拉取错题树…");
      const tree = await client.getErrorsTree(0, "desc");
      const flat = flattenErrorTree(tree).filter((n) => n.questionIds.length);
      const wrongIds = [...new Set(flat.flatMap((n) => n.questionIds))];
      const missing = wrongIds.filter((id) => !rowById.has(id));
      const extraById = new Map();
      if (missing.length) {
        log(`补齐 ${missing.length} 道未在题解中的错题…`);
        const extra = await inBatches(missing, 50, async (batch) => {
          const [questions, answers, keypoints] = await Promise.all([
            client.getQuestions(batch),
            client.getUserAnswers(batch),
            client.getSolutionKeypoints(batch),
          ]);
          const ansById = new Map((answers ?? []).map((a) => [a.questionId, a]));
          const kpById = new Map((keypoints ?? []).map((kp, i) => [batch[i], kp]));
          return (questions ?? []).map((q) => ({
            id: q.id,
            content: (q.content ?? "").replace(/<[^>]+>/g, "").trim(),
            options: (q.accessories?.[0]?.options ?? []).map((o, i) => ({
              letter: String.fromCharCode(65 + i),
              text: String(o),
            })),
            myChoice: (() => {
              const c = ansById.get(q.id)?.answer?.choice;
              return c == null ? "（未作答）" : String(c).split(",").map((x) => String.fromCharCode(65 + Number(x))).join("");
            })(),
            correctChoice: (() => {
              const c = q.correctAnswer?.choice;
              return c == null ? "（未作答）" : String(c).split(",").map((x) => String.fromCharCode(65 + Number(x))).join("");
            })(),
            keypoints: (kpById.get(q.id) ?? []).map((k) => k.name),
            explanation: "",
          }));
        });
        for (const r of extra) extraById.set(r.id, r);
        if (extra.length) warnings.push(`${extra.length} 道错题的解析未包含在已同步练习中`);
      }
      writeText(
        path.join(dataDir, "错题本", "错题本.md"),
        renderWrongMd({ flatErrors: flat, wrongIds, rowById, extraById, syncedAt: startedAt })
      );
      writeJson(path.join(dataDir, "错题本", "wrong.json"), {
        tree,
        wrongIds,
        joinedFromExercises: wrongIds.filter((id) => rowById.has(id)).length,
        fallbackFetched: extraById.size,
      });
      summary.datasets.wrong = { title: "错题本快照", items: wrongIds.length, files: ["错题本/错题本.md", "错题本/wrong.json"] };
      log(`错题本 ✓（${wrongIds.length} 道）`);
    }

    if (selected.has("question-meta")) {
      const ids = [...rowById.keys()];
      if (ids.length) {
        log(`拉取题目元数据（${ids.length} 道）…`);
        const metas = await inBatches(ids, 50, (batch) => client.getQuestionMeta(batch));
        const rows = metas.map((m) => {
          const r = rowById.get(m.id);
          return {
            id: m.id,
            correctRatio: m.correctRatio,
            mostWrong: m.mostWrongAnswer?.choice != null ? String.fromCharCode(65 + Number(m.mostWrongAnswer.choice)) : "-",
            mine: r ? r.isCorrect : null,
            keypoints: r?.keypoints ?? [],
          };
        });
        writeText(path.join(dataDir, "题目元数据", "题目元数据.md"), renderQuestionMetaMd({ rows, syncedAt: startedAt }));
        writeJson(path.join(dataDir, "题目元数据", "question-meta.json"), rows);
        summary.datasets["question-meta"] = { title: "题目元数据", items: rows.length, files: ["题目元数据/题目元数据.md", "题目元数据/question-meta.json"] };
        log("题目元数据 ✓");
      }
    }
  }

  if (selected.has("ability")) {
    log("拉取能力报告…");
    const analysis = await client.getUserAnalysis();
    writeText(path.join(dataDir, "能力报告", "能力报告.md"), renderAbilityMd(analysis, startedAt));
    writeJson(path.join(dataDir, "能力报告", "analysis.json"), analysis);
    summary.datasets.ability = { title: "能力报告", items: 1, files: ["能力报告/能力报告.md", "能力报告/analysis.json"] };
    log("能力报告 ✓");
  }

  if (selected.has("notes-collects")) {
    log("拉取笔记与收藏…");
    const countsResp = await client.getUserCollectNoteError();
    const counts = countsResp?.userCollectNoteErrorDatas ?? [];
    const byType = Object.fromEntries(counts.map((c) => [c.name, c.allCount]));
    const notesRows = [];
    const collectRows = [];
    if ((byType["笔记"] ?? 0) > 0) {
      const tree = await client.getNotesTree(0, "desc").catch(() => []);
      const ids = [...new Set(flattenErrorTree(tree).flatMap((n) => n.questionIds))].slice(0, 60);
      if (ids.length) {
        const [questions, notes] = await Promise.all([client.getQuestions(ids), client.getNotes(ids).catch(() => [])]);
        const noteById = new Map((notes ?? []).map((n) => [n.questionId, n.content]));
        for (const q of questions ?? []) {
          notesRows.push({ id: q.id, content: (q.content ?? "").replace(/<[^>]+>/g, "").trim(), note: noteById.get(q.id) ?? "" });
        }
      }
    }
    if ((byType["收藏"] ?? 0) > 0) {
      const tree = await client.getCollectsTree(0, "desc").catch(() => []);
      const ids = [...new Set(flattenErrorTree(tree).flatMap((n) => n.questionIds))].slice(0, 60);
      if (ids.length) {
        const questions = await client.getQuestions(ids).catch(() => []);
        for (const q of questions ?? []) collectRows.push({ id: q.id, content: (q.content ?? "").replace(/<[^>]+>/g, "").trim() });
      }
    }
    writeText(
      path.join(dataDir, "笔记与收藏", "笔记与收藏.md"),
      renderNotesCollectsMd({ counts, notesRows, collectRows, syncedAt: startedAt })
    );
    writeJson(path.join(dataDir, "笔记与收藏", "notes-collects.json"), { counts, notes: notesRows, collects: collectRows });
    summary.datasets["notes-collects"] = {
      title: "笔记与收藏",
      items: (byType["笔记"] ?? 0) + (byType["收藏"] ?? 0),
      files: ["笔记与收藏/笔记与收藏.md", "笔记与收藏/notes-collects.json"],
    };
    log("笔记与收藏 ✓");
  }

  if (selected.has("mock-exams")) {
    log("拉取模考记录…");
    const mock = await client.getMockHistory();
    writeText(path.join(dataDir, "模考记录", "模考记录.md"), renderMockMd({ mock, syncedAt: startedAt }));
    writeJson(path.join(dataDir, "模考记录", "mock-exams.json"), mock);
    summary.datasets["mock-exams"] = {
      title: "模考记录",
      items: mock?.items?.length ?? 0,
      files: ["模考记录/模考记录.md", "模考记录/mock-exams.json"],
    };
    log("模考记录 ✓");
  }

  if (selected.has("shenlun-history") || selected.has("shenlun-details")) {
    log("拉取申论数据…");
    const slc = makeClient(cookieHeader, { prefix: "shenlun" });
    const userId = user?.id ?? user?.userId;
    const shenlunUser = await slc.getShenlunUserInfo(userId).catch((e) => ({ error: String(e.message ?? e) }));
    const combineHistory = await slc.getHistory({ categoryId: 4, maxItems: 100 }).catch(() => ({ historyItems: [] }));

    const briefItems = [];
    let briefPages = 0;
    let briefError = null;
    try {
      for (let page = 0; page < 10; page++) {
        const resp = await slc.getShenlunBriefReports({ status: 2, categoryId: 1, currentPage: page, pageSize: 15 });
        const batch = resp?.list ?? resp?.historyItems ?? [];
        briefItems.push(...batch);
        briefPages = resp?.pageInfo?.totalPage ?? 0;
        if (!batch.length || page + 1 >= briefPages) break;
      }
    } catch (e) {
      briefError = String(e.message ?? e);
    }
    const briefs = { items: briefItems, pages: briefPages, error: briefError };

    if (selected.has("shenlun-history")) {
      writeText(
        path.join(dataDir, "申论练习记录", "申论练习记录.md"),
        renderShenlunHistoryMd({ shenlunUser, combineHistory, briefs, syncedAt: startedAt })
      );
      writeJson(path.join(dataDir, "申论练习记录", "shenlun-history.json"), {
        user: shenlunUser,
        briefReports: briefs,
        combineHistory,
      });
      summary.datasets["shenlun-history"] = {
        title: "申论练习记录",
        items: briefItems.length + (combineHistory.historyItems?.length ?? 0),
        files: ["申论练习记录/申论练习记录.md", "申论练习记录/shenlun-history.json"],
      };
    }

    if (selected.has("shenlun-details")) {
      const candidates = new Map();
      for (const it of briefItems) {
        const id = it.exerciseId ?? it.id;
        if (id != null) candidates.set(String(id), it);
      }
      for (const it of combineHistory.historyItems ?? []) {
        const id = it.exerciseId ?? it.id;
        if (id != null && !candidates.has(String(id))) candidates.set(String(id), it);
      }
      const ids = [...candidates.keys()].slice(0, 20);
      let exported = 0;
      const dir = path.join(dataDir, "申论作答与批改");
      for (const id of ids) {
        const item = candidates.get(id);
        const bundle = { id, item, fetchedAt: Date.now() };
        try {
          bundle.detail = await slc.getShenlunExercise(id).catch((e) => ({ error: String(e.message ?? e) }));
          bundle.reportHtml = await slc.getShenlunReportRaw(id).catch(() => "");
          bundle.manualReportHtml = await slc.getShenlunManualReportRaw(id).catch(() => "");
          if (bundle.reportHtml) writeText(path.join(dir, `批改报告-${id}.html`), bundle.reportHtml);
          if (bundle.manualReportHtml) writeText(path.join(dir, `人工批改-${id}.html`), bundle.manualReportHtml);
          const questionIds = [
            ...new Set(
              [
                ...(item?.questionIds ?? []),
                ...(bundle.detail?.questionIds ?? []),
                ...(bundle.detail?.sheet?.questionIds ?? []),
              ].filter((x) => Number.isInteger(x))
            ),
          ].slice(0, 10);
          bundle.questions = questionIds.length ? await slc.getQuestions(questionIds).catch(() => []) : [];
          writeJson(path.join(dir, `练习-${id}.json`), bundle);
          writeText(
            path.join(dir, `练习-${id}.md`),
            renderShenlunExerciseMd({
              id,
              item,
              detail: bundle.detail,
              reportHtml: bundle.reportHtml,
              manualReportHtml: bundle.manualReportHtml,
              questions: bundle.questions ?? [],
              syncedAt: startedAt,
            })
          );
          exported++;
        } catch (e) {
          warnings.push(`申论练习 ${id} 导出失败：${e.message ?? e}`);
        }
      }
      summary.datasets["shenlun-details"] = {
        title: "申论作答与批改",
        items: exported,
        files: ids.map((id) => `申论作答与批改/练习-${id}.md`),
      };
      if (!ids.length) {
        warnings.push("申论暂无练习数据（批改报告将在完成第一场申论练习后产出）");
        writeText(
          path.join(dir, "说明.md"),
          [
            noteHeader({ 数据集: "申论作答与批改" }),
            "# 申论作答与批改",
            "",
            "当前账号还没有申论练习记录。",
            "",
            "完成第一场申论练习并同步后，这里会出现：",
            "",
            "- 练习-<id>.md：题目、得分与批改摘要",
            "- 练习-<id>.json：练习详情原始数据",
            "- 批改报告-<id>.html / 人工批改-<id>.html：批改报告原文（若平台提供）",
            "",
            "> 同步时间：" + fmtTime(startedAt) + "。",
            "",
          ].join("\n")
        );
        summary.datasets["shenlun-details"].files.push("申论作答与批改/说明.md");
      }
    }
    log("申论数据 ✓");
  }

  // 目录说明（始终刷新，保持与实际结构一致）
  writeText(path.join(dataDir, "00-说明.md"), renderReadmeMd({ dataDir }));

  const finishedAt = Date.now();
  const contents = {};
  for (const d of DATASETS) {
    const dir = path.join(dataDir, d.dir);
    if (!fs.existsSync(dir)) continue;
    const files = [];
    const walk = (base, rel = "") => {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(base, entry.name), childRel);
        else files.push(`${d.dir}/${childRel}`);
      }
    };
    walk(dir);
    contents[d.id] = { title: d.title, dir: d.dir, files };
  }
  const manifest = {
    app: "exam-workbench",
    appVersion: APP_VERSION,
    schema: 1,
    generatedAt: finishedAt,
    generatedAtText: fmtTime(finishedAt),
    dataDir,
    account: { id: user?.id ?? user?.userId, account: user?.phone ?? user?.identity ?? "" },
    exam: {
      path: category?.path ?? [],
      examCategoryId: category?.examCategoryId,
      prefix,
      course: category?.currentCourse?.name,
    },
    // 本次同步运行的选择与结果
    lastRun: {
      selection: [...selected],
      datasets: summary.datasets,
      warnings,
    },
    // 目录中当前实际存在的数据集文件（可能包含此前同步留下的内容）
    contents,
    redaction: ["phone", "identity"],
    neverExposed: NEVER_EXPOSED,
  };
  writeJson(path.join(dataDir, "manifest.json"), manifest);

  const statusLines = [
    noteHeader({ 数据集: "同步状态" }),
    "# 同步状态",
    "",
    `- 最近同步：${fmtTime(finishedAt)}`,
    `- 账号：${user?.phone ?? "-"}（脱敏）`,
    `- 考试类别：${(category?.path ?? []).join(" · ")}（${prefix}）`,
    "",
    "| 数据集 | 条目 | 文件 |",
    "|---|---|---|",
    ...Object.entries(summary.datasets).map(([, v]) => `| ${v.title} | ${v.items} | ${v.files.length} |`),
    "",
  ];
  if (warnings.length) {
    statusLines.push("## 提示");
    statusLines.push("");
    for (const w of warnings) statusLines.push(`- ${w}`);
    statusLines.push("");
  }
  writeText(path.join(dataDir, "状态", "同步状态.md"), statusLines.join("\n"));

  summary.ok = true;
  summary.finishedAt = finishedAt;
  summary.manifest = path.join(dataDir, "manifest.json");
  return summary;
}

export function readManifest(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

export { DATASETS };
