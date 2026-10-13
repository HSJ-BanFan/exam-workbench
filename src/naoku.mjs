// 考公脑库（第三方 Obsidian vault）索引层：稀疏克隆 → 扫描 → 建索引 → 只读查询。
// 本层只产出索引（JSON），不复制脑库正文；题面/材料原文始终由粉笔接口按 qid 取。

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

export const DEFAULT_REPO = "https://github.com/ERRRC/kaogongzhentizhengliu.git";

// 90-图片 是第三方配图（200MB+），与索引无关，导入时整体排除。
const SPARSE_PATTERNS = ["/*", "!/90-图片/"];
const SKIP_DIRS = new Set([".git", ".obsidian", "90-图片"]);

const TYPES = { 真题: "真题", 考点: "考点", 材料: "材料" };

const MAX_MUTI_CHARS = 300;
const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_MAX_LIMIT = 200;

function logNothing() {}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

// ---------------------------------------------------------------- git

function git(args, { cwd, allowFail = false } = {}) {
  try {
    const output = execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return output.includes("\0") ? output : output.trim();
  } catch (error) {
    if (allowFail) return null;
    const detail = String(error?.stderr ?? error?.message ?? error).trim();
    throw new Error(`git ${args.join(" ")} 执行失败：${detail}`);
  }
}

function isClone(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function rejectHiddenIndexChanges({ cwd }) {
  const entries = git(["ls-files", "-v", "-z"], { cwd }).split("\0").filter(Boolean);
  const parsed = entries
    .map((entry) => ({ tag: entry[0], filePath: entry.slice(2).replace(/\\/g, "/") }))
  const flagged = parsed.filter(({ tag, filePath }) =>
    tag !== "H" && !(tag === "S" && filePath.toLowerCase().startsWith("90-图片/"))
  );
  const modifiedSparseFiles = parsed.filter(({ tag, filePath }) => {
    if (tag !== "S" || !filePath.toLowerCase().startsWith("90-图片/")) return false;
    if (!fs.existsSync(path.join(cwd, filePath))) return false;
    const indexedBlob = git(["rev-parse", ":" + filePath], { cwd });
    const workingBlob = git(["hash-object", "--path=" + filePath, "--", filePath], { cwd });
    return indexedBlob !== workingBlob;
  });
  flagged.push(...modifiedSparseFiles);
  if (flagged.length) {
    const paths = [...new Set(flagged.map(({ filePath }) => filePath))].slice(0, 3).join("、");
    throw new Error(`脑库副本存在可能隐藏本地改动的索引标记（${paths}），为保护本地内容已取消更新。请先检查这些文件的 Git 索引状态后重试。`);
  }
}

function rejectIgnoredFileConflicts({ cwd, commit }) {
  const ignored = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], { cwd })
    .split("\0")
    .map((entry) => entry.replace(/\/+$/, ""))
    .filter(Boolean);
  if (!ignored.length) return;

  // sparse checkout includes the repository except for its large third-party image tree.
  const checkoutPaths = git(["ls-tree", "-r", "--name-only", "-z", commit], { cwd })
    .split("\0")
    .filter((entry) => entry && !entry.toLowerCase().startsWith("90-图片/"));
  const root = { children: new Map(), terminal: false };
  for (const checkoutPath of checkoutPaths) {
    let node = root;
    for (const segment of checkoutPath.toLowerCase().split("/")) {
      if (!node.children.has(segment)) node.children.set(segment, { children: new Map(), terminal: false });
      node = node.children.get(segment);
    }
    node.terminal = true;
  }

  const conflicts = [];
  for (const localPath of ignored) {
    let node = root;
    let conflict = false;
    const segments = localPath.replace(/\\/g, "/").toLowerCase().split("/");
    for (const segment of segments) {
      if (!node) break;
      if (node.terminal) {
        conflict = true;
        break;
      }
      node = node.children.get(segment);
    }
    if (node && (node.terminal || node.children.size > 0)) conflict = true;
    if (conflict) conflicts.push(localPath);
  }
  if (conflicts.length) {
    const paths = [...new Set(conflicts)].slice(0, 3).join("、");
    throw new Error(`脑库副本中的被忽略本地文件与远端路径冲突（${paths}），为保护本地内容已取消更新。请先备份或移走这些文件后重试。`);
  }
}

