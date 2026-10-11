// Electron 主进程：webview 刷题窗口 + 数据同步 + 本机 HTTP 接口。

import { app, BrowserWindow, ipcMain, session, shell, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync, readManifest } from "./sync.mjs";
import { DATASETS, DATASET_IDS, defaultSelection, datasetById } from "./datasets.mjs";
import { createApiServer } from "./server.mjs";
import { makeClient } from "./fenbi-api.mjs";
import { buildIndex, writeIndex, searchIndex, forQuestion, readNote, importVault, DEFAULT_REPO } from "./naoku.mjs";
import {
  SADUCK_DATASETS,
  SADUCK_DATASET_IDS,
  SADUCK_ORIGIN,
  SADUCK_PARTITION,
  defaultSaduckSelection,
  maskEmail,
  readSaduckToken,
  callSaduckApi,
  runSaduckSync,
  readSaduckManifest,
  saduckDatasetById,
} from "./saduck.mjs";
import { buildAgentManifest, readAgentSkill } from "./agent-surface.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const APP_VERSION = "0.3.0";
const PARTITION = "persist:fenbi";
const TIKU_HOME = "https://www.fenbi.com/spa/tiku/guide/redirect";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

// 默认输出目录：用户「文档」目录下的 fenbi-sync（可在应用设置中修改；已存在 config.json 的安装不受影响）。
function defaultDataDir() {
  try {
    return path.join(app.getPath("documents"), "fenbi-sync");
  } catch {
    return path.join(ROOT, "data");
  }
}

// 可选：把一份 session.json（含 sess/userid/persistent）放到应用数据目录，首次启动时可导入登录态。
function defaultBootstrapPath() {
  try {
    return path.join(app.getPath("userData"), "session.json");
  } catch {
    return "";
  }
}

// 脑库副本默认放应用数据目录，不放 dataDir：dataDir 通常位于 Obsidian 库内，
// 而脑库是 2 万余篇外来笔记，落进去会污染库图谱，并让库校验器逐篇报 type 无效。
function defaultNaokuDir() {
  try {
    return path.join(app.getPath("userData"), "考公脑库");
  } catch {
    return path.join(ROOT, "考公脑库");
  }
}

// SaDuck 输出目录：默认与「粉笔同步」同级的「SaDuck同步」；其他数据目录回落文档目录。
function defaultSaduckDir(dataDir) {
  try {
    const base = path.basename(dataDir);
    if (base === "粉笔同步") return path.join(path.dirname(dataDir), "SaDuck同步");
    if (base === "fenbi-sync") return path.join(path.dirname(dataDir), "saduck-sync");
    return path.join(app.getPath("documents"), "saduck-sync");
  } catch {
    return path.join(ROOT, "saduck-data");
  }
}

// 可选：把含 token 的 saduck-cli session.json 放到应用数据目录，首次启动时导入一次。
function defaultSaduckBootstrapPath() {
  try {
    return path.join(app.getPath("userData"), "saduck-session.json");
  } catch {
    return "";
  }
}

const isSelfTest = process.argv.includes("--self-test");
const isSyncOnly = process.argv.includes("--sync-only");
const isNaokuImport = process.argv.includes("--naoku-import");
const SELFTEST_DIR = process.env.SELFTEST_DIR ?? path.join(ROOT, ".selftest");

// 供自动化测试与多实例运行：把 userData 指到独立目录（默认不动真实配置）。
if (process.env.EXAM_WORKBENCH_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.EXAM_WORKBENCH_USER_DATA));
}

// ---------------------------------------------------------------- config

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadConfig() {
  const dataDir = defaultDataDir();
  const defaults = {
    dataDir,
    port: 8791,
    token: "",
    datasets: defaultSelection(),
    autoSyncOnLaunch: true,
    bootstrapSessionPath: defaultBootstrapPath(),
    naokuDir: defaultNaokuDir(),
    naokuRepo: DEFAULT_REPO,
    saduckDir: defaultSaduckDir(dataDir),
    saduckDatasets: defaultSaduckSelection(),
    saduckBootstrapPath: defaultSaduckBootstrapPath(),
  };
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const merged = {
      ...defaults,
      ...saved,
      datasets: sanitizeDatasets(saved.datasets, defaults.datasets),
      saduckDatasets: sanitizeSaduckDatasets(saved.saduckDatasets, defaults.saduckDatasets),
    };
    if (!saved.saduckDir) merged.saduckDir = defaultSaduckDir(merged.dataDir);
    return merged;
  } catch {
    return defaults;
  }
}

function sanitizeDatasets(list, fallback) {
  if (!Array.isArray(list)) return fallback;
  const clean = list.filter((id) => DATASET_IDS.includes(id));
  return clean.length ? clean : [];
}

