import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSaduckSync, readSaduckManifest, SADUCK_NEVER_EXPOSED } from "../src/saduck.mjs";

function createFakeWeb(routes = {}) {
  return {
    isDestroyed() {
      return false;
    },
    getURL() {
      return "https://saduck.top/dashboard";
    },
    async executeJavaScript(script) {
      if (typeof script === "string" && script.trim() === 'localStorage.getItem("token")') {
        return "synthetic-token-for-test-1234567890";
      }
      for (const [routePath, handler] of Object.entries(routes)) {
        if (typeof script === "string" && script.includes(`/api${routePath}`)) {
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
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "testuser@example.com" } },
    });

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
    const manifest = readSaduckManifest(outDir);
    assert.ok(manifest);
    assert.deepEqual(manifest.datasets, []);
  } finally {
    cleanTempDir(outDir);
  }
});

test("manifest states and files: on-disk manifest integrity", async () => {
  const outDir = makeTempDir();
  try {
    const fakeWeb = createFakeWeb({
      "/user/verify": { code: 0, result: { email: "student@example.com", vipType: null, vipEndTime: null } },
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
    assert.equal(manifest.account.emailMasked, "st***@example.com");
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
  } finally {
    cleanTempDir(outDir);
  }
});
