const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  datasets: [],
  status: null,
  logLines: [],
};

function fmt(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function appendLog(line) {
  state.logLines.push(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${line}`);
  if (state.logLines.length > 400) state.logLines = state.logLines.slice(-400);
  $("#sync-log").textContent = state.logLines.join("\n");
  $("#sync-log").scrollTop = $("#sync-log").scrollHeight;
}

function renderDatasets() {
  const list = $("#dataset-list");
  list.textContent = "";
  for (const d of state.datasets) {
    const el = document.createElement("label");
    el.className = "dataset";
    el.innerHTML = `
      <input type="checkbox" ${d.enabled ? "checked" : ""} data-id="${d.id}" />
      <div>
        <div class="dataset-title">${d.title}</div>
        <div class="dataset-desc">${d.description}</div>
        <div class="dataset-use">给 agent：${d.agentUse}</div>
      </div>
      <span class="badge ${d.recommended ? "" : "sensitive"}">${d.recommended ? "推荐" : "可选"} · 敏感度 ${d.sensitivity}</span>
    `;
    el.querySelector("input").addEventListener("change", async (event) => {
      const enabled = event.target.checked;
      d.enabled = enabled;
      const selection = state.datasets.filter((x) => x.enabled).map((x) => x.id);
      state.config = await window.desk.setConfig({ datasets: selection });
    });
    list.appendChild(el);
  }
}

function renderStatus() {
  const cfg = state.config ?? {};
  const st = state.status ?? {};
  $("#last-sync").textContent = fmt(st.lastSyncAt);
  $("#sync-dir").textContent = cfg.dataDir ?? "—";
  $("#api-base").textContent = cfg.apiBase ?? "—";

  const loginPill = $("#login-pill");
  loginPill.classList.toggle("ok", Boolean(st.hasSession));
  loginPill.classList.toggle("bad", st.hasSession === false);
  loginPill.lastChild.textContent = st.hasSession ? "已登录" : st.hasSession === false ? "未登录（去刷题页登录）" : "登录状态未知";

  const apiPill = $("#api-pill");
  const apiUp = Boolean(cfg.apiBase);
  apiPill.classList.toggle("ok", apiUp);
  apiPill.lastChild.textContent = apiUp ? "本机接口已配置" : "接口未就绪";

  $("#rail-version").textContent = cfg.version ? `v${cfg.version}` : "";
  $("#inp-dir").value = cfg.dataDir ?? "";
  $("#inp-port").value = cfg.port ?? 8791;
  $("#inp-token").value = cfg.tokenSet ? "" : "";
  $("#inp-token").placeholder = cfg.tokenSet ? "已设置（留空保持不变）" : "未设置";
  $("#chk-auto").checked = Boolean(cfg.autoSyncOnLaunch);
  $("#bootstrap-path").textContent = cfg.bootstrapSessionPath ?? "—";
}

async function refresh() {
  state.config = await window.desk.getConfig();
  state.status = await window.desk.getStatus();
  state.datasets = await window.desk.listDatasets();
  renderStatus();
  renderDatasets();
}

function switchView(name) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
}

function wire() {
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );

  const webview = $("#fenbi");
  $("#btn-home").addEventListener("click", async () => {
    webview.src = await window.desk.tikuHome();
  });
  $("#btn-reload").addEventListener("click", () => webview.reload());
  $("#btn-browser").addEventListener("click", async () => {
    await window.desk.openExternal(await window.desk.tikuHome());
  });

  const syncBtn = $("#btn-sync");
  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = "同步中…";
    appendLog("开始同步…");
    const result = await window.desk.runSync({ full: $("#chk-full").checked });
    appendLog(result?.ok ? "同步完成。" : `同步结束：${result?.error ?? result?.message ?? "未知错误"}`);
    syncBtn.disabled = false;
    syncBtn.textContent = "立即同步";
    state.status = await window.desk.getStatus();
    renderStatus();
  });

  $("#btn-open-dir").addEventListener("click", () => window.desk.openPath(state.config.dataDir));
  $("#btn-copy-dir").addEventListener("click", () => navigator.clipboard.writeText(state.config.dataDir));
  $("#btn-copy-curl").addEventListener("click", () =>
    navigator.clipboard.writeText(
      `Invoke-RestMethod -Method Post -Uri "${state.config.apiBase}/api/sync" | ConvertTo-Json -Depth 6`
    )
  );
  $("#btn-copy-tiku").addEventListener("click", () =>
    navigator.clipboard.writeText(
      `Invoke-RestMethod "${state.config.apiBase}/api/tiku/papers?labelId=1&pageSize=5"`
    )
  );

  $("#btn-choose").addEventListener("click", async () => {
    const dir = await window.desk.chooseDir();
    if (dir) $("#inp-dir").value = dir;
  });

  $("#btn-save").addEventListener("click", async () => {
    const patch = {
      dataDir: $("#inp-dir").value.trim(),
      port: Number($("#inp-port").value),
      autoSyncOnLaunch: $("#chk-auto").checked,
    };
    const token = $("#inp-token").value.trim();
    if (token) patch.token = token;
    state.config = await window.desk.setConfig(patch);
    $("#save-hint").textContent = "已保存";
    setTimeout(() => ($("#save-hint").textContent = ""), 2000);
    renderStatus();
  });

  window.desk.onSyncProgress((payload) => {
    if (payload.type === "log") appendLog(payload.message);
    if (payload.type === "error") appendLog(`错误：${payload.message}`);
    if (payload.type === "done") {
      const ds = payload.summary?.datasets ?? {};
      appendLog(
        "完成：" +
          Object.entries(ds)
            .map(([, v]) => `${v.title}×${v.items}`)
            .join("，")
      );
      window.desk.getStatus().then((s) => {
        state.status = s;
        renderStatus();
      });
    }
  });
}

wire();
refresh();