function sanitizeSaduckDatasets(list, fallback) {
  if (!Array.isArray(list)) return fallback;
  const clean = list.filter((id) => SADUCK_DATASET_IDS.includes(id));
  return clean.length ? clean : [];
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}

let config = loadConfig();

// ---------------------------------------------------------------- state

const syncState = {
  running: false,
  lastSummary: null,
  lastError: null,
  lastSyncAt: null,
};

const saduckState = {
  running: false,
  lastSummary: null,
  lastError: null,
  lastSyncAt: null,
};

let win = null;
let apiServer = null;
let saduckWeb = null;

// ---------------------------------------------------------------- naoku

function resolveNaokuDir() {
  return config.naokuDir?.trim() ? path.resolve(config.naokuDir) : defaultNaokuDir();
}

function naokuIndexDir() {
  return path.join(config.dataDir, "脑库索引");
}

function naokuLog(message) {
  console.log(`[naoku] ${message}`);
  broadcast("sync:progress", { type: "log", message: `脑库：${message}`, at: Date.now() });
}

// 索引 1 万多条，按文件 mtime 缓存，避免每个请求都重读 20MB JSON。
let naokuCache = null;

function loadNaokuIndex() {
  const dir = naokuIndexDir();
  const parts = { 真题: "真题.json", 考点: "考点.json", 材料: "材料.json" };
  const paths = Object.values(parts).map((f) => path.join(dir, f));
  if (!paths.every((p) => fs.existsSync(p))) return null;
  const stamp = Math.max(...paths.map((p) => fs.statSync(p).mtimeMs));
  if (naokuCache?.stamp === stamp) return naokuCache.index;
  const index = {};
  for (const [key, file] of Object.entries(parts)) {
    index[key] = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  }
  naokuCache = { stamp, index };
  return index;
}

function readNaokuManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(naokuIndexDir(), "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

const NAOKU_ENDPOINTS = [
  "status",
  "import",
  "index",
  "tree",
  "wrong-hits",
  "search?type=&q=&模块=&大类=&地区=&年份=&考点=&limit=",
  "note?path=",
  "for-question?qid=",
  "points?模块=&大类=&sort=&limit=",
];

// 与 src/naoku.mjs 的 SEARCH_DEFAULT_LIMIT / SEARCH_MAX_LIMIT 对齐：调用方要按题数排序时，
// 必须先按取值上限拿回候选集，排序后再截断到用户要的条数。
const NAOKU_LIMIT_DEFAULT = 50;
const NAOKU_LIMIT_MAX = 200;

async function handleNaoku({ pathname, query }) {
  const vaultDir = resolveNaokuDir();
  const bad = (message) => ({ httpStatus: 400, body: { ok: false, error: message } });
  const missingIndex = () => ({
    httpStatus: 404,
    body: { ok: false, error: "尚无脑库索引，先运行 POST /api/naoku/index（或应用内同步 naoku-index）" },
  });
  const withIndex = (fn) => {
    const index = loadNaokuIndex();
    if (!index) return missingIndex();
    try {
      return { ok: true, ...fn(index) };
    } catch (error) {
      return bad(String(error?.message ?? error));
    }
  };

  switch (pathname) {
    case "status": {
      const manifest = readNaokuManifest();
      return {
        ok: true,
        vaultDir,
        repo: config.naokuRepo,
        imported: fs.existsSync(vaultDir),
        indexed: Boolean(manifest),
        indexDir: naokuIndexDir(),
        counts: manifest?.counts ?? null,
        vaultCommit: manifest?.vault?.commit ?? null,
        generatedAtText: manifest?.generatedAtText ?? null,
        warnings: manifest?.warnings ?? [],
      };
    }
    case "import":
      return { ok: true, ...(await importVault({ dir: vaultDir, repo: config.naokuRepo, log: naokuLog })) };
    case "index": {
      if (!fs.existsSync(vaultDir)) {
        return { httpStatus: 409, body: { ok: false, error: `脑库未导入（${vaultDir}），先运行 POST /api/naoku/import` } };
      }
      const index = await buildIndex({ vaultDir, log: naokuLog });
      const manifest = writeIndex({ outDir: naokuIndexDir(), index });
      naokuCache = null;
      return {
        ok: true,
        counts: index.counts,
        模块列表: index.模块列表,
        warnings: index.warnings,
        vault: index.vault,
        generatedAtText: manifest.generatedAtText,
      };
    }
    case "search":
      return withIndex((index) =>
        searchIndex(index, {
          type: query.get("type") ?? "真题",
          q: query.get("q") ?? undefined,
          模块: query.get("模块") ?? undefined,
          大类: query.get("大类") ?? undefined,
          地区: query.get("地区") ?? undefined,
          年份: query.get("年份") ?? undefined,
          考点: query.get("考点") ?? undefined,
          limit: query.get("limit") ?? undefined,
        })
      );
    case "tree":
      return withIndex((index) => {
        const 模块 = new Map();
        const cell = (模块名, 大类名) => {
          if (!模块.has(模块名)) 模块.set(模块名, new Map());
          const 大类 = 模块.get(模块名);
          if (!大类.has(大类名)) 大类.set(大类名, { 大类: 大类名, 考点数: 0, 真题数: 0 });
          return 大类.get(大类名);
        };
        for (const row of index.考点 ?? []) cell(row.模块, row.大类).考点数++;
        for (const row of index.真题 ?? []) cell(row.模块, row.大类).真题数++;
        return {
          模块: [...模块.entries()]
            .map(([名称, 大类]) => ({
              模块: 名称,
              大类: [...大类.values()].sort((a, b) => a.大类.localeCompare(b.大类, "zh")),
            }))
            .sort((a, b) => a.模块.localeCompare(b.模块, "zh")),
          counts: {
            真题: (index.真题 ?? []).length,
            考点: (index.考点 ?? []).length,
            材料: (index.材料 ?? []).length,
          },
        };
      });
    case "wrong-hits": {
      const wrongFile = path.join(config.dataDir, "错题本", "wrong.json");
      const empty = (说明) => ({ ok: true, total: 0, hitCount: 0, hits: [], missCount: 0, 覆盖模块: [], 说明 });
      let wrongIds;
      try {
        const saved = JSON.parse(fs.readFileSync(wrongFile, "utf8"));
        wrongIds = Array.isArray(saved?.wrongIds) ? saved.wrongIds : [];
      } catch {
        return empty(`没有读到 ${wrongFile}，先在「数据同步」里勾选「错题本」同步一次`);
      }
      return withIndex((index) => {
        const byQid = new Map((index.真题 ?? []).map((row) => [String(row.qid), row]));
        const ids = [...new Set(wrongIds.map((id) => String(id).trim()).filter(Boolean))];
        const hits = ids
          .map((qid) => byQid.get(qid))
          .filter(Boolean)
          .map((row) => ({ qid: row.qid, 模块: row.模块, 大类: row.大类, 考点: row.考点, path: row.path }));
        hits.sort((a, b) => Number(a.qid) - Number(b.qid));
        return {
          total: ids.length,
          hitCount: hits.length,
          hits,
          missCount: ids.length - hits.length,
          覆盖模块: [...new Set((index.真题 ?? []).map((row) => row.模块))].sort(),
        };
      });
    }
    case "points": {
      const sort = query.get("sort") ?? "";
      const limit = query.get("limit") ?? undefined;
      return withIndex((index) => {
        const result = searchIndex(index, {
          type: "考点",
          模块: query.get("模块") ?? undefined,
          大类: query.get("大类") ?? undefined,
          limit: sort === "题数" ? NAOKU_LIMIT_MAX : limit,
        });
        if (sort !== "题数") return result;
        const take = Math.min(Math.max(Number(limit) || NAOKU_LIMIT_DEFAULT, 1), NAOKU_LIMIT_MAX);
        const items = [...result.items]
          .sort((a, b) => (Number(b.题数) || 0) - (Number(a.题数) || 0))
          .slice(0, take);
        return { ...result, limit: take, items };
      });
    }
    case "note": {
      if (!fs.existsSync(vaultDir)) {
        return { httpStatus: 409, body: { ok: false, error: `脑库未导入（${vaultDir}），先运行 POST /api/naoku/import` } };
      }
      try {
        return { ok: true, ...readNote({ vaultDir, relPath: query.get("path") }) };
      } catch (error) {
        return bad(String(error?.message ?? error));
      }
    }
    case "for-question":
      return withIndex((index) => forQuestion(index, query.get("qid")));
    default:
      return {
        httpStatus: 404,
        body: { ok: false, error: "未知脑库接口", endpoints: NAOKU_ENDPOINTS },
      };
  }
}

function broadcast(channel, payload) {
  try {
    win?.webContents?.send(channel, payload);
  } catch {
    /* window closed */
  }
}

function fenbiSession() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(CHROME_UA);
  return ses;
}

// ---------------------------------------------------------------- saduck

function waitForSaduckWeb(timeoutMs = 15000) {
  if (saduckWeb && !saduckWeb.isDestroyed()) return Promise.resolve(saduckWeb);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (saduckWeb && !saduckWeb.isDestroyed()) {
        clearInterval(timer);
        resolve(saduckWeb);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 300);
  });
}