// 稀疏克隆或就地更新；目录结构固定，不含 90-图片，可重复运行。
export async function importVault({ dir, repo = DEFAULT_REPO, log = logNothing }) {
  if (typeof dir !== "string" || !dir.trim()) throw new Error("dir 必填（脑库本地目录）");
  const target = path.resolve(dir);
  const existing = isClone(target);

  if (!existing) {
    if (fs.existsSync(target) && fs.readdirSync(target).length) {
      throw new Error(`${target} 已存在且不是脑库副本，请先清空或换一个 naokuDir`);
    }
    log("未发现脑库副本，开始稀疏克隆（排除 90-图片，不下载配图）…");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    git(["clone", "--depth", "1", "--filter=blob:none", "--sparse", repo, target]);
    git(["sparse-checkout", "set", "--no-cone", ...SPARSE_PATTERNS], { cwd: target });
  } else {
    const originUrls = git(["remote", "get-url", "--all", "origin"], { cwd: target, allowFail: true })
      ?.split(/\r?\n/)
      .filter(Boolean) ?? [];
    if (!originUrls.length || originUrls.some((url) => url !== repo)) {
      throw new Error("脑库副本的 origin 与配置的脑库源不一致，为保护本地内容已取消更新。请检查 naokuDir 与 repo 配置后重试。");
    }
    rejectHiddenIndexChanges({ cwd: target });
    const dirty = git(["status", "--porcelain", "--untracked-files=all"], { cwd: target });
    if (dirty) {
      throw new Error("脑库副本存在未提交的本地改动，为保护本地内容已取消更新。请先备份或提交这些改动后重试。");
    }
    const head = git(["rev-parse", "HEAD"], { cwd: target });
    const upstream = git(["rev-parse", "@{upstream}"], { cwd: target, allowFail: true });
    const upstreamRef = git(["rev-parse", "--symbolic-full-name", "@{upstream}"], { cwd: target, allowFail: true });
    if (!upstream || !upstreamRef?.startsWith("refs/remotes/origin/")) {
      throw new Error("脑库副本没有可用的跟踪远端，为保护本地提交已取消更新。请先检查该副本后重试。");
    }
    const upstreamBranch = upstreamRef.slice("refs/remotes/origin/".length);
    const fetchRef = "refs/exam-workbench/naoku-refresh/" + randomUUID();
    const fetchRefspec = "+refs/heads/" + upstreamBranch + ":" + fetchRef;
    const currentBase = git(["merge-base", head, upstream], { cwd: target, allowFail: true });
    if (head !== upstream && currentBase !== null && currentBase !== head) {
      throw new Error("脑库副本当前版本包含未推送的本地提交或与跟踪远端分叉，为保护本地提交已取消更新。请先备份或检查该副本后重试。");
    }
    try {
      log("脑库副本已存在，拉取远端最新并重放 sparse 规则…");
      git(["fetch", "--depth", "1", "--no-tags", repo, fetchRefspec], { cwd: target });
      let fetched = git(["rev-parse", fetchRef], { cwd: target });
      let refreshedBase = git(["merge-base", head, fetched], { cwd: target, allowFail: true });
      const isShallow = git(["rev-parse", "--is-shallow-repository"], { cwd: target }) === "true";
      let historyCount = Number(git(["rev-list", "--count", fetched], { cwd: target }));
      for (let depth = 1; isShallow && head !== fetched && refreshedBase !== head; depth *= 4) {
        git(["fetch", "--deepen=" + depth, "--no-tags", repo, fetchRefspec], { cwd: target });
        fetched = git(["rev-parse", fetchRef], { cwd: target });
        refreshedBase = git(["merge-base", head, fetched], { cwd: target, allowFail: true });
        if (refreshedBase === head) break;
        const nextHistoryCount = Number(git(["rev-list", "--count", fetched], { cwd: target }));
        if (nextHistoryCount <= historyCount) break;
        historyCount = nextHistoryCount;
      }
      if (head !== fetched && refreshedBase !== head) {
        throw new Error("脑库副本当前版本与待更新远端版本不是快进关系，为保护本地提交已取消更新。请先备份或检查该副本后重试。");
      }
      const dirtyAfterFetch = git(["status", "--porcelain", "--untracked-files=all"], { cwd: target });
      let dirtyIndexAfterFetch = false;
      try {
        rejectHiddenIndexChanges({ cwd: target });
      } catch {
        dirtyIndexAfterFetch = true;
      }
      if (dirtyAfterFetch || dirtyIndexAfterFetch) {
        throw new Error("脑库副本在检查期间出现本地改动，为保护本地内容已取消更新。请先备份或提交这些改动后重试。");
      }
      rejectIgnoredFileConflicts({ cwd: target, commit: fetched });
      // 先重放 sparse 规则再重置工作树，避免旧规则把 90-图片 拉回来。
      git(["sparse-checkout", "set", "--no-cone", ...SPARSE_PATTERNS], { cwd: target });
      rejectIgnoredFileConflicts({ cwd: target, commit: fetched });
      git(["reset", "--keep", fetched], { cwd: target });
      git(["update-ref", upstreamRef, fetched, upstream], { cwd: target });
    } finally {
      git(["update-ref", "-d", fetchRef], { cwd: target, allowFail: true });
    }
  }

  const commit = git(["rev-parse", "HEAD"], { cwd: target, allowFail: true });
  log(`${existing ? "更新完成" : "克隆完成"}：${target}${commit ? ` @ ${commit.slice(0, 10)}` : ""}`);
  return { ok: true, dir: target, repo, commit, cloned: !existing };
}

