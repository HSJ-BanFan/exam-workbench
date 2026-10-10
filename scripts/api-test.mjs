// 自动化验收：启动应用 → 调用本机 HTTP 接口 → 校验 → 关闭应用。
// 用法: node scripts/api-test.mjs

import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// 用法: node scripts/api-test.mjs [打包后的 exe 路径]
const packagedExe = process.argv[2];
const results = {};
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
    results.naoku.ok === true;
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