// 未登录时从 saduckBootstrapPath 导入一次 token（格式同 saduck-cli 的 session.json）。
async function bootstrapSaduckToken(log = () => {}) {
  const web = saduckWeb;
  if (!web || web.isDestroyed()) return false;
  if (await readSaduckToken(web)) return true;
  const source = config.saduckBootstrapPath;
  if (!source || !fs.existsSync(source)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(source, "utf8"));
    const token = typeof saved === "string" ? saved : saved?.token;
    if (typeof token !== "string" || token.length < 20) return false;
    await web.executeJavaScript(`localStorage.setItem("token", ${JSON.stringify(token)})`, true);
    web.reload();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await readSaduckToken(web)) {
        log("已从本地会话文件导入 SaDuck 登录态（仅本机）");
        return true;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  } catch (error) {
    log(`SaDuck 会话导入失败：${error?.message ?? error}`);
    return false;
  }
}

async function saduckStatus() {
  await bootstrapSaduckToken().catch(() => {});
  const result = {
    ok: true,
    loggedIn: false,
    account: null,
    webReady: Boolean(saduckWeb && !saduckWeb.isDestroyed()),
    dir: path.resolve(config.saduckDir),
    bootstrapSessionPath: config.saduckBootstrapPath,
    running: saduckState.running,
    lastSyncAt: saduckState.lastSyncAt,
    lastError: saduckState.lastError,
    datasets: SADUCK_DATASETS.map((d) => ({ id: d.id, name: d.name, default: d.default })),
  };
  const web = saduckWeb;
  if (!web || web.isDestroyed()) return result;
  result.webReady = true;
  const token = await readSaduckToken(web).catch(() => null);
  if (!token) return result;
  result.loggedIn = true;
  const check = await callSaduckApi(web, "/user/verify").catch(() => null);
  if (check && (check.code === 100 || check.code === 101)) {
    result.loggedIn = false;
    return result;
  }
  if (check?.result) {
    result.account = {
      emailMasked: maskEmail(check.result.email),
      vipType: check.result.vipType ?? null,
      vipEndTime: check.result.vipEndTime ?? null,
    };
  }
  return result;
}

async function readCookieHeader(ses) {
  const cookies = await ses.cookies.get({ url: "https://tiku.fenbi.com/" });
  if (!cookies.length) return "";
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function hasAuthCookie(ses) {
  const cookies = await ses.cookies.get({ url: "https://tiku.fenbi.com/" });
  return cookies.some((c) => c.name === "sess" && c.value);
}

async function bootstrapCookies(ses, log = () => {}) {
  if (await hasAuthCookie(ses)) return true;
  const source = config.bootstrapSessionPath;
  if (!source || !fs.existsSync(source)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(source, "utf8"));
    const cookies = saved?.cookies ?? {};
    const expiry = Math.floor(Date.now() / 1000) + 180 * 86400;
    let imported = 0;
    for (const [name, value] of Object.entries(cookies)) {
      if (!value) continue;
      await ses.cookies.set({
        url: "https://www.fenbi.com/",
        name,
        value,
        domain: ".fenbi.com",
        path: "/",
        secure: true,
        httpOnly: true,
        expirationDate: expiry,
      });
      imported++;
    }
    log(`已从本地会话文件导入 ${imported} 个 Cookie（仅本机）`);
    return imported > 0 && (await hasAuthCookie(ses));
  } catch (error) {
    log(`会话导入失败：${error.message}`);
    return false;
  }
}

async function sessionClient(prefix = "xingce") {
  const ses = fenbiSession();
  await bootstrapCookies(ses);
  const cookie = await readCookieHeader(ses);
  if (!/sess=/.test(cookie)) throw new Error("未登录：请先在应用内登录粉笔账号");
  return makeClient(cookie, { prefix: prefix === "shenlun" ? "shenlun" : "xingce" });
}

// ---------------------------------------------------------------- sync

async function doSync({ datasets, full = false, source = "app" } = {}) {
  if (syncState.running) {
    return { ok: false, error: "busy", message: "已有同步在进行中" };
  }
  syncState.running = true;
  syncState.lastError = null;
  const log = (message) => {
    console.log(`[sync:${source}] ${message}`);
    broadcast("sync:progress", { type: "log", message, at: Date.now() });
  };
  broadcast("sync:progress", { type: "start", at: Date.now() });
  try {
    const selected = Array.isArray(datasets) && datasets.length ? datasets : config.datasets;
    const needsFenbi = selected.some((id) => datasetById(id)?.source !== "naoku");
    const ses = fenbiSession();
    await bootstrapCookies(ses, log);
    const cookieHeader = await readCookieHeader(ses);
    if (needsFenbi && !/sess=/.test(cookieHeader)) {
      throw new Error("未登录：请先在「刷题」页登录粉笔账号");
    }
    log(`开始同步：${selected.join(", ")}${full ? "（全量）" : ""}`);
    const summary = await runSync({
      cookieHeader,
      dataDir: config.dataDir,
      datasets: selected,
      full,
      log,
      naokuDir: resolveNaokuDir(),
    });
    syncState.lastSummary = summary;
    syncState.lastSyncAt = Date.now();
    broadcast("sync:progress", { type: "done", summary, at: Date.now() });
    return summary;
  } catch (error) {
    syncState.lastError = String(error?.message ?? error);
    log(`同步失败：${syncState.lastError}`);
    broadcast("sync:progress", { type: "error", message: syncState.lastError, at: Date.now() });
    return { ok: false, error: syncState.lastError };
  } finally {
    syncState.running = false;
  }
}

