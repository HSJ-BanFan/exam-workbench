const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  datasets: [],
  status: null,
  saduck: null,
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

  const sdPill = $("#sd-pill");
  const sdOn = Boolean(st.hasSaduckSession);
  renderSaduckPill(sdOn);

  $("#rail-version").textContent = cfg.version ? `v${cfg.version}` : "";
  $("#inp-dir").value = cfg.dataDir ?? "";
  $("#inp-sd-dir").value = cfg.saduckDir ?? "";
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
  const previous = document.querySelector(".view.active")?.id;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "saduck") checkSaduck();
  if (name === "naoku" && previous !== "view-naoku") loadNaoku();
}

// ---------------------------------------------------------------- saduck

let saduckCheckInFlight = null;
let saduckRecheckTimer = null;

function renderSaduckPill(loggedIn) {
  const pill = $("#sd-pill");
  pill.classList.toggle("ok", loggedIn);
  pill.classList.toggle("bad", !loggedIn);
  pill.lastChild.textContent = loggedIn ? "SaDuck 已登录" : "SaDuck 未登录";
}

// 冷启动或重载时，第一次检查可能落在「还没到 saduck.top」的中间态，读到未登录。
// 之后没人复查，说明文字就会一直和页面、底部胶囊互相打脸。
function checkSaduck() {
  if (saduckCheckInFlight) return saduckCheckInFlight;
  saduckCheckInFlight = refreshSaduck().finally(() => {
    saduckCheckInFlight = null;
  });
  return saduckCheckInFlight;
}

function scheduleSaduckRecheck() {
  if (saduckRecheckTimer) return;
  saduckRecheckTimer = setInterval(() => {
    if (document.querySelector("#view-saduck").classList.contains("active")) checkSaduck();
  }, 4000);
}

function stopSaduckRecheck() {
  if (!saduckRecheckTimer) return;
  clearInterval(saduckRecheckTimer);
  saduckRecheckTimer = null;
}

async function refreshSaduck() {
  const sd = await window.desk.saduckStatus();
  state.saduck = sd;
  const note = $("#sd-note");
  if (sd.loggedIn) {
    const acc = sd.account ?? {};
    note.textContent = `已登录 ${acc.emailMasked ?? ""} · vipType=${acc.vipType ?? "?"} · 到期 ${acc.vipEndTime ?? "?"}`;
    stopSaduckRecheck();
  } else {
    note.textContent = "未登录：在下方打开 saduck.top 登录后即可同步（登录态保存在本机应用目录）。";
    scheduleSaduckRecheck();
  }
  if (state.status) state.status.hasSaduckSession = sd.loggedIn;
  renderSaduckPill(sd.loggedIn);
  return sd;
}

// ---------------------------------------------------------------- 脑库

const naokuState = { tree: [], importing: false };

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(text ?? "").replace(/[&<>"]/g, (c) => map[c]);
}

function brief(text, max) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// 脑库笔记里的 [[链接]]：只有题号与考点名做成按钮，其余前缀（15-材料 等）只显示别名。
function wikilinkHtml(inner) {
  const [rawTarget, rawAlias] = String(inner).split("|");
  const target = rawTarget.split("#")[0].trim().replace(/\\/g, "/");
  const label = (rawAlias ?? rawTarget).trim();
  if (target.startsWith("10-真题/")) {
    const qid = (target.split("/").pop() ?? "").match(/^\d+/)?.[0] ?? "";
    return /^\d+$/.test(qid) ? `<button class="wikilink" data-qid="${qid}">${label}</button>` : label;
  }
  if (target.startsWith("20-考点/")) {
    const point = (target.split("/").pop() ?? "").replace(/\.md$/, "");
    return point ? `<button class="wikilink" data-point="${point}">${label}</button>` : label;
  }
  return label;
}

function inlineMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([^\]]+)\]\]/g, (_match, inner) => wikilinkHtml(inner))
    .replace(/&lt;img\b[^<]*?&gt;/gi, (tag) =>
      /flag=(&quot;tex&quot;|'tex'|tex)/.test(tag)
        ? '<span class="imgph">［公式］</span>'
        : '<span class="imgph">［图］</span>'
    );
}

