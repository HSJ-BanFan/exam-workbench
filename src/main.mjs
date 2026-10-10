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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const APP_VERSION = "0.1.0";
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

const isSelfTest = process.argv.includes("--self-test");
const isSyncOnly = process.argv.includes("--sync-only");
const isNaokuImport = process.argv.includes("--naoku-import");
const SELFTEST_DIR = process.env.SELFTEST_DIR ?? path.join(ROOT, ".selftest");

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
  };
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return { ...defaults, ...saved, datasets: sanitizeDatasets(saved.datasets, defaults.datasets) };
  } catch {
    return defaults;
  }
}

function sanitizeDatasets(list, fallback) {
  if (!Array.isArray(list)) return fallback;
  const clean = list.filter((id) => DATASET_IDS.includes(id));
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

let win = null;
let apiServer = null;

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
  "search?type=&q=&模块=&大类=&地区=&年份=&考点=&limit=",
  "note?path=",
  "for-question?qid=",
  "points?模块=&大类=&limit=",
];

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
    case "points":
      return withIndex((index) =>
        searchIndex(index, {
          type: "考点",
          模块: query.get("模块") ?? undefined,
          大类: query.get("大类") ?? undefined,
          limit: query.get("limit") ?? undefined,
        })
      );
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
        }),
        datasets: async () => ({
          ok: true,
          datasets: DATASETS.map((d) => ({ ...d, enabled: config.datasets.includes(d.id) })),
        }),
        manifest: async () => readManifest(config.dataDir),
        sync: async ({ datasets, full }) => doSync({ datasets, full, source: "api" }),
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
    if (win && !win.isDestroyed()) {
      try {
        const image = await win.webContents.capturePage();
        const shot = path.join(SELFTEST_DIR, "window.png");
        fs.writeFileSync(shot, image.toPNG());
        result.screenshot = shot;
      } catch (error) {
        result.screenshotError = String(error.message);
      }
    }
    result.status = {
      running: syncState.running,
      lastSyncAt: syncState.lastSyncAt,
      lastError: syncState.lastError,
      apiUp: Boolean(apiServer),
    };
    result.ok = Boolean(result.summary?.ok);
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