// ---------------------------------------------------------------- saduck sync

async function doSaduckSync({ datasets, source = "app" } = {}) {
  if (saduckState.running) {
    return { ok: false, error: "busy", message: "已有 SaDuck 同步在进行中" };
  }
  saduckState.running = true;
  saduckState.lastError = null;
  const log = (message) => {
    console.log(`[saduck:${source}] ${message}`);
    broadcast("sync:progress", { type: "log", message: `SaDuck：${message}`, at: Date.now() });
  };
  broadcast("sync:progress", { type: "start", at: Date.now() });
  try {
    const web = await waitForSaduckWeb(15000);
    if (!web) throw new Error("SaDuck 页面未就绪：先打开「SaDuck」页");
    await bootstrapSaduckToken(log);
    const selected = Array.isArray(datasets) && datasets.length ? datasets : config.saduckDatasets;
    const summary = await runSaduckSync({ web, outDir: path.resolve(config.saduckDir), datasets: selected, log });
    saduckState.lastSummary = summary;
    saduckState.lastSyncAt = Date.now();
    if (!summary.ok) {
      saduckState.lastError = summary.error || "SaDuck 同步部分失败";
      log(`同步部分失败：${saduckState.lastError}`);
      broadcast("sync:progress", {
        type: "error",
        message: saduckState.lastError,
        summary,
        at: Date.now(),
      });
    } else {
      broadcast("sync:progress", { type: "done", summary, at: Date.now() });
    }
    return summary;
  } catch (error) {
    saduckState.lastError = String(error?.message ?? error);
    log(`同步失败：${saduckState.lastError}`);
    broadcast("sync:progress", { type: "error", message: saduckState.lastError, at: Date.now() });
    return { ok: false, error: saduckState.lastError };
  } finally {
    saduckState.running = false;
  }
}

const SADUCK_ENDPOINTS = ["status", "datasets", "data?dataset=", "sync?datasets=", "manifest"];

async function handleSaduck({ pathname, query, body }) {
  const bad = (httpStatus, error) => ({ httpStatus, body: { ok: false, error } });
  switch (pathname) {
    case "status":
      return { ok: true, ...(await saduckStatus()) };
    case "datasets":
      return {
        ok: true,
        datasets: SADUCK_DATASETS.map((d) => ({
          id: d.id,
          name: d.name,
          default: d.default,
          sensitivity: d.sensitivity,
          description: d.description,
          agentUse: d.agentUse,
        })),
      };
    case "data": {
      const id = query.get("dataset") ?? "";
      const ds = saduckDatasetById(id);
      if (!ds) {
        return bad(400, `未知数据集：${id || "(空)"}（可用：${SADUCK_DATASET_IDS.join(", ")}）`);
      }
      const web = await waitForSaduckWeb(5000);
      if (!web) return bad(409, "SaDuck 页面未就绪：先打开应用窗口");
      await bootstrapSaduckToken();
      const j = await callSaduckApi(web, ds.path, ds.body);
      if (j.code === 100 || j.code === 101) return bad(409, "SaDuck 未登录：先在应用「SaDuck」页登录");
      if (j.code === 102) return bad(409, `${j.message || "会员功能受限"}（code 102）`);
      if (j.code !== 0) return bad(502, `${j.code} ${j.message ?? ""}`);
      return { ok: true, dataset: ds.id, name: ds.name, data: j.result };
    }
    case "sync": {
      const raw = query.get("datasets") ?? (Array.isArray(body?.datasets) ? body.datasets.join(",") : "");
      const datasets = raw
        ? String(raw)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const result = await doSaduckSync({ datasets, source: "api" });
      return { httpStatus: result.ok ? 200 : 409, body: result };
    }
    case "manifest": {
      const manifest = readSaduckManifest(path.resolve(config.saduckDir));
      return manifest
        ? { ok: true, manifest }
        : bad(404, "尚无 SaDuck manifest，先触发一次同步（POST /api/saduck/sync）");
    }
    default:
      return { httpStatus: 404, body: { ok: false, error: "未知 SaDuck 接口", endpoints: SADUCK_ENDPOINTS } };
  }
}