// 笔记是第三方 markdown，可能含任意 HTML：先整体转义再做白名单转换。
// 只有本函数的输出可以进 innerHTML，其余拼接一律走 escapeHtml。
function renderMarkdown(raw) {
  const body = String(raw ?? "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const html = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  for (const line of escapeHtml(body).split(/\r?\n/)) {
    const text = line.trim();
    if (!text) {
      closeList();
      continue;
    }
    const heading = text.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      // 正文里的 # 级到 ###### 级统一落到 h3~h6，避免和卡片自己的 h2 抢层级。
      const tag = `h${Math.min(heading[1].length + 2, 6)}`;
      html.push(`<${tag}>${inlineMarkdown(heading[2])}</${tag}>`);
      continue;
    }
    if (/^-{3,}$/.test(text)) {
      closeList();
      html.push("<hr />");
      continue;
    }
    const bullet = text.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdown(text)}</p>`);
  }
  closeList();
  return html.join("\n");
}

async function naokuCall(pathname, params) {
  const result = await window.desk.naoku(pathname, params);
  // HTTP 层的失败响应形状是 { httpStatus, body }，走 IPC 只带 body 回来。
  return result?.body ?? result ?? { ok: false, error: "脑库接口无响应" };
}

async function loadNaokuStatus() {
  const status = await naokuCall("status");
  const kv = $("#naoku-kv");
  kv.textContent = "";
  const add = (label, value, mono) => {
    const row = document.createElement("div");
    const key = document.createElement("span");
    const val = document.createElement("b");
    key.textContent = label;
    if (mono) val.className = "mono";
    val.textContent = value;
    row.append(key, val);
    kv.appendChild(row);
  };
  const counts = status.counts ?? {};
  add("副本路径", status.vaultDir ?? "—", true);
  // 索引文件还在、副本却被移走时，说「已就绪」会和下面的导入按钮互相打脸。
  const indexLabel = !status.imported && status.indexed
    ? "副本不在（索引是旧数据，需重新导入）"
    : status.indexed
      ? "已就绪"
      : status.imported
        ? "已导入，尚未建索引"
        : "未导入";
  add("索引状态", indexLabel);
  add(
    "真题 / 考点 / 材料",
    status.indexed ? `${counts.真题 ?? 0} / ${counts.考点 ?? 0} / ${counts.材料 ?? 0}` : "—"
  );
  add("索引生成时间", status.generatedAtText ?? "—");
  const warnings = $("#naoku-warnings");
  warnings.textContent = "";
  for (const text of status.warnings ?? []) {
    const li = document.createElement("li");
    li.textContent = text;
    warnings.appendChild(li);
  }
  warnings.hidden = !warnings.childElementCount;
  const ready = Boolean(status.imported && status.indexed);
  $("#naoku-import-row").hidden = ready;
  return status;
}

async function loadNaoku() {
  const status = await loadNaokuStatus();
  const ready = Boolean(status.imported && status.indexed);
  for (const id of ["naoku-block-wrong", "naoku-block-lookup", "naoku-block-points"]) {
    $(`#${id}`).hidden = !ready;
  }
  if (!ready) return;
  await Promise.all([loadNaokuWrongHits(), loadNaokuTree()]);
}

async function loadNaokuWrongHits() {
  const list = $("#naoku-wrong-list");
  const summary = $("#naoku-wrong-summary");
  list.textContent = "";
  const result = await naokuCall("wrong-hits");
  if (!result.ok) {
    summary.textContent = result.error ?? "错题命中读取失败";
    return;
  }
  if (result.说明) {
    summary.textContent = result.说明;
    return;
  }
  const coverage = "其余属脑库覆盖范围外（脑库只覆盖资料分析和判断推理两个模块）。";
  summary.textContent = `共 ${result.total} 道错题，${result.hitCount} 道有脑库标注。${result.missCount ? coverage : ""}`;
  if (!result.hits?.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "当前错题没有命中脑库标注。";
    list.appendChild(empty);
    return;
  }
  for (const hit of result.hits) {
    const row = document.createElement("button");
    row.className = "hit";
    row.dataset.qid = hit.qid;
    row.innerHTML =
      `<span class="mono">${escapeHtml(hit.qid)}</span>` +
      `<span>${escapeHtml(hit.考点 || `${hit.模块} / ${hit.大类}`)}</span>`;
    list.appendChild(row);
  }
}

async function loadNaokuTree() {
  const result = await naokuCall("tree");
  const moduleSelect = $("#sel-naoku-module");
  moduleSelect.textContent = "";
  naokuState.tree = result.ok ? result.模块 ?? [] : [];
  if (!naokuState.tree.length) {
    $("#naoku-points-count").textContent = result.error ?? "没有可浏览的考点";
    return;
  }
  for (const item of naokuState.tree) {
    const option = document.createElement("option");
    option.value = item.模块;
    option.textContent = item.模块;
    moduleSelect.appendChild(option);
  }
  fillCatOptions();
  await loadNaokuPoints();
}