// ---------------------------------------------------------------- 解析

// 脑库只有一层扁平 YAML：带引号串、裸标量、["a","b"] 数组。够用即可，不引 YAML 库。
function parseScalar(raw) {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      /* 极少数非 JSON 数组，退化为按逗号切分 */
    }
    return value
      .slice(1, -1)
      .split(",")
      .map((x) => x.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseFrontmatter(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    data[line.slice(0, at).trim()] = parseScalar(line.slice(at + 1));
  }
  return { data, body: body.slice(match[0].length) };
}

function wikilinkTargets(markdown, prefix) {
  const out = [];
  for (const match of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = match[1].split("|")[0].split("#")[0].trim().replace(/\\/g, "/");
    if (target.startsWith(prefix)) out.push(target);
  }
  return out;
}

function leadingNumber(name) {
  const match = String(name).match(/^(\d+)/);
  return match ? match[1] : null;
}

// 取「核心立场（母题抽象）」小节第一条 bullet，去掉列表符号与 🧩 标记。
function firstBullet(markdown, headingPrefix) {
  let inside = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#{2,6}\s/.test(line)) {
      if (inside) return "";
      inside = line.replace(/^#+\s*/, "").trim().startsWith(headingPrefix);
      continue;
    }
    if (!inside) continue;
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      return bullet[1].replace(/^\s*🧩\s*/, "").trim().slice(0, MAX_MUTI_CHARS);
    }
  }
  return "";
}

function listMarkdownFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith(".md")) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return files;
}

// ---------------------------------------------------------------- 建索引

