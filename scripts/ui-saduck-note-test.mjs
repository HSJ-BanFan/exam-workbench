// 回归：SaDuck 页顶部说明文字必须跟上真实登录状态。
// 触发条件：在 webview 还没落在 saduck.top 时做一次状态检查（冷启动/重载都会遇到），
// 检查会读到「未登录」；修复前这条错误说明会一直留着，和底部胶囊、页面本身互相打脸。
// 用法: node scripts/ui-saduck-note-test.mjs [打包后的 exe 路径]
// 需要本机已登录 SaDuck；未登录时只做静态断言并跳过恢复断言（exit 2 = 未复现）。

import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8791;
const CDP_PORT = Number(process.env.UI_TEST_CDP_PORT ?? 19222);
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const NOTE_OK = "已登录";
const NOTE_BAD = "未登录：";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function fetchJson(url, timeoutMs = 5000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function assertPortFree() {
  try {
    const res = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      throw new Error(
        `端口 ${PORT} 已有实例在响应（例如打包版还在运行）。本测试需要独占该端口，请先关闭它再重跑。`
      );
    }
  } catch (error) {
    if (/已有实例/.test(String(error?.message))) throw error;
  }
}

async function waitForNote(session, matcher, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await session.eval(`document.querySelector("#sd-note").textContent`);
    if (matcher(text)) return text;
    await sleep(400);
  }
  return null;
}

async function waitForExpression(session, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await session.eval(expression)) return true;
    } catch {
      /* 文档还在解析时拿不到元素，继续等 */
    }
    await sleep(250);
  }
  return false;
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        resolve(message);
      }
    });
  }

  static async connect(wsUrl, timeoutMs = 10000) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket 连接超时")), timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`CDP WebSocket 错误: ${event?.message ?? "unknown"}`));
      });
    });
    return new CdpSession(ws);
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(`CDP ${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`页面执行失败: ${result.exceptionDetails.exception?.description ?? expression}`);
    }
    return result.result?.value;
  }
}

async function mainWindowTarget(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`${CDP}/json/list`, 3000);
      const found = targets.find((t) => t.type === "page" && String(t.url).includes("/ui/index.html"));
      if (found) return found;
    } catch {
      /* CDP 还没起来 */
    }
    await sleep(250);
  }
  return null;
}

const packagedExe = process.argv[2];
await assertPortFree().catch((error) => {
  console.error(`UI 测试无法开始: ${error.message}`);
  process.exit(1);
});

const child = packagedExe
  ? spawn(packagedExe, [`--remote-debugging-port=${CDP_PORT}`], { stdio: "inherit" })
  : spawn(electronPath, [".", `--remote-debugging-port=${CDP_PORT}`], {
      cwd: ROOT,
      stdio: "inherit",
    });

let exitCode = 1;
try {
  const target = await mainWindowTarget();
  if (!target) throw new Error("主窗口 CDP 目标未出现");
  const session = await CdpSession.connect(target.webSocketDebuggerUrl);
  console.log(`[ui-test] ${stamp()} 已连上主窗口`);
  if (!(await waitForExpression(session, `Boolean(document.querySelector('.nav-item[data-view=saduck]'))`))) {
    throw new Error("主窗口 DOM 未就绪");
  }

  // 冷启动窗口本身就会让说明文字读到一次「未登录」，先点开 SaDuck 页固化这一点。
  await session.eval(`document.querySelector('.nav-item[data-view=saduck]').click()`);
  console.log(`[ui-test] ${stamp()} 已切到 SaDuck 页`);

  let status = null;
  for (let i = 0; i < 40; i++) {
    status = await fetchJson(`${BASE}/api/saduck/status`).catch(() => null);
    if (status?.loggedIn) break;
    await sleep(500);
  }
  if (!status?.loggedIn) {
    console.log(`[ui-test] SKIP: 本机 SaDuck 未登录，无法断言恢复路径`);
    exitCode = 2;
    throw new Error("skip");
  }
  console.log(`[ui-test] ${stamp()} 实时状态 loggedIn=true（account=${status.account?.emailMasked ?? "-"}）`);

  const baseline = await waitForNote(session, (text) => text.includes(NOTE_OK), 8000);
  if (!baseline) throw new Error(`基线失败：页面已登录但说明文字是「${await session.eval('document.querySelector("#sd-note").textContent')}」`);
  console.log(`[ui-test] ${stamp()} 基线正常：${baseline}`);

  // 复现：让 webview 离开 saduck.top 时做一次检查（重载/冷启动时的真实时序），
  // 说明文字会写入「未登录」；随后恢复页面，看它能否自己纠正。
  await session.eval(`document.querySelector("#saduck").src = "about:blank"`);
  await sleep(400);
  await session.eval(`document.querySelector('.nav-item[data-view=saduck]').click()`);
  const latched = await waitForNote(session, (text) => text.startsWith(NOTE_BAD), 5000);
  if (!latched) {
    console.log(`[ui-test] ${stamp()} 未复现：检查没有读到「未登录」，本次结果不可判定`);
    exitCode = 2;
    throw new Error("未复现");
  }
  console.log(`[ui-test] ${stamp()} 已复现说明文字卡在：${latched}`);

  await session.eval(`document.querySelector("#saduck").src = "https://saduck.top/"`);
  const recovered = await waitForNote(session, (text) => text.includes(NOTE_OK), 20000);
  const pill = await session.eval(`document.querySelector("#sd-pill").textContent`);
  const note = await session.eval(`document.querySelector("#sd-note").textContent`);
  console.log(`[ui-test] ${stamp()} 说明文字=${note}`);
  console.log(`[ui-test] ${stamp()} 底部胶囊=${pill}`);
  if (!recovered) throw new Error("修复未生效：加载完成后说明文字仍停在「未登录」");
  if (!pill.includes("SaDuck 已登录")) throw new Error(`底部胶囊与说明不一致：${pill}`);

  console.log(`[ui-test] PASS：说明文字与底部胶囊都已跟随真实登录状态`);
  exitCode = 0;
} catch (error) {
  if (error?.message !== "skip" && error?.message !== "未复现") console.error(`[ui-test] FAIL: ${error.message}`);
} finally {
  try {
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
  } catch {
    child.kill();
  }
}
process.exit(exitCode);