// ---------------------------------------------------------------- agent surface

async function agentState() {
  return {
    fenbi: { loggedIn: await hasAuthCookie(fenbiSession()).catch(() => false) },
    saduck: { loggedIn: Boolean(await readSaduckToken(saduckWeb).catch(() => null)) },
    sync: { running: syncState.running, lastSyncAt: syncState.lastSyncAt },
    saduckSync: { running: saduckState.running, lastSyncAt: saduckState.lastSyncAt },
    naoku: { indexed: Boolean(readNaokuManifest()) },
  };
}

// ---------------------------------------------------------------- window

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: "备考工作台",
    backgroundColor: "#f4f1ea",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  win.loadFile(path.join(ROOT, "ui", "index.html"));
  const saduckSession = session.fromPartition(SADUCK_PARTITION);
  win.webContents.on("did-attach-webview", (_event, contents) => {
    const adopt = () => {
      if (!contents.isDestroyed() && contents.getURL().startsWith(SADUCK_ORIGIN)) saduckWeb = contents;
    };
    if (contents.session === saduckSession) saduckWeb = contents;
    contents.on("did-navigate", adopt);
    contents.on("did-finish-load", adopt);
    contents.once("destroyed", () => {
      if (saduckWeb === contents) saduckWeb = null;
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

// ---------------------------------------------------------------- ipc

function publicConfig() {
  return {
    dataDir: config.dataDir,
    port: config.port,
    token: config.token ? "（已设置）" : "",
    tokenSet: Boolean(config.token),
    datasets: config.datasets,
    autoSyncOnLaunch: config.autoSyncOnLaunch,
    bootstrapSessionPath: config.bootstrapSessionPath,
    naokuDir: resolveNaokuDir(),
    naokuRepo: config.naokuRepo,
    saduckDir: config.saduckDir,
    saduckDatasets: config.saduckDatasets,
    saduckBootstrapPath: config.saduckBootstrapPath,
    apiBase: `http://127.0.0.1:${config.port}`,
    version: APP_VERSION,
  };
}

function registerIpc() {
  ipcMain.handle("config:get", () => publicConfig());
  ipcMain.handle("config:set", (_e, patch = {}) => {
    if (typeof patch.dataDir === "string" && patch.dataDir.trim()) config.dataDir = patch.dataDir.trim();
    if (Number.isInteger(patch.port) && patch.port >= 1024 && patch.port <= 65535) config.port = patch.port;
    if (typeof patch.token === "string") config.token = patch.token.trim();
    if (typeof patch.autoSyncOnLaunch === "boolean") config.autoSyncOnLaunch = patch.autoSyncOnLaunch;
    if (typeof patch.naokuDir === "string" && patch.naokuDir.trim()) config.naokuDir = patch.naokuDir.trim();
    if (typeof patch.naokuRepo === "string" && patch.naokuRepo.trim()) config.naokuRepo = patch.naokuRepo.trim();
    if (Array.isArray(patch.datasets)) config.datasets = sanitizeDatasets(patch.datasets, config.datasets);
    if (typeof patch.saduckDir === "string" && patch.saduckDir.trim()) config.saduckDir = patch.saduckDir.trim();
    if (typeof patch.saduckBootstrapPath === "string") config.saduckBootstrapPath = patch.saduckBootstrapPath.trim();
    if (Array.isArray(patch.saduckDatasets)) {
      config.saduckDatasets = sanitizeSaduckDatasets(patch.saduckDatasets, config.saduckDatasets);
    }
    saveConfig(config);
    broadcast("config:changed", publicConfig());
    return publicConfig();
  });
  ipcMain.handle("datasets:list", () =>
    DATASETS.map((d) => ({ ...d, enabled: config.datasets.includes(d.id) }))
  );
  ipcMain.handle("sync:run", (_e, opts) => doSync(opts ?? {}));
  ipcMain.handle("status:get", async () => ({
    running: syncState.running,
    lastSummary: syncState.lastSummary,
    lastError: syncState.lastError,
    lastSyncAt: syncState.lastSyncAt,
    hasSession: await hasAuthCookie(fenbiSession()).catch(() => false),
    hasSaduckSession: Boolean(await readSaduckToken(saduckWeb).catch(() => null)),
    ...publicConfig(),
  }));
  ipcMain.handle("choose:dir", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择数据输出目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("open:path", async (_e, target) => shell.openPath(String(target)));
  ipcMain.handle("open:external", async (_e, url) => {
    if (/^https?:/i.test(String(url))) await shell.openExternal(String(url));
  });
  ipcMain.handle("tiku:home", () => TIKU_HOME);
  ipcMain.handle("saduck:status", () => saduckStatus());
  ipcMain.handle("saduck:sync", (_e, opts) => doSaduckSync(opts ?? {}));
  // 界面与 HTTP 层共用 handleNaoku，避免把脑库业务逻辑复制到 UI 侧。
  ipcMain.handle("naoku:query", (_e, { pathname, params } = {}) =>
    handleNaoku({ pathname, query: new URLSearchParams(params ?? {}) })
  );
}

// ---------------------------------------------------------------- api server

async function startApi() {
  try {
    apiServer = await createApiServer({
      port: config.port,
      token: config.token,
      onLog: (line) => console.log(`[api] ${line}`),
      handlers: {
        status: async () => ({
          ok: true,
          app: "exam-workbench",
          version: APP_VERSION,
          running: syncState.running,
          lastSyncAt: syncState.lastSyncAt,
          lastError: syncState.lastError,
          lastSummary: syncState.lastSummary,
          dataDir: config.dataDir,
          datasets: config.datasets,
          hasSession: await hasAuthCookie(fenbiSession()).catch(() => false),
          hasSaduckSession: Boolean(await readSaduckToken(saduckWeb).catch(() => null)),
          saduckDir: config.saduckDir,
          saduckDatasets: config.saduckDatasets,
        }),
        agent: async () =>
          buildAgentManifest({
            baseUrl: `http://127.0.0.1:${config.port}`,
            version: APP_VERSION,
            state: await agentState(),
          }),
        agentSkill: (id) => readAgentSkill(id),
        datasets: async () => ({
          ok: true,
          datasets: DATASETS.map((d) => ({ ...d, enabled: config.datasets.includes(d.id) })),
        }),
        manifest: async () => readManifest(config.dataDir),
        sync: async ({ datasets, full }) => doSync({ datasets, full, source: "api" }),
        saduck: handleSaduck,
        naoku: handleNaoku,
        tiku: async ({ pathname, query }) => {
          const prefix = query.get("prefix") === "shenlun" ? "shenlun" : "xingce";
          const client = await sessionClient(prefix);
          const intList = (raw, cap) =>
            String(raw ?? "")
              .split(",")
              .map((x) => Number(x.trim()))
              .filter((n) => Number.isInteger(n) && n > 0)
              .slice(0, cap);
          const bad = (message) => ({ httpStatus: 400, body: { ok: false, error: message } });
          switch (pathname) {
            case "labels":
              return { ok: true, prefix, data: await client.getBankLabels(prefix) };
            case "papers": {
              const labelId = Number(query.get("labelId") ?? 1) || 1;
              const page = Math.max(0, Number(query.get("page") ?? 0) || 0);
              const pageSize = Math.min(20, Math.max(1, Number(query.get("pageSize") ?? 15) || 15));
              return { ok: true, prefix, data: await client.getBankPapers(prefix, { labelId, page, pageSize }) };
            }
            case "paper": {
              const paperId = Number(query.get("paperId"));
              if (!paperId) return bad("paperId 必填");
              return { ok: true, prefix, data: await client.getBankPaper(prefix, paperId) };
            }
            case "paper-sheet": {
              const paperId = Number(query.get("paperId"));
              if (!paperId) return bad("paperId 必填");
              return { ok: true, prefix, data: await client.getBankPaperSheet(prefix, paperId) };
            }
            case "questions": {
              const ids = intList(query.get("ids"), 20);
              if (!ids.length) return bad("ids 必填（最多 20 个，逗号分隔）");
              return { ok: true, prefix, data: await client.getQuestions(ids) };
            }
            case "question-meta": {
              const ids = intList(query.get("ids"), 50);
              if (!ids.length) return bad("ids 必填（最多 50 个，逗号分隔）");
              return { ok: true, prefix, data: await client.getQuestionMeta(ids) };
            }
            case "shenlun-solutions": {
              const ids = intList(query.get("ids"), 10);
              if (!ids.length) return bad("ids 必填（最多 10 个）");
              return { ok: true, text: await client.getShenlunSolutionRaw(ids) };
            }
            default:
              return {
                httpStatus: 404,
                body: {
                  ok: false,
                  error: "未知题库接口",
                  endpoints: [
                    "labels?prefix=",
                    "papers?prefix=&labelId=&page=&pageSize=",
                    "paper?prefix=&paperId=",
                    "paper-sheet?prefix=&paperId=",
                    "questions?prefix=&ids=",
                    "question-meta?prefix=&ids=",
                    "shenlun-solutions?ids=",
                  ],
                },
              };
          }
        },
      },
    });
    console.log(`[api] listening on http://127.0.0.1:${config.port}`);
  } catch (error) {
    console.error(`[api] 启动失败（端口 ${config.port}）：${error.message}`);
    apiServer = null;
  }
}

// ---------------------------------------------------------------- self test

async function runSelfTest() {
  fs.mkdirSync(SELFTEST_DIR, { recursive: true });
  const resultPath = path.join(SELFTEST_DIR, "selftest-result.json");
  const result = { ok: false, startedAt: new Date().toISOString(), screenshot: null, summary: null, status: null };
  try {
    const ses = fenbiSession();
    const imported = await bootstrapCookies(ses, (m) => console.log(`[selftest] ${m}`));
    result.bootstrap = imported;
    await new Promise((resolve) => setTimeout(resolve, 6000));
    result.summary = await doSync({ source: "selftest" });
    result.saduck = { attempted: false, ok: false };
    try {
      const web = await waitForSaduckWeb(20000);
      if (!web) {
        result.saduck = { attempted: false, skipped: "no-webview" };
      } else {
        await bootstrapSaduckToken((m) => console.log(`[selftest] ${m}`));
        if (await readSaduckToken(web)) {
          result.saduck = { attempted: true, ...(await doSaduckSync({ source: "selftest" })) };
        } else {
          result.saduck = { attempted: false, skipped: "no-saduck-session" };
        }
      }
    } catch (error) {
      result.saduck = { attempted: true, ok: false, error: String(error?.message ?? error) };
    }
    if (win && !win.isDestroyed()) {
      try {
        const image = await win.webContents.capturePage();
        const shot = path.join(SELFTEST_DIR, "window.png");
        fs.writeFileSync(shot, image.toPNG());
        result.screenshot = shot;
      } catch (error) {
        result.screenshotError = String(error.message);
      }
      try {
        await win.webContents.executeJavaScript('document.querySelector(".nav-item[data-view=saduck]").click()');
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const image = await win.webContents.capturePage();
        const shot = path.join(SELFTEST_DIR, "window-saduck.png");
        fs.writeFileSync(shot, image.toPNG());
        result.screenshotSaduck = shot;
      } catch (error) {
        result.screenshotSaduckError = String(error.message);
      }
    }
    result.status = {
      running: syncState.running,
      lastSyncAt: syncState.lastSyncAt,
      lastError: syncState.lastError,
      apiUp: Boolean(apiServer),
    };
    result.ok = Boolean(result.summary?.ok) && (!result.saduck.attempted || result.saduck.ok);
  } catch (error) {
    result.error = String(error?.message ?? error);
  } finally {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    console.log(`[selftest] ${result.ok ? "PASS" : "FAIL"} -> ${resultPath}`);
    app.exit(result.ok ? 0 : 1);
  }
}

// ---------------------------------------------------------------- lifecycle

app.setName("备考工作台");
app.userAgentFallback = CHROME_UA;

app.whenReady().then(async () => {
  registerIpc();
  if (isNaokuImport) {
    // 无窗口导入：稀疏克隆/更新脑库副本，并顺带重建索引，供外部脚本调用。
    try {
      const result = await importVault({ dir: resolveNaokuDir(), repo: config.naokuRepo, log: naokuLog });
      const index = await buildIndex({ vaultDir: result.dir, log: naokuLog });
      const manifest = writeIndex({ outDir: naokuIndexDir(), index });
      console.log(JSON.stringify({ ...result, counts: index.counts, warnings: index.warnings, generatedAtText: manifest.generatedAtText }, null, 2));
      app.exit(0);
    } catch (error) {
      console.error(`[naoku] 导入失败：${error?.message ?? error}`);
      app.exit(1);
    }
    return;
  }
  if (isSyncOnly) {
    // 无窗口同步模式：供夜间自动化使用（读取本机已登录会话 → 同步到数据目录 → 退出）。
    try {
      const summary = await doSync({ source: "sync-only" });
      fs.writeFileSync(
        path.join(app.getPath("userData"), "last-sync-only.json"),
        JSON.stringify(summary, null, 2),
        "utf8"
      );
      console.log(JSON.stringify(summary, null, 2));
      app.exit(summary.ok ? 0 : 1);
    } catch (error) {
      console.error(String(error?.message ?? error));
      app.exit(1);
    }
    return;
  }
  createWindow();
  await startApi();
  if (isSelfTest) {
    await runSelfTest();
    return;
  }
  if (config.autoSyncOnLaunch) {
    setTimeout(() => {
      doSync({ source: "launch" }).catch(() => {});
    }, 3000);
  }
});

app.on("window-all-closed", () => {
  apiServer?.close?.();
  app.quit();
});