export async function buildIndex({ vaultDir, log = logNothing }) {
  if (typeof vaultDir !== "string" || !vaultDir.trim()) throw new Error("vaultDir 必填");
  const root = path.resolve(vaultDir);
  if (!fs.existsSync(root)) throw new Error(`脑库目录不存在：${root}（先运行 naoku 导入）`);

  const startedAt = Date.now();
  const warnings = [];
  const 真题 = [];
  const 考点 = [];
  const 材料 = [];
  const files = listMarkdownFiles(root);
  let skipped = 0;

  for (const file of files) {
    const relPath = toPosix(path.relative(root, file));
    const parsed = parseFrontmatter(fs.readFileSync(file, "utf8"));
    if (!parsed) {
      skipped++;
      continue;
    }
    const { data, body } = parsed;
    // 类型是唯一的形状判据：00-总览 与疑点清单的形状不同，直接跳过。
    const type = String(data.类型 ?? "");
    const segments = relPath.split("/");
    if (type === TYPES.真题 && segments[0] === "10-真题") {
      const qid = String(data.qid ?? leadingNumber(path.basename(file)) ?? "");
      const base = path.basename(file, ".md");
      const 考点路径 = wikilinkTargets(body, "20-考点/")[0] ?? "";
      const 材料链接 = wikilinkTargets(body, "15-材料/")[0] ?? "";
      const 相关题 = [];
      for (const target of wikilinkTargets(body, "10-真题/")) {
        const targetQid = leadingNumber(target.split("/").pop());
        if (targetQid && targetQid !== qid && !相关题.includes(targetQid)) 相关题.push(targetQid);
      }
      真题.push({
        qid,
        模块: segments[1] ?? "",
        大类: segments[2] ?? "",
        考点: String(data.考点 ?? ""),
        考点路径,
        地区: String(data.地区 ?? ""),
        年份: String(data.年份 ?? ""),
        试卷: String(data.试卷 ?? ""),
        标题: base.startsWith(`${qid} `) ? base.slice(qid.length + 1) : base,
        相关题,
        材料: leadingNumber(材料链接.split("/").pop()),
        path: relPath,
      });
      continue;
    }
    if (type === TYPES.考点 && segments[0] === "20-考点") {
      考点.push({
        // 路径里的模块/大类才是层级，frontmatter 的「模块」字段等于大类名。
        模块: segments[1] ?? "",
        大类: segments[2] ?? "",
        考点: String(data.考点 ?? path.basename(file, ".md")),
        题数: Number(data.题数) || 0,
        地区数: Number(data.地区数) || 0,
        母题: firstBullet(body, "核心立场"),
        真题: [],
        path: relPath,
      });
      continue;
    }
    if (type === TYPES.材料 && segments[0] === "15-材料") {
      const mid = String(data.mid ?? leadingNumber(path.basename(file)) ?? "");
      材料.push({
        mid,
        模块: segments[1] ?? "",
        材料主题: String(data.材料主题 ?? ""),
        小题数: Number(data.小题数) || 0,
        真题: [],
        path: relPath,
      });
      continue;
    }
    skipped++;
  }

  // 链接方向是真题 → 考点/材料，反向分组只能这么得到：MOC 正文的链接列表不全。
  const 考点ByPath = new Map(考点.map((r) => [r.path.replace(/\.md$/, ""), r]));
  const 材料ByMid = new Map(材料.map((r) => [r.mid, r]));
  let 考点未命中 = 0;
  let 材料未命中 = 0;
  for (const row of 真题) {
    if (!row.考点路径) {
      考点未命中++;
    } else {
      const point = 考点ByPath.get(row.考点路径);
      if (point) point.真题.push(row.qid);
      else 考点未命中++;
    }
    if (!row.材料) {
      continue;
    }
    const material = 材料ByMid.get(row.材料);
    if (material) material.真题.push(row.qid);
    else 材料未命中++;
  }

  // 反查结果的顺序取决于扫描顺序，按 qid 排一次让索引可复现。
  const byQid = (a, b) => Number(a) - Number(b);
  for (const row of 考点) row.真题.sort(byQid);
  for (const row of 材料) row.真题.sort(byQid);

  const mismatch = 考点.filter((r) => r.题数 !== r.真题.length);
  if (mismatch.length) {
    const sample = mismatch.slice(0, 5).map((r) => `${r.考点}(frontmatter ${r.题数}/反查 ${r.真题.length})`);
    warnings.push(`考点题数与真题反查不一致 ${mismatch.length} 处，例如：${sample.join("、")}`);
  }
  if (考点未命中) warnings.push(`${考点未命中} 篇真题没有可解析的考点链接（或指向不存在的考点笔记）`);
  if (材料未命中) warnings.push(`${材料未命中} 篇真题指向了不存在的材料笔记`);
  if (skipped) warnings.push(`跳过 ${skipped} 篇非索引笔记（总览、使用说明、复核清单或无 frontmatter）`);

  const modules = [...new Set([...真题, ...考点, ...材料].map((r) => r.模块))].filter(Boolean).sort();
  const index = {
    真题,
    考点,
    材料,
    warnings,
    counts: {
      真题: 真题.length,
      考点: 考点.length,
      材料: 材料.length,
      笔记总数: files.length,
      考点链接未命中: 考点未命中,
      材料链接未命中: 材料未命中,
    },
    模块列表: modules,
    // 目录不在仓库里时不要借用外层仓库的 HEAD 冒充脑库版本。
    vault: { dir: root, commit: isClone(root) ? git(["rev-parse", "HEAD"], { cwd: root, allowFail: true }) : null },
    scannedAt: startedAt,
  };
  log(
    `扫描 ${files.length} 篇笔记：真题 ${真题.length}、考点 ${考点.length}、材料 ${材料.length}（${Math.round((Date.now() - startedAt) / 100) / 10}s）`
  );
  return index;
}

