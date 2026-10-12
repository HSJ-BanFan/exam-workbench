// SaDuck（saduck.top）只读数据：数据集目录 + 经 webview 会话调用 + 导出。
// 凭据处理：token 存在 persist:saduck 分区的 localStorage 里，只在该页面内使用；
// 本模块不落盘任何 token，导出物不含凭据。

import fs from "node:fs";
import path from "node:path";

export const SADUCK_ORIGIN = "https://saduck.top";
export const SADUCK_API = `${SADUCK_ORIGIN}/api`;
export const SADUCK_PARTITION = "persist:saduck";

// dir 与命令行客户端 saduck-cli 的输出目录同名，两种触发方式产物一致。
export const SADUCK_DATASETS = [
  {
    id: "time",
    name: "计时记录",
    dir: "计时记录",
    path: "/myTime/list",
    body: {},
    default: true,
    sensitivity: "低",
    description: "计时助手保存的学习计时记录。",
    agentUse: "统计各模块学习时长与节奏。",
  },
  {
    id: "plan",
    name: "每日打卡",
    dir: "每日打卡",
    path: "/plan/list",
    body: {},
    default: true,
    sensitivity: "低",
    description: "每日打卡记录。",
    agentUse: "检查学习连续性与打卡节奏。",
  },
  {
    id: "words",
    name: "生词锦囊",
    dir: "生词锦囊",
    path: "/myWord/list",
    body: {},
    default: true,
    sensitivity: "中（本人保存的词语）",
    description: "本人生词锦囊里保存的词语与释义。",
    agentUse: "词语复盘与行测词汇积累清单。",
  },
  {
    id: "read",
    name: "晨读收藏",
    dir: "晨读收藏",
    path: "/article/getMyList",
    body: {},
    default: true,
    sensitivity: "低（仅收藏列表，不含正文）",
    description: "本人晨读收藏的文章列表。",
    agentUse: "了解时政学习覆盖面，按需再回站点阅读。",
  },
  {
    id: "sl",
    name: "申论练习记录",
    dir: "申论练习记录",
    path: "/sl/getMySl",
    body: {},
    default: true,
    sensitivity: "中（本人申论作答记录）",
    description: "本人申论练习记录列表。",
    agentUse: "申论进度追踪与逐场复盘。",
  },
  {
    id: "wrong",
    name: "错题列表",
    dir: "错题列表",
    path: "/tk/getCt",
    body: {},
    default: true,
    sensitivity: "中（本人错题集合）",
    description: "本人行测错题列表。",
    agentUse: "复习队列生成与薄弱点排序。",
  },
  {
    id: "tklog",
    name: "行测练习记录",
    dir: "行测练习记录",
    path: "/tk/recordNew?type=1",
    body: {},
    default: true,
    sensitivity: "低",
    description: "本人行测练习记录与模块统计树（tkMyRecords + myNodes）。",
    agentUse: "练题量、对错分布与模块覆盖统计。",
  },
  {
    id: "bxcy",
    name: "词语辨析练习组",
    dir: "词语辨析",
    path: "/analyze/getBxCy",
    body: {},
    default: false,
    sensitivity: "中（站点练习内容，非本人记录）",
    description: "词语辨析工具返回的练习组（站点内容），默认不导出。",
    agentUse: "按需查看当前练习词语组；不纳入默认同步。",
  },
];

export const SADUCK_DATASET_IDS = SADUCK_DATASETS.map((d) => d.id);

export function defaultSaduckSelection() {
  return SADUCK_DATASETS.filter((d) => d.default).map((d) => d.id);
}

export function saduckDatasetById(id) {
  return SADUCK_DATASETS.find((d) => d.id === id) ?? null;
}

export function resolveSaduckDatasets(ids) {
  if (!Array.isArray(ids)) throw new TypeError("SaDuck 数据集列表必须是数组");
  const unknown = [...new Set(ids.filter((id) => !SADUCK_DATASET_IDS.includes(id)))];
  if (unknown.length) throw new Error(`未知数据集：${unknown.map(String).join("、")}`);
  return SADUCK_DATASETS.filter((dataset) => ids.includes(dataset.id));
}

export function maskEmail(value) {
  const s = String(value ?? "");
  const at = s.indexOf("@");
  return at > 1 ? `${s.slice(0, 2)}***${s.slice(at)}` : "***";
}

export const SADUCK_NEVER_EXPOSED = [
  "登录 token 与账号邮箱",
  "任何写操作（提交、打卡、加词、删除、支付等）",
  "站点正文内容（词库查询、试卷与晨读正文、题库内容）",
];

// ---------------------------------------------------------------- webview 调用

export async function readSaduckToken(webContents) {
  if (!webContents || webContents.isDestroyed()) return null;
  try {
    if (!webContents.getURL().startsWith(SADUCK_ORIGIN)) return null;
    const token = await webContents.executeJavaScript('localStorage.getItem("token")', true);
    return typeof token === "string" && token.length > 20 ? token : null;
  } catch {
    return null;
  }
}

