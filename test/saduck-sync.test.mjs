import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSaduckSync, readSaduckManifest, SADUCK_NEVER_EXPOSED } from "../src/saduck.mjs";
import { createApiServer } from "../src/server.mjs";

const SYNTHETIC_TOKEN = "synthetic-token-for-test-1234567890";

function createFakeWeb(routes = {}, calls = []) {
  return {
    isDestroyed() {
      return false;
    },
    getURL() {
      return "https://saduck.top/dashboard";
    },
    async executeJavaScript(script) {
      if (typeof script === "string" && script.trim() === 'localStorage.getItem("token")') {
        return SYNTHETIC_TOKEN;
      }
      for (const [routePath, handler] of Object.entries(routes)) {
        if (typeof script === "string" && script.includes(`/api${routePath}`)) {
          calls.push(routePath);
          if (typeof handler === "function") {
            const data = await handler();
            return typeof data === "string" ? data : JSON.stringify(data);
          }
          return typeof handler === "string" ? handler : JSON.stringify(handler);
        }
      }
      return JSON.stringify({ code: -1, message: "Unhandled synthetic route" });
    },
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "exam-wb-sd-test-"));
}

function cleanTempDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readOutputFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? readOutputFiles(file) : [fs.readFileSync(file, "utf8")];
  });
}

test("complete: all selected datasets succeed", async () => {
  const outDir = makeTempDir();
  try {
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "testuser@example.com", vipType: 1, vipEndTime: "2027-01-01" } },
      "/myTime/list": { code: 0, result: [{ id: 1, duration: 300 }] },
      "/plan/list": { code: 0, result: [{ id: 101, content: "打卡" }] },
    });

    const result = await runSaduckSync({
      web: fakeWeb,
      outDir,
      datasets: ["time", "plan"],
      log: () => {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    assert.equal(result.datasets.time.status, "ok");
    assert.equal(result.datasets.time.items, 1);
    assert.equal(result.datasets.plan.status, "ok");
    assert.equal(result.datasets.plan.items, 1);
    assert.ok(fs.existsSync(path.join(outDir, "计时记录", "time.json")));
    assert.ok(fs.existsSync(path.join(outDir, "计时记录", "计时记录.md")));
    assert.ok(fs.existsSync(path.join(outDir, "每日打卡", "plan.json")));
    assert.ok(fs.existsSync(path.join(outDir, "每日打卡", "每日打卡.md")));
    assert.ok(fs.existsSync(path.join(outDir, "manifest.json")));
  } finally {
    cleanTempDir(outDir);
  }
});

test("partial failure: some datasets succeed and some error", async () => {
  const outDir = makeTempDir();
  try {
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "testuser@example.com" } },
      "/myTime/list": { code: 0, result: [{ id: 1, duration: 300 }] },
      "/plan/list": { code: 503, message: "synthetic upstream failure" },
    });

    const result = await runSaduckSync({
      web: fakeWeb,
      outDir,
      datasets: ["time", "plan"],
      log: () => {},
    });

    assert.equal(result.ok, false, "overall ok must be false on partial dataset error");
    assert.equal(typeof result.error, "string", "error must be a string");
    assert.match(result.error, /每日打卡|plan/, "error must identify failed dataset title or id");
    assert.equal(result.datasets.time.status, "ok");
    assert.equal(result.datasets.plan.status, "error");
    assert.match(result.datasets.plan.message, /503/);
    assert.ok(fs.existsSync(path.join(outDir, "计时记录", "time.json")));
    assert.equal(result.datasets.plan.files.length, 0);
    assert.ok(fs.existsSync(path.join(outDir, "manifest.json")));
  } finally {
    cleanTempDir(outDir);
  }
});

test("all failure: every selected dataset errors", async () => {
  const outDir = makeTempDir();
  try {
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "testuser@example.com" } },
      "/myTime/list": { code: 500, message: "time api crashed" },
      "/plan/list": { code: 503, message: "plan api unavailable" },
    });

    const result = await runSaduckSync({
      web: fakeWeb,
      outDir,
      datasets: ["time", "plan"],
      log: () => {},
    });

    assert.equal(result.ok, false, "overall ok must be false when all datasets error");
    assert.equal(typeof result.error, "string", "error must be a string");
    assert.match(result.error, /time|计时记录/);
    assert.match(result.error, /plan|每日打卡/);
    assert.equal(result.datasets.time.status, "error");
    assert.equal(result.datasets.plan.status, "error");
    assert.ok(fs.existsSync(path.join(outDir, "manifest.json")));
  } finally {
    cleanTempDir(outDir);
  }
});

test("VIP: VIP-limited dataset is non-error", async () => {
  const outDir = makeTempDir();
  try {
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "testuser@example.com", vipType: 0 } },
      "/myTime/list": { code: 0, result: [{ id: 1 }] },
      "/myWord/list": { code: 102, message: "会员功能受限" },
    });

    const result = await runSaduckSync({
      web: fakeWeb,
      outDir,
      datasets: ["time", "words"],
      log: () => {},
    });

    assert.equal(result.ok, true, "VIP limitation must not mark overall ok false");
    assert.equal(result.error, undefined);
    assert.equal(result.datasets.time.status, "ok");
    assert.equal(result.datasets.words.status, "vip");
    assert.equal(result.datasets.words.files.length, 0);
    const manifest = readSaduckManifest(outDir);
    assert.ok(manifest);
    const wordDs = manifest.datasets.find((d) => d.id === "words");
    assert.equal(wordDs.state, "vip");
  } finally {
    cleanTempDir(outDir);
  }
});