// ---------------------------------------------------------------- 写盘

export function writeIndex({ outDir, index, manifest = {} }) {
  if (!outDir) throw new Error("outDir 必填");
  if (!index?.真题) throw new Error("index 必填（先调用 buildIndex）");
  fs.mkdirSync(outDir, { recursive: true });
  const writeJson = (name, data) => {
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2), "utf8");
  };
  writeJson("真题.json", index.真题);
  writeJson("考点.json", index.考点);
  writeJson("材料.json", index.材料);

  const generatedAt = Date.now();
  const finalManifest = {
    app: "exam-workbench",
    type: "naoku-index",
    schema: 1,
    generatedAt,
    generatedAtText: new Date(generatedAt).toISOString(),
    counts: index.counts,
    模块列表: index.模块列表 ?? [],
    vault: index.vault ?? {},
    warnings: index.warnings ?? [],
    files: [
      "脑库索引/真题.json",
      "脑库索引/考点.json",
      "脑库索引/材料.json",
      "脑库索引/manifest.json",
      "脑库索引/README.md",
    ],
    ...manifest,
  };
  writeJson("manifest.json", finalManifest);
  fs.writeFileSync(path.join(outDir, "README.md"), renderIndexReadme(finalManifest), "utf8");
  return finalManifest;
}