// 在 saduck.top 页面上下文里发请求：同源直连，token 不出页面。
export async function callSaduckApi(webContents, urlPath, body = {}) {
  if (!webContents || webContents.isDestroyed() || !webContents.getURL().startsWith(SADUCK_ORIGIN)) {
    return { code: 100, message: "SaDuck 页面未就绪" };
  }
  const url = `${SADUCK_API}${urlPath}`;
  const script = `(async () => {
    try {
      const token = localStorage.getItem("token") || "";
      if (!token || token === "null") return JSON.stringify({ code: 100, message: "未登录" });
      const res = await fetch(${JSON.stringify(url)}, {
        method: "POST",
        headers: { "content-type": "application/json", token },
        body: ${JSON.stringify(JSON.stringify(body))},
      });
      return await res.text();
    } catch (error) {
      return JSON.stringify({ code: -1, message: String((error && error.message) || error) });
    }
  })()`;
  const text = await webContents.executeJavaScript(script, true);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`SaDuck 返回非 JSON：${String(text).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------- 渲染与写出

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

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function frontmatter(dataset, stamp) {
  return [
    "---",
    'type: "generated"',
    'status: "active"',
    "sample: false",
    '来源: "SaDuck（本人账号只读同步）"',
    `同步时间: "${stamp}"`,
    `数据集: "${dataset}"`,
    "---",
    "",
  ].join("\n");
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

const isScalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

function cell(value) {
  const raw =
    value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const s = stripHtml(raw).replace(/\|/g, "\\|");
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

function mdTable(rows, { maxRows = 300 } = {}) {
  const objs = rows.filter((r) => r && typeof r === "object" && !Array.isArray(r));
  if (!objs.length) return "（无表格化数据，完整内容见同目录 JSON）";
  const keys = [];
  for (const r of objs.slice(0, 60)) {
    for (const k of Object.keys(r)) {
      if (!keys.includes(k) && isScalar(r[k])) keys.push(k);
    }
  }
  const cols = keys.slice(0, 12);
  if (!cols.length) return "（无表格化数据，完整内容见同目录 JSON）";
  const shown = objs.slice(0, maxRows);
  const lines = [
    `| ${cols.join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...shown.map((r) => `| ${cols.map((k) => cell(r[k])).join(" | ")} |`),
  ];
  if (objs.length > maxRows) lines.push("", `> 表格仅显示前 ${maxRows} 行，完整数据见 JSON。`);
  return lines.join("\n");
}

function renderPayload(result) {
  if (result === null || result === undefined) return "（暂无数据）";
  if (Array.isArray(result)) {
    if (!result.length) return "（暂无数据）";
    return [`共 ${result.length} 条。`, "", mdTable(result)].join("\n");
  }
  if (typeof result === "object") {
    const lines = [];
    for (const [k, v] of Object.entries(result)) {
      if (isScalar(v)) lines.push(`- ${k}: ${cell(v)}`);
    }
    for (const [k, v] of Object.entries(result)) {
      if (Array.isArray(v)) {
        lines.push("", `## ${k}（${v.length} 条）`, "", v.length ? mdTable(v) : "（暂无数据）");
      }
    }
    return lines.length ? lines.join("\n") : "（空对象）";
  }
  return cell(result);
}

