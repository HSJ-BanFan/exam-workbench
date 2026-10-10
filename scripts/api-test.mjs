// 自动化验收：启动应用 → 调用本机 HTTP 接口 → 校验 → 关闭应用。
// 用法: node scripts/api-test.mjs

import { spawn, execSync } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 端口被别的实例占用时，下面的请求会打到那个实例上，测出来的结果与本次代码无关。
async function assertPortFree() {
  try {
    const res = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      throw new Error(
        `端口 ${PORT} 已有实例在响应 /api/status（例如打包版还在运行，或上一次运行的进程没退出）。` +
          "本测试需要独占该端口，请先关闭它再重跑。"
      );
    }
  } catch (error) {
    if (/已有实例/.test(String(error?.message))) throw error;
    /* 连接被拒绝，说明端口空闲 */
  }
}

async function waitForApi(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error("API 未在超时内就绪");
}

// MCP（stdio）冒烟：启动 mcp/server.mjs，握手后列工具/技能并调用一个只读工具。
async function mcpSmoke() {
  const child = spawn(process.execPath, [path.join(ROOT, "mcp", "server.mjs")], {
    env: { ...process.env, WORKBENCH_PORT: String(PORT) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} 超时`));
      }, 20000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  try {
    const init = await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "api-test", version: "1.0.0" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = await rpc("tools/list", {});
    const prompts = await rpc("prompts/list", {});
    const call = await rpc("tools/call", { name: "app_status", arguments: {} });
    let statusOk = false;
    try {
      statusOk = JSON.parse(call?.content?.[0]?.text ?? "{}").ok === true;
    } catch {
      statusOk = false;
    }
    return {
      server: init?.serverInfo?.name ?? null,
      tools: tools?.tools?.length ?? -1,
      prompts: prompts?.prompts?.length ?? -1,
      statusOk,
    };
  } finally {
    child.kill();
  }
}

// 用法: node scripts/api-test.mjs [打包后的 exe 路径]
const packagedExe = process.argv[2];
const results = {};
try {
  await assertPortFree();
} catch (error) {
  console.error(`API 测试无法开始: ${error.message}`);
  process.exit(1);
}
const child = packagedExe
  ? spawn(packagedExe, ["--api-test"], { stdio: "inherit" })
  : spawn(electronPath, [".", "--api-test"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" },
    });

try {
  const status = await waitForApi();
  results.status = {
    ok: status.ok,
    running: status.running,
    hasSession: status.hasSession,
    dataDir: status.dataDir,
  };

  const datasets = await (await fetch(`${BASE}/api/datasets`)).json();
  results.datasets = {
    ok: datasets.ok,
    count: datasets.datasets.length,
    enabled: datasets.datasets.filter((d) => d.enabled).map((d) => d.id),
  };

  const syncRes = await fetch(`${BASE}/api/sync?datasets=history,ability`, { method: "POST" });
  const sync = await syncRes.json();
  results.sync = {
    httpStatus: syncRes.status,
    ok: sync.ok,
    datasets: Object.fromEntries(Object.entries(sync.datasets ?? {}).map(([k, v]) => [k, v.items])),
    warnings: sync.warnings,
  };

  const manifest = await (await fetch(`${BASE}/api/manifest`)).json();
  results.manifest = {
    app: manifest.app,
    generatedAtText: manifest.generatedAtText,
    lastRunSelection: manifest.lastRun?.selection,
    contents: Object.keys(manifest.contents ?? {}),
  };

  // ---- 题库接口（只读） ----
  const labels = await (await fetch(`${BASE}/api/tiku/labels?prefix=xingce`)).json();
  results.bankLabels = { ok: labels.ok, count: Array.isArray(labels.data) ? labels.data.length : -1 };

  const papers = await (await fetch(`${BASE}/api/tiku/papers?prefix=xingce&labelId=1&pageSize=3`)).json();
  const firstPaper = papers.data?.list?.[0];
  results.bankPapers = { ok: papers.ok, count: papers.data?.list?.length ?? -1, firstId: firstPaper?.id ?? null };

  let sheet = null;
  if (firstPaper?.id) {
    sheet = await (await fetch(`${BASE}/api/tiku/paper-sheet?prefix=xingce&paperId=${firstPaper.id}`)).json();
  }
  results.bankSheet = { ok: sheet?.ok, questionIds: sheet?.data?.questionIds?.length ?? 0 };

  const qids = (sheet?.data?.questionIds ?? []).slice(0, 2);
  if (qids.length) {
    const q = await (await fetch(`${BASE}/api/tiku/questions?prefix=xingce&ids=${qids.join(",")}`)).json();
    results.bankQuestions = {
      ok: q.ok,
      count: Array.isArray(q.data) ? q.data.length : -1,
      hasContent: Boolean(q.data?.[0]?.content),
    };
  }

  const slLabels = await (await fetch(`${BASE}/api/tiku/labels?prefix=shenlun`)).json();
  results.bankShenlunLabels = { ok: slLabels.ok, count: Array.isArray(slLabels.data) ? slLabels.data.length : -1 };

  const slSheet = await (await fetch(`${BASE}/api/tiku/paper-sheet?prefix=shenlun&paperId=4473791`)).json();
  results.bankShenlunSheet = { ok: slSheet.ok, questionIds: slSheet.data?.questionIds?.length ?? 0 };

  // ---- 脑库索引（本地，不需要登录态） ----
  const naokuStatus = await (await fetch(`${BASE}/api/naoku/status`)).json();
  results.naoku = {
    ok: naokuStatus.ok,
    imported: naokuStatus.imported,
    indexed: naokuStatus.indexed,
  };

  // ---- SaDuck 接口（只读；应用内已登录时做一次数据读取与同步） ----
  let sdStatus = await (await fetch(`${BASE}/api/saduck/status`)).json();
  for (let i = 0; i < 5 && !sdStatus.loggedIn && !sdStatus.webReady; i++) {
    await sleep(1500);
    sdStatus = await (await fetch(`${BASE}/api/saduck/status`)).json();
  }
  results.saduckStatus = {
    ok: sdStatus.ok,
    loggedIn: sdStatus.loggedIn,
    webReady: sdStatus.webReady,
    dir: sdStatus.dir,
  };
  const sdDatasets = await (await fetch(`${BASE}/api/saduck/datasets`)).json();
  results.saduckDatasets = { ok: sdDatasets.ok, count: sdDatasets.datasets?.length ?? -1 };
  if (sdStatus.loggedIn) {
    const sdData = await (await fetch(`${BASE}/api/saduck/data?dataset=time`)).json();
    results.saduckData = { ok: sdData.ok, dataset: sdData.dataset, isArray: Array.isArray(sdData.data) };
    const sdSyncRes = await fetch(`${BASE}/api/saduck/sync?datasets=time,plan`, { method: "POST" });
    const sdSync = await sdSyncRes.json();
    results.saduckSync = {
      httpStatus: sdSyncRes.status,
      ok: sdSync.ok,
      datasets: Object.fromEntries(Object.entries(sdSync.datasets ?? {}).map(([k, v]) => [k, v.items])),
    };
  }

  // ---- Agent 发现接口 + MCP 冒烟 ----
  const agent = await (await fetch(`${BASE}/api/agent`)).json();
  results.agent = {
    schema: agent.schema,
    capabilities: agent.capabilities?.length ?? -1,
    skills: agent.skills?.length ?? -1,
  };
  const skillUrl = agent.skills?.[0]?.url
    ? `${BASE}${agent.skills[0].url}`
    : `${BASE}/api/agent/skills/__none__`;
  const skillRes = await fetch(skillUrl);
  results.agentSkill = {
    httpStatus: skillRes.status,
    contentType: skillRes.headers.get("content-type"),
    length: (await skillRes.text()).length,
  };
  results.agentProbes = {};
  const probeTargets = [
    ["app.status", "/api/status"],
    ["naoku.status", "/api/naoku/status"],
    ["saduck.status", "/api/saduck/status"],
    ["saduck.datasets", "/api/saduck/datasets"],
    ["fenbi.labels", "/api/tiku/labels?prefix=xingce"],
  ];
  for (const [id, probeUrl] of probeTargets) {
    const res = await fetch(`${BASE}${probeUrl}`).catch(() => null);
    results.agentProbes[id] = res ? res.status : "fetch-error";
  }
  results.mcp = await mcpSmoke();

  const ok =
    results.status.ok &&
    results.status.hasSession &&
    results.datasets.count === 10 &&
    results.sync.ok &&
    results.manifest.app === "exam-workbench" &&
    results.bankLabels.ok &&
    results.bankLabels.count > 0 &&
    results.bankPapers.ok &&
    results.bankPapers.count > 0 &&
    results.bankSheet.ok &&
    results.bankSheet.questionIds > 0 &&
    results.bankQuestions?.ok === true &&
    results.bankQuestions?.hasContent === true &&
    results.bankShenlunLabels.ok &&
    results.bankShenlunLabels.count > 0 &&
    results.bankShenlunSheet.ok &&
    results.bankShenlunSheet.questionIds > 0 &&
    results.naoku.ok === true &&
    results.saduckStatus.ok === true &&
    results.saduckDatasets.count === 8 &&
    (!results.saduckStatus.loggedIn || (results.saduckData?.ok === true && results.saduckSync?.ok === true)) &&
    results.agent.schema === 1 &&
    results.agent.capabilities >= 24 &&
    results.agent.skills === 5 &&
    results.agentSkill.httpStatus === 200 &&
    Object.values(results.agentProbes).every((v) => v === 200) &&
    results.mcp?.tools >= 20 &&
    results.mcp?.prompts === 5 &&
    results.mcp?.statusOk === true;
  console.log("\n=== API TEST RESULT ===");
  console.log(JSON.stringify({ ok, ...results }, null, 2));
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error("API 测试失败:", error);
  process.exitCode = 1;
} finally {
  try {
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
  } catch {
    child.kill();
  }
}