function fillCatOptions() {
  const catSelect = $("#sel-naoku-cat");
  const entry = naokuState.tree.find((item) => item.模块 === $("#sel-naoku-module").value);
  catSelect.textContent = "";
  for (const item of entry?.大类 ?? []) {
    const option = document.createElement("option");
    option.value = item.大类;
    option.textContent = `${item.大类}（考点 ${item.考点数} / 真题 ${item.真题数}）`;
    catSelect.appendChild(option);
  }
}

function pointRow(item, open) {
  const wrap = document.createElement("div");
  wrap.className = open ? "point open" : "point";
  const head = document.createElement("button");
  head.className = "point-head";
  head.innerHTML =
    `<span class="point-name">${escapeHtml(item.考点)}</span>` +
    `<span class="badge">${Number(item.题数) || 0} 题</span>` +
    `<span class="point-meta">${escapeHtml(brief(item.母题, 46) || "（索引里没有母题摘要）")}</span>`;
  const body = document.createElement("div");
  body.className = "point-body";
  body.hidden = !open;
  body.innerHTML = `<p>${escapeHtml(item.母题 || "（索引里没有母题摘要）")}</p>`;
  const label = document.createElement("div");
  label.className = "muted";
  label.textContent = "该考点的真题题号（点击查看标注）";
  const qids = document.createElement("div");
  qids.className = "qids";
  qids.innerHTML = (item.真题 ?? [])
    .filter((qid) => /^\d+$/.test(String(qid)))
    .map((qid) => `<button class="wikilink" data-qid="${qid}">${qid}</button>`)
    .join("");
  if (!qids.childElementCount) qids.innerHTML = '<span class="muted">（索引里没有可跳转的真题）</span>';
  body.append(label, qids);
  head.addEventListener("click", () => {
    body.hidden = !body.hidden;
    wrap.classList.toggle("open", !body.hidden);
  });
  wrap.append(head, body);
  return wrap;
}

// [[考点]] 链接只带考点名，索引里的考点名取自 frontmatter，可能与笔记文件名不同。
// 过滤是包含匹配（母题也会命中），所以要挑精确相等的那条，不能拿第一条。
async function resolveNaokuPoint(name) {
  const hit = await naokuCall("search", { type: "考点", 考点: name, limit: "200" });
  const items = hit.items ?? [];
  const fileName = (item) => String(item.path ?? "").split("/").pop()?.replace(/\.md$/, "") ?? "";
  return items.find((item) => item.考点 === name) ?? items.find((item) => fileName(item) === name) ?? null;
}

async function loadNaokuPoints({ focus, focusRow } = {}) {
  const list = $("#naoku-points");
  const hint = $("#naoku-points-count");
  list.textContent = "";
  const result = await naokuCall("points", {
    模块: $("#sel-naoku-module").value,
    大类: $("#sel-naoku-cat").value,
    sort: "题数",
    limit: "200",
  });
  if (!result.ok) {
    hint.textContent = result.error ?? "考点读取失败";
    return;
  }
  let items = result.items ?? [];
  let focusName = focus;
  let prepended = false;
  if (focus && !items.some((item) => item.考点 === focus)) {
    // 从笔记里的 [[考点]] 跳过来时，该考点可能落在按题数取的前 200 条之外。
    const row = focusRow ?? (await resolveNaokuPoint(focus));
    if (row) {
      items = [row, ...items];
      focusName = row.考点;
      prepended = true;
    }
  }
  hint.textContent =
    `共 ${result.total} 个考点，按题数显示前 ${items.length} 个` + (prepended ? "（含 1 条不在前 200 内）" : "");
  for (const item of items) list.appendChild(pointRow(item, item.考点 === focusName));
}