test("empty selection: empty dataset list returns ok:true with warning", async () => {
  const outDir = makeTempDir();
  try {
    const calls = [];
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "testuser@example.com" } },
    }, calls);

    const result = await runSaduckSync({
      web: fakeWeb,
      outDir,
      datasets: [],
      log: () => {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.datasets, {});
    assert.ok(result.warnings.length > 0, "must include a warning for empty selection");
    assert.ok(result.warnings.some((w) => /未选择|数据集/i.test(w)));
    assert.deepEqual(calls, ["/user/verify"], "an empty selection must not call dataset endpoints");
    const manifest = readSaduckManifest(outDir);
    assert.ok(manifest);
    assert.deepEqual(manifest.datasets, []);
  } finally {
    cleanTempDir(outDir);
  }
});

test("unknown dataset IDs: preserve existing output and stop before session verification", async () => {
  const outDir = makeTempDir();
  try {
    const manifestPath = path.join(outDir, "manifest.json");
    const before = '{"previous":"keep"}\n';
    fs.writeFileSync(manifestPath, before, "utf8");
    const calls = [];
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "synthetic-user@example.invalid" } },
    }, calls);

    await assert.rejects(runSaduckSync({
      web: fakeWeb,
      outDir,
      datasets: ["unknown-synthetic-id"],
      log: () => {},
    }), /unknown-synthetic-id/);

    assert.deepEqual(calls, []);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), before);
    assert.deepEqual(fs.readdirSync(outDir).sort(), ["manifest.json"]);
  } finally {
    cleanTempDir(outDir);
  }
});

async function loadSaduckSyncController() {
  let module;
  try {
    module = await import("../src/saduck-sync-controller.mjs");
  } catch (error) {
    assert.fail("SaDuck request selection behavior requires a testable controller: " + (error.code ?? error.message));
  }
  assert.equal(typeof module.createSaduckSyncController, "function", "controller factory must be exported");
  return module.createSaduckSyncController;
}

function makeControllerHarness({ summary, runSelected } = {}) {
  const state = { running: false, lastSummary: null, lastError: null, lastSyncAt: null };
  const calls = [];
  const events = [];
  const getConfiguredDatasets = () => ["time", "plan"];
  const controllerPromise = loadSaduckSyncController().then((createSaduckSyncController) => createSaduckSyncController({
    state,
    getConfiguredDatasets,
    runSelected: runSelected ?? (async ({ datasets, source }) => {
      calls.push({ datasets: [...datasets], source });
      return summary ?? makeSaduckSummary();
    }),
    broadcast: (channel, event) => events.push({ channel, event }),
    writeLog: () => {},
  }));
  return { state, calls, events, controllerPromise };
}

function makeSaduckSummary({ ok = true, error } = {}) {
  const summary = {
    ok,
    startedAt: 100,
    finishedAt: 200,
    outDir: "/synthetic/saduck",
    account: { emailMasked: "s***@example.test", vipType: null, vipEndTime: null },
    datasets: ok ? {} : {
      plan: { title: "每日打卡", items: 0, status: "error", message: "503 synthetic failure", files: [] },
    },
    warnings: [],
    manifest: "/synthetic/saduck/manifest.json",
  };
  if (error !== undefined) summary.error = error;
  return summary;
}

