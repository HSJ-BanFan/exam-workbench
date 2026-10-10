#!/usr/bin/env node
// exam-workbench MCP server（stdio，零依赖）：把工作台的 HTTP 能力投影为 MCP tools/prompts/resources。
// MCP 客户端配置示例：
//   { "command": "node", "args": ["<repo>/mcp/server.mjs"], "env": { "WORKBENCH_PORT": "8791" } }
// 环境变量：WORKBENCH_BASE_URL（优先）、WORKBENCH_PORT（默认 8791）、WORKBENCH_TOKEN（应用设置了接口令牌时必填）。
// 注意：工作台应用需要在运行；应用未启动时工具会返回明确的错误提示。

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import {
  CAPABILITIES,
  AGENT_SKILLS,
  AGENT_SURFACE_SCHEMA,
  readAgentSkill,
  toolName,
  capabilityByToolName,
} from "../src/agent-surface.mjs";

const BASE = process.env.WORKBENCH_BASE_URL ?? `http://127.0.0.1:${process.env.WORKBENCH_PORT ?? "8791"}`;
const TOKEN = process.env.WORKBENCH_TOKEN ?? "";
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const SKILL_BODIES = new Map(AGENT_SKILLS.map((s) => [s.id, readAgentSkill(s.id) ?? ""]));

function authHeaders(extra = {}) {
  return TOKEN ? { ...extra, "x-sync-token": TOKEN } : extra;
}

async function invokeCapability(c, args = {}) {
  const url = new URL(c.path, BASE);
  const init = { method: c.method, headers: authHeaders({ accept: "application/json" }) };
  if (c.method === "GET") {
    for (const key of Object.keys(c.params?.properties ?? {})) {
      const value = args[key];
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  } else {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args ?? {});
  }
  const timeout = c.kind === "maintenance" ? 30 * 60 * 1000 : 60 * 1000;
  init.signal = AbortSignal.timeout(timeout);
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const offlineHint = `工作台不可达。请确认「备考工作台」正在运行（GET ${BASE}/api/status 应返回 JSON）。`;

function toolResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function callTool(name, args) {
  const capability = capabilityByToolName(name);
  if (!capability) return toolResult(`未知工具：${name}`, true);
  try {
    const { status, body } = await invokeCapability(capability, args);
    const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    const businessFail = body && typeof body === "object" && body.ok === false;
    return toolResult(text, status >= 400 || businessFail);
  } catch (error) {
    return toolResult(`${offlineHint}\n原因：${error?.message ?? error}`, true);
  }
}

function toolsList() {
  return CAPABILITIES.map((c) => ({
    name: toolName(c),
    description: [
      c.summary,
      `类别：${c.kind}${c.readonly ? "（只读）" : "（会写本地输出目录或长任务）"}`,
      c.requires.length ? `前置：${c.requires.join("、")}` : null,
      `HTTP：${c.method} ${c.path}`,
      c.skill ? `技能：${c.skill}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    inputSchema: c.params ?? { type: "object", properties: {} },
  }));
}

function promptsList() {
  return AGENT_SKILLS.map((s) => ({
    name: s.id,
    description: `${s.summary} 何时用：${s.when}`,
  }));
}

function resourcesList() {
  return [
    ...AGENT_SKILLS.map((s) => ({
      uri: `workbench://skills/${s.id}`,
      name: `技能：${s.title}`,
      mimeType: "text/markdown",
    })),
    { uri: "workbench://status", name: "工作台状态", mimeType: "application/json" },
    { uri: "workbench://manifest", name: "粉笔输出清单", mimeType: "application/json" },
    { uri: "workbench://saduck/manifest", name: "SaDuck 输出清单", mimeType: "application/json" },
  ];
}

async function readResource(uri) {
  if (uri.startsWith("workbench://skills/")) {
    const id = uri.slice("workbench://skills/".length);
    const body = SKILL_BODIES.get(id);
    if (body === undefined) throw Object.assign(new Error(`未知技能：${id}`), { code: -32602 });
    return [{ uri, mimeType: "text/markdown", text: body }];
  }
  const map = {
    "workbench://status": "app.status",
    "workbench://manifest": "app.manifest",
    "workbench://saduck/manifest": "saduck.manifest",
  };
  const capabilityId = map[uri];
  if (!capabilityId) throw Object.assign(new Error(`未知资源：${uri}`), { code: -32602 });
  const capability = CAPABILITIES.find((c) => c.id === capabilityId);
  try {
    const { body } = await invokeCapability(capability);
    return [{ uri, mimeType: "application/json", text: JSON.stringify(body, null, 2) }];
  } catch (error) {
    throw Object.assign(new Error(`${offlineHint}\n原因：${error?.message ?? error}`), { code: -32002 });
  }
}

async function dispatch(method, params) {
  switch (method) {
    case "initialize": {
      const requested =
        typeof params?.protocolVersion === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.protocolVersion)
          ? params.protocolVersion
          : "2024-11-05";
      return {
        protocolVersion: requested,
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
        serverInfo: { name: "exam-workbench", version: VERSION },
        instructions:
          "备考工作台（本机 127.0.0.1）能力面。先看 tools 列表；每个工具的说明里有前置条件与是否只读。" +
          "需要完整用法时用 prompts/get 取对应技能原文。工作台应用需要在运行，否则工具返回离线提示。",
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolsList() };
    case "tools/call":
      return callTool(params?.name, params?.arguments ?? {});
    case "prompts/list":
      return { prompts: promptsList() };
    case "prompts/get": {
      const id = params?.name;
      const skill = AGENT_SKILLS.find((s) => s.id === id);
      if (!skill) throw Object.assign(new Error(`未知技能：${id}`), { code: -32602 });
      return {
        description: `${skill.summary} 何时用：${skill.when}`,
        messages: [
          {
            role: "user",
            content: { type: "text", text: `# ${skill.title}\n\n${SKILL_BODIES.get(skill.id) ?? ""}` },
          },
        ],
      };
    }
    case "resources/list":
      return { resources: resourcesList() };
    case "resources/read":
      return { contents: await readResource(params?.uri) };
    default:
      throw Object.assign(new Error(`未支持的方法：${method}（surface schema ${AGENT_SURFACE_SCHEMA}）`), {
        code: -32601,
      });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message.id === undefined || message.id === null) return; // 通知，忽略
  try {
    const result = await dispatch(message.method, message.params ?? {});
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: error?.code ?? -32603, message: String(error?.message ?? error) },
      })}\n`
    );
  }
});