async function lookupNaokuQuestion(qid) {
  const hint = $("#naoku-lookup-hint");
  const box = $("#naoku-note");
  const text = String(qid ?? "").trim();
  box.textContent = "";
  if (!/^\d+$/.test(text)) {
    hint.textContent = "请输入数字题号（粉笔题号）。";
    return;
  }
  $("#inp-naoku-qid").value = text;
  hint.textContent = "查询中…";
  const found = await naokuCall("for-question", { qid: text });
  if (!found.ok) {
    hint.textContent = found.error ?? "查询失败";
    return;
  }
  if (!found.笔记) {
    hint.textContent = `题号 ${text}：该题不在脑库覆盖范围内。`;
    return;
  }
  hint.textContent = `题号 ${text}：${found.笔记.模块} / ${found.笔记.大类}，相关题 ${found.相关题?.length ?? 0} 道`;
  const note = await naokuCall("note", { path: found.笔记.path });
  if (!note.ok) {
    hint.textContent = note.error ?? "笔记读取失败";
    return;
  }
  box.innerHTML = renderMarkdown(note.content);
  $("#naoku-block-lookup").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function selectNaokuPoint(name) {
  const row = await resolveNaokuPoint(name);
  if (!row) {
    $("#naoku-points-count").textContent = `索引里没有「${name}」这个考点`;
    return;
  }
  const known = naokuState.tree.find(
    (item) => item.模块 === row.模块 && item.大类.some((c) => c.大类 === row.大类)
  );
  const 模块 = known ? row.模块 : $("#sel-naoku-module").value;
  const 大类 = known ? row.大类 : $("#sel-naoku-cat").value;
  $("#sel-naoku-module").value = 模块;
  fillCatOptions();
  $("#sel-naoku-cat").value = 大类;
  await loadNaokuPoints({ focus: row.考点, focusRow: row });
}

async function importNaoku() {
  const button = $("#btn-naoku-import");
  const hint = $("#naoku-import-hint");
  button.disabled = true;
  naokuState.importing = true;
  try {
    hint.textContent = "导入中（稀疏克隆或更新副本，可能要几分钟）…";
    const imported = await naokuCall("import");
    if (!imported.ok) throw new Error(imported.error ?? "导入失败");
    hint.textContent = "建索引中（扫描两万余篇笔记）…";
    const indexed = await naokuCall("index");
    if (!indexed.ok) throw new Error(indexed.error ?? "建索引失败");
    hint.textContent = "完成";
  } catch (error) {
    const message = String(error?.message ?? error).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
    hint.textContent = `失败：${message}`;
  } finally {
    naokuState.importing = false;
    button.disabled = false;
    await loadNaoku();
  }
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

  const saduckView = $("#saduck");
  for (const eventName of ["dom-ready", "did-finish-load", "did-navigate", "did-navigate-in-page"]) {
    saduckView.addEventListener(eventName, () => checkSaduck());
  }
  $("#btn-sd-home").addEventListener("click", () => {
    saduckView.src = "https://saduck.top/";
  });
  $("#btn-sd-reload").addEventListener("click", () => saduckView.reload());
  $("#btn-sd-browser").addEventListener("click", () => window.desk.openExternal("https://saduck.top/"));
  const sdSyncBtn = $("#btn-sd-sync");
  sdSyncBtn.addEventListener("click", async () => {
    sdSyncBtn.disabled = true;
    sdSyncBtn.textContent = "同步中…";
    appendLog("开始同步 SaDuck…");
    const result = await window.desk.runSaduckSync({});
    appendLog(result?.ok ? `SaDuck 同步完成：${result.outDir}` : `SaDuck 同步结束：${result?.error ?? "未知错误"}`);
    sdSyncBtn.disabled = false;
    sdSyncBtn.textContent = "同步我的数据";
    await checkSaduck();
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
  $("#btn-copy-saduck").addEventListener("click", () =>
    navigator.clipboard.writeText(
      `Invoke-RestMethod "${state.config.apiBase}/api/saduck/data?dataset=time"`
    )
  );

  $("#btn-choose").addEventListener("click", async () => {
    const dir = await window.desk.chooseDir();
    if (dir) $("#inp-dir").value = dir;
  });
  $("#btn-sd-choose").addEventListener("click", async () => {
    const dir = await window.desk.chooseDir();
    if (dir) $("#inp-sd-dir").value = dir;
  });

  $("#btn-save").addEventListener("click", async () => {
    const patch = {
      dataDir: $("#inp-dir").value.trim(),
      saduckDir: $("#inp-sd-dir").value.trim(),
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

  const naokuView = $("#view-naoku");
  naokuView.addEventListener("click", (event) => {
    const point = event.target.closest("[data-point]");
    if (point) {
      selectNaokuPoint(point.dataset.point);
      return;
    }
    const qid = event.target.closest("[data-qid]");
    if (qid) lookupNaokuQuestion(qid.dataset.qid);
  });
  $("#btn-naoku-import").addEventListener("click", importNaoku);
  $("#btn-naoku-lookup").addEventListener("click", () => lookupNaokuQuestion($("#inp-naoku-qid").value));
  $("#inp-naoku-qid").addEventListener("keydown", (event) => {
    if (event.key === "Enter") lookupNaokuQuestion($("#inp-naoku-qid").value);
  });
  $("#sel-naoku-module").addEventListener("change", () => {
    fillCatOptions();
    loadNaokuPoints();
  });
  $("#sel-naoku-cat").addEventListener("change", () => loadNaokuPoints());
  // 导入/建索引的进度走同步日志通道，这里只在导入期间把最新一条贴到按钮旁。
  window.desk.onSyncProgress((payload) => {
    if (!naokuState.importing || payload.type !== "log") return;
    if (payload.message?.startsWith("脑库：")) $("#naoku-import-hint").textContent = payload.message.slice(3);
  });
}

wire();
refresh();