async function withSaduckApi(controller, run) {
  const server = await createApiServer({
    port: 0,
    host: "127.0.0.1",
    token: "",
    handlers: { saduck: (input) => controller.fromHttp(input) },
    onLog: () => {},
  });
  const port = server.address().port;
  try {
    await run(port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("IPC selection: only omitted or non-array values use configured defaults", async () => {
  const harness = makeControllerHarness();
  const controller = await harness.controllerPromise;

  await controller.fromIpc({});
  await controller.fromIpc({ datasets: [] });
  await controller.fromIpc({ datasets: "time" });

  assert.deepEqual(harness.calls.map((call) => call.datasets), [["time", "plan"], [], ["time", "plan"]]);
  assert.deepEqual(harness.calls.map((call) => call.source), ["app", "app", "app"]);
  assert.equal(harness.state.running, false);
});

test("HTTP selection: an empty query or body list stays empty through the API server", async () => {
  const harness = makeControllerHarness();
  const controller = await harness.controllerPromise;
  const summary = makeSaduckSummary();

  await withSaduckApi(controller, async (port) => {
    const queryResponse = await fetch("http://127.0.0.1:" + port + "/api/saduck/sync?datasets=", {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({ datasets: ["time"] }),
    });
    assert.equal(queryResponse.status, 200);
    assert.deepEqual(await queryResponse.json(), summary);

    const bodyResponse = await fetch("http://127.0.0.1:" + port + "/api/saduck/sync", {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({ datasets: [] }),
    });
    assert.equal(bodyResponse.status, 200);
    assert.deepEqual(await bodyResponse.json(), summary);

    const defaultResponse = await fetch("http://127.0.0.1:" + port + "/api/saduck/sync", {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({}),
    });
    assert.equal(defaultResponse.status, 200);
    assert.deepEqual(await defaultResponse.json(), summary);

    const queryWinsResponse = await fetch("http://127.0.0.1:" + port + "/api/saduck/sync?datasets=plan,", {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({ datasets: ["time"] }),
    });
    assert.equal(queryWinsResponse.status, 200);
    assert.deepEqual(await queryWinsResponse.json(), summary);
  });

  assert.deepEqual(harness.calls.map((call) => call.datasets), [[], [], ["time", "plan"], ["plan"]]);
  assert.deepEqual(harness.calls.map((call) => call.source), ["api", "api", "api", "api"]);
});

test("failed summary: state and progress report the dataset failure", async () => {
  const summary = makeSaduckSummary({ ok: false, error: "部分数据集同步失败：每日打卡（plan）" });
  const harness = makeControllerHarness({ summary });
  const controller = await harness.controllerPromise;

  assert.deepEqual(await controller.fromIpc({ datasets: ["plan"] }), summary);
  assert.equal(harness.state.lastError, summary.error);
  assert.deepEqual(harness.state.lastSummary, summary);
  assert.equal(typeof harness.state.lastSyncAt, "number");
  assert.equal(harness.state.running, false);
  const progress = harness.events.at(-1);
  assert.equal(progress.channel, "sync:progress");
  assert.equal(progress.event.type, "error");
  assert.equal(progress.event.message, summary.error);
  assert.deepEqual(progress.event.summary, summary);
  assert.equal(typeof progress.event.at, "number");
});

test("HTTP failure: a 409 keeps the complete sync summary body", async () => {
  const summary = makeSaduckSummary({ ok: false, error: "部分数据集同步失败：每日打卡（plan）" });
  const harness = makeControllerHarness({ summary });
  const controller = await harness.controllerPromise;

  await withSaduckApi(controller, async (port) => {
    const response = await fetch("http://127.0.0.1:" + port + "/api/saduck/sync?datasets=plan", {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), summary);
  });
});

test("busy and thrown failures preserve the existing controller outcomes", async () => {
  const busyHarness = makeControllerHarness();
  busyHarness.state.running = true;
  const busyController = await busyHarness.controllerPromise;
  assert.deepEqual(await busyController.fromIpc({ datasets: [] }), {
    ok: false,
    error: "busy",
    message: "已有 SaDuck 同步在进行中",
  });
  assert.deepEqual(busyHarness.calls, []);
  assert.deepEqual(busyHarness.events, []);

  const failedHarness = makeControllerHarness({ runSelected: async () => { throw new Error("synthetic run failure"); } });
  const failedController = await failedHarness.controllerPromise;
  assert.deepEqual(await failedController.fromIpc({ datasets: [] }), { ok: false, error: "synthetic run failure" });
  assert.equal(failedHarness.state.lastError, "synthetic run failure");
  assert.equal(failedHarness.state.running, false);
  assert.equal(failedHarness.events.at(-1).event.type, "error");
  assert.equal("summary" in failedHarness.events.at(-1).event, false);
});

test("manifest states and files: on-disk manifest integrity", async () => {
  const outDir = makeTempDir();
  try {
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "synthetic-person@example.invalid", token: SYNTHETIC_TOKEN, vipType: null, vipEndTime: null } },
      "/myTime/list": { code: 0, result: [{ duration: 50 }] },
      "/plan/list": { code: 503, message: "synthetic plan error" },
    });

    const result = await runSaduckSync({
      web: fakeWeb,
      outDir,
      datasets: ["time", "plan"],
      log: () => {},
    });

    const manifest = readSaduckManifest(outDir);
    assert.ok(manifest);
    assert.equal(manifest.app, "exam-workbench");
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.account.emailMasked, "sy***@example.invalid");
    assert.equal(manifest.datasets.length, 2);
    const timeEntry = manifest.datasets.find((d) => d.id === "time");
    assert.equal(timeEntry.state, "ok");
    assert.equal(timeEntry.count, 1);
    const planEntry = manifest.datasets.find((d) => d.id === "plan");
    assert.equal(planEntry.state, "error");
    assert.equal(planEntry.count, 0);
    assert.match(planEntry.message, /503/);
    assert.ok(manifest.files.includes("00-说明.md"));
    assert.ok(manifest.files.includes("状态/同步状态.md"));
    assert.ok(manifest.files.includes("计时记录/time.json"));
    assert.deepEqual(manifest.neverExposed, SADUCK_NEVER_EXPOSED);
    const output = readOutputFiles(outDir).join("\n");
    assert.equal(output.includes(SYNTHETIC_TOKEN), false);
    assert.equal(output.includes("synthetic-person@example.invalid"), false);
  } finally {
    cleanTempDir(outDir);
  }
});
