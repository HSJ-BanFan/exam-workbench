// 本机 HTTP 数据同步接口（默认仅监听 127.0.0.1）。
// 供本地 AI agent（Codex/Claude）触发同步与读取状态；数据本体在输出目录中。

import http from "node:http";

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

export function createApiServer({ port, host = "127.0.0.1", token = "", handlers, onLog = () => {} }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj, null, 2));
    };
    onLog(`${req.method} ${url.pathname}${url.search}`);
    try {
      if (token && req.headers["x-sync-token"] !== token) {
        return send(401, { ok: false, error: "需要 X-Sync-Token 请求头" });
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        return send(200, await handlers.status());
      }
      if (req.method === "GET" && url.pathname === "/api/datasets") {
        return send(200, await handlers.datasets());
      }
      if (req.method === "GET" && url.pathname === "/api/manifest") {
        const manifest = await handlers.manifest();
        return manifest ? send(200, manifest) : send(404, { ok: false, error: "尚无 manifest，先触发一次同步" });
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/tiku/")) {
        const result = await handlers.tiku({
          pathname: url.pathname.slice("/api/tiku/".length),
          query: url.searchParams,
        });
        return send(result?.httpStatus ?? 200, result?.body ?? result);
      }
      if (url.pathname.startsWith("/api/naoku/")) {
        const pathname = url.pathname.slice("/api/naoku/".length);
        const expected = pathname === "import" || pathname === "index" ? "POST" : "GET";
        if (req.method !== expected) {
          return send(405, { ok: false, error: `${pathname} 只接受 ${expected}` });
        }
        const result = await handlers.naoku({ pathname, query: url.searchParams, method: req.method });
        return send(result?.httpStatus ?? 200, result?.body ?? result);
      }
      if (req.method === "POST" && url.pathname === "/api/sync") {
        const body = await readBody(req);
        const datasetsParam = url.searchParams.get("datasets");
        const datasets = datasetsParam
          ? datasetsParam.split(",").map((s) => s.trim()).filter(Boolean)
          : Array.isArray(body?.datasets)
            ? body.datasets
            : undefined;
        const full = url.searchParams.get("full") === "1" || body?.full === true;
        const result = await handlers.sync({ datasets, full });
        return send(result.ok ? 200 : 409, result);
      }
      send(404, {
        ok: false,
        error: "未知接口",
        endpoints: [
          "GET /api/status",
          "GET /api/datasets",
          "GET /api/manifest",
          "POST /api/sync?datasets=&full=",
          "GET /api/tiku/labels?prefix=",
          "GET /api/tiku/papers?prefix=&labelId=&page=&pageSize=",
          "GET /api/tiku/paper?prefix=&paperId=",
          "GET /api/tiku/paper-sheet?prefix=&paperId=",
          "GET /api/tiku/questions?prefix=&ids=",
          "GET /api/tiku/question-meta?prefix=&ids=",
          "GET /api/naoku/status",
          "POST /api/naoku/import",
          "POST /api/naoku/index",
          "GET /api/naoku/search?type=&q=&模块=&大类=&地区=&年份=&考点=&limit=",
          "GET /api/naoku/note?path=",
          "GET /api/naoku/for-question?qid=",
          "GET /api/naoku/points?模块=&大类=&limit=",
        ],
      });
    } catch (error) {
      send(500, { ok: false, error: String(error?.message ?? error) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