function renderIndexReadme(manifest) {
  const vaultDir = manifest.vault?.dir ?? "-";
  const commit = manifest.vault?.commit ? manifest.vault.commit.slice(0, 10) : "-";
  // 本文件落在用户库目录里，frontmatter 必须带库校验器要求的 type/status/sample 三件套。
  return [
    "---",
    "type: generated",
    "status: active",
    "sample: false",
    '来源: "考公脑库（第三方，CC BY-NC 4.0）"',
    `同步时间: "${manifest.generatedAtText}"`,
    "---",
    "",
    "# 考公脑库索引",
    "",
    "第三方标注库「考公脑库」的**索引**（不是内容副本）。脑库只覆盖行测的「资料分析」「判断推理」两个模块。",
    "",
    "| 文件 | 内容 |",
    "|---|---|",
    "| `真题.json` | 每题一条：qid、模块/大类/考点、地区/年份/试卷、相关题 qid、材料 mid、笔记路径 |",
    "| `考点.json` | 每个考点一条：题数、地区数、母题摘要、命中该考点的 qid 列表 |",
    "| `材料.json` | 每份材料一条：mid、小题数、引用该材料的 qid 列表 |",
    "| `manifest.json` | 计数、模块、vault 路径与 commit、许可与出处 |",
    "",
    "## 用法",
    "",
    "1. 用粉笔侧数据（`题解/`、`错题本/`）拿到本人练习过的 qid。",
    "2. 用 `真题.json` 按 qid 连到考点与相关题；用 `path` 读脑库笔记正文（本地 HTTP 接口 `GET /api/naoku/note?path=`）。",
    "3. **题面原文不在本索引里**，用 `GET /api/tiku/questions?prefix=xingce&ids=<qid>` 取。",
    "",
    "## 出处与许可",
    "",
    "- 脑库：https://github.com/ERRRC/kaogongzhentizhengliu （CC BY-NC 4.0，非商业使用；题面/材料/图片权利归原出题机构）",
    "- 本索引只记录连接关系与短摘要，不含题面、材料正文与图片；本目录可随时由脑库重新生成。",
    `- vault：\`${vaultDir}\` @ ${commit}`,
    `- 生成时间：${manifest.generatedAtText}`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- 查询

function filterValue(actual, wanted) {
  return String(actual ?? "").includes(String(wanted));
}

export function searchIndex(index, { type = "真题", q, 模块, 大类, 地区, 年份, 考点, limit } = {}) {
  const rows = index?.[type];
  if (!Array.isArray(rows)) throw new Error(`未知索引类型：${type}（可选：真题、考点、材料）`);
  const take = Math.min(Math.max(Number(limit) || SEARCH_DEFAULT_LIMIT, 1), SEARCH_MAX_LIMIT);
  const keyword = String(q ?? "").trim().toLowerCase();
  const items = rows.filter((row) => {
    if (模块 && !filterValue(row.模块, 模块)) return false;
    if (大类 && !filterValue(row.大类, 大类)) return false;
    if (地区 && !filterValue(row.地区, 地区)) return false;
    if (年份 && !filterValue(row.年份, 年份)) return false;
    if (考点) {
      const hit = filterValue(row.考点, 考点) || filterValue(row.考点路径, 考点) || filterValue(row.母题, 考点);
      if (!hit) return false;
    }
    if (!keyword) return true;
    return Object.values(row).some((value) => {
      if (value == null) return false;
      if (Array.isArray(value)) return value.some((v) => String(v).toLowerCase().includes(keyword));
      return typeof value === "object" ? false : String(value).toLowerCase().includes(keyword);
    });
  });
  return {
    type,
    total: items.length,
    limit: take,
    items: items.slice(0, take),
  };
}

export function forQuestion(index, qid) {
  const wanted = String(qid ?? "").trim();
  if (!wanted) throw new Error("qid 必填");
  const 笔记 = (index?.真题 ?? []).find((r) => r.qid === wanted) ?? null;
  const 考点记录 = 笔记?.考点路径
    ? (index?.考点 ?? []).find((r) => r.path.replace(/\.md$/, "") === 笔记.考点路径) ?? null
    : null;
  const 材料记录 = 笔记?.材料 ? (index?.材料 ?? []).find((r) => r.mid === 笔记.材料) ?? null : null;
  const byQid = new Map((index?.真题 ?? []).map((r) => [r.qid, r]));
  const 相关题 = (笔记?.相关题 ?? []).map((id) => byQid.get(id) ?? { qid: id, path: null });
  return { qid: wanted, 笔记, 考点: 考点记录, 材料: 材料记录, 相关题 };
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// 本地服务只监听 127.0.0.1，但仍必须挡住 ../ 与符号链接越界读。
export function readNote({ vaultDir, relPath }) {
  if (!vaultDir) throw new Error("vaultDir 必填");
  if (typeof relPath !== "string" || !relPath.trim()) throw new Error("path 必填（脑库内的相对路径）");
  if (relPath.includes("\0")) throw new Error("path 非法");
  if (path.isAbsolute(relPath)) throw new Error("path 必须是 vault 内的相对路径");
  const root = fs.realpathSync(path.resolve(vaultDir));
  const resolved = path.resolve(root, relPath);
  if (!inside(root, resolved)) throw new Error("path 越界：只允许读取脑库目录内的文件");
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw new Error(`脑库中不存在该文件：${relPath}`);
  }
  if (!inside(root, real)) throw new Error("path 越界：只允许读取脑库目录内的文件");
  if (!fs.statSync(real).isFile()) throw new Error("path 不是文件");
  return { path: toPosix(path.relative(root, real)), content: fs.readFileSync(real, "utf8") };
}
