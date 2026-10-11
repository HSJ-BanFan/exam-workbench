export function createSaduckSyncController({
  state,
  getConfiguredDatasets,
  runSelected,
  broadcast,
  writeLog,
}) {
  async function run(selection, source) {
    if (state.running) {
      return { ok: false, error: "busy", message: "已有 SaDuck 同步在进行中" };
    }
    state.running = true;
    state.lastError = null;
    const log = (message) => {
      writeLog(source, message);
      broadcast("sync:progress", { type: "log", message: `SaDuck：${message}`, at: Date.now() });
    };
    broadcast("sync:progress", { type: "start", at: Date.now() });
    try {
      const datasets = selection.kind === "explicit" ? selection.datasets : getConfiguredDatasets();
      const summary = await runSelected({ datasets, source, log });
      state.lastSummary = summary;
      state.lastSyncAt = Date.now();
      if (!summary.ok) {
        state.lastError = summary.error || "SaDuck 同步部分失败";
        log(`同步部分失败：${state.lastError}`);
        broadcast("sync:progress", {
          type: "error",
          message: state.lastError,
          summary,
          at: Date.now(),
        });
      } else {
        broadcast("sync:progress", { type: "done", summary, at: Date.now() });
      }
      return summary;
    } catch (error) {
      state.lastError = String(error?.message ?? error);
      log(`同步失败：${state.lastError}`);
      broadcast("sync:progress", { type: "error", message: state.lastError, at: Date.now() });
      return { ok: false, error: state.lastError };
    } finally {
      state.running = false;
    }
  }

  return {
    fromIpc(options = {}) {
      const selection = Array.isArray(options?.datasets)
        ? { kind: "explicit", datasets: options.datasets }
        : { kind: "configured" };
      return run(selection, options?.source ?? "app");
    },

    fromHttp({ query, body } = {}) {
      let selection;
      if (query?.has("datasets")) {
        const raw = query.get("datasets") ?? "";
        selection = {
          kind: "explicit",
          datasets: String(raw).split(",").map((item) => item.trim()).filter(Boolean),
        };
      } else if (Array.isArray(body?.datasets)) {
        selection = { kind: "explicit", datasets: body.datasets };
      } else {
        selection = { kind: "configured" };
      }
      return run(selection, "api").then((summary) => ({
        httpStatus: summary.ok ? 200 : 409,
        body: summary,
      }));
    },
  };
}