function renderReadmeMd(outDir, stamp) {
  return [
    frontmatter("说明", stamp),
    "# SaDuck 同步目录说明",
    "",
    "本目录由本地只读同步写入：只读同步**本人账号**在 saduck.top 上产生的学习数据，",
    "供本地 AI agent（Codex / Claude 等）做分析。请勿手动改写机器文件。",
    "",
    "## 目录结构",
    "",
    "```",
    "SaDuck同步/",
    "├── manifest.json      # 机器索引：账号、数据集、文件清单、同步时间",
    "├── 00-说明.md          # 本目录说明",
    "├── 状态/同步状态.md     # 最近一次同步摘要",
    "├── AI分析/             # 复盘产物（人工/AI 写入）",
    "├── 计时记录/",
    "├── 每日打卡/",
    "├── 生词锦囊/",
    "├── 晨读收藏/",
    "├── 申论练习记录/",
    "├── 错题列表/",
    "└── 行测练习记录/",
    "```",
    "",
    "## 边界",
    "",
    "- 只包含本人账号产生的数据；词库查询、试卷/晨读正文等站点内容不在同步范围。",
    "- 词语辨析练习组是站点练习内容而非本人记录，默认不导出。",
    "- 不含登录凭据；邮箱已脱敏；同步全程只读，不调用任何写接口。",
    "- 本目录是「数据快照」，不是学习记录；确认后的结论应写入 `20-日志` 或 `40-错题`。",
    "",
    `> 生成时间：${stamp}（数据目录：\`${outDir}\`）`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- 同步

export async function runSaduckSync({ web, outDir, datasets, log = () => {} }) {
  const startedAt = Date.now();
  const stamp = fmtTime(startedAt);
  const selected = resolveSaduckDatasets(datasets);
  const warnings = [];
  const entries = {};
  const written = [];

  ensureDir(outDir);
  ensureDir(path.join(outDir, "AI分析"));

  log("校验 SaDuck 会话…");
  const verify = await callSaduckApi(web, "/user/verify");
  if (verify.code === 100 || verify.code === 101) {
    throw new Error("未登录：请先在「SaDuck」页登录 saduck.top");
  }
  if (verify.code !== 0 && verify.code !== 102) {
    throw new Error(`SaDuck 会话校验失败：${verify.code} ${verify.message ?? ""}`);
  }
  const account = {
    emailMasked: maskEmail(verify.result?.email),
    vipType: verify.result?.vipType ?? null,
    vipEndTime: verify.result?.vipEndTime ?? null,
  };
  if (verify.code === 102) warnings.push("会员状态为受限（code 102）");
  if (selected.length === 0) warnings.push("未选择任何要同步的数据集");

  for (const ds of selected) {
    try {
      const j = await callSaduckApi(web, ds.path, ds.body);
      if (j.code === 100 || j.code === 101) throw new Error("SaDuck 会话已失效（请重新登录）");
      if (j.code === 102) {
        entries[ds.id] = { title: ds.name, items: 0, status: "vip", message: j.message || "会员功能受限", files: [] };
        log(`${ds.name}：会员受限`);
        continue;
      }
      if (j.code !== 0) {
        entries[ds.id] = { title: ds.name, items: 0, status: "error", message: `${j.code} ${j.message ?? ""}`, files: [] };
        log(`${ds.name}：失败（${j.code} ${j.message ?? ""}）`);
        continue;
      }
      const dir = path.join(outDir, ds.dir);
      const mdRel = `${ds.dir}/${ds.name}.md`;
      const jsonRel = `${ds.dir}/${ds.id}.json`;
      const count = Array.isArray(j.result) ? j.result.length : null;
      writeText(
        path.join(dir, `${ds.name}.md`),
        [
          frontmatter(ds.name, stamp),
          `# ${ds.name}`,
          "",
          renderPayload(j.result),
          "",
          `> 同步时间：${stamp}。只读快照，完整结构化数据见 \`${ds.id}.json\`。`,
          "",
        ].join("\n")
      );
      writeJson(path.join(dir, `${ds.id}.json`), { 同步时间: stamp, 数据集: ds.name, result: j.result });
      entries[ds.id] = { title: ds.name, items: count ?? 0, status: "ok", message: "", files: [mdRel, jsonRel] };
      written.push(mdRel, jsonRel);
      log(`${ds.name} ✓${count === null ? "" : `（${count} 条）`}`);
    } catch (error) {
      entries[ds.id] = { title: ds.name, items: 0, status: "error", message: String(error?.message ?? error), files: [] };
      log(`${ds.name}：失败（${error?.message ?? error}）`);
    }
  }

  writeText(path.join(outDir, "00-说明.md"), renderReadmeMd(outDir, stamp));

  const statusLines = [
    frontmatter("同步状态", stamp),
    "# 同步状态",
    "",
    `- 账号：${account.emailMasked}（vipType=${account.vipType ?? "?"}，到期 ${account.vipEndTime ?? "?"}）`,
    `- 同步时间：${stamp}`,
    `- 输出目录：${outDir}`,
    "",
    "| 数据集 | 状态 | 条数 | 说明 |",
    "|---|---|---|---|",
    ...Object.values(entries).map((v) => {
      const label = { ok: "成功", vip: "会员受限", error: "失败" }[v.status] ?? v.status;
      return `| ${v.title} | ${label} | ${v.items} | ${v.message || ""} |`;
    }),
    "",
  ].join("\n");
  writeText(path.join(outDir, "状态", "同步状态.md"), statusLines);

  const finishedAt = Date.now();
  const manifest = {
    app: "exam-workbench",
    source: "saduck.top 只读同步",
    schema: 1,
    generatedAt: new Date(finishedAt).toISOString(),
    generatedAtText: stamp,
    outDir,
    account,
    datasets: Object.entries(entries).map(([id, v]) => ({
      id,
      name: v.title,
      state: v.status,
      count: v.items,
      message: v.message,
    })),
    files: [...written, "00-说明.md", "状态/同步状态.md"],
    neverExposed: SADUCK_NEVER_EXPOSED,
  };
  writeJson(path.join(outDir, "manifest.json"), manifest);

  const failed = Object.entries(entries).filter(([, v]) => v.status === "error");
  const isOk = failed.length === 0;
  let errorText;
  if (!isOk) {
    const names = failed.map(([id, v]) => (v.title ? `${v.title}（${id}）` : id)).join("、");
    if (failed.length === selected.length && selected.length > 0) {
      errorText = `数据集同步失败：${names}`;
    } else {
      errorText = `部分数据集同步失败：${names}`;
    }
  }

  return {
    ok: isOk,
    ...(errorText ? { error: errorText } : {}),
    startedAt,
    finishedAt,
    outDir,
    account,
    datasets: entries,
    warnings,
    manifest: path.join(outDir, "manifest.json"),
  };
}

export function readSaduckManifest(outDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}
