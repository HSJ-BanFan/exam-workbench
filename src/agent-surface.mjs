// Agent Surface（能力发现层）：应用对外契约的单一事实源。
// 这里登记能力清单（HTTP 路由 + 参数 + 语义）与技能文档索引；
// GET /api/agent 与 mcp/server.mjs 都从这里生成，避免多处手写漂移。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_SURFACE_SCHEMA = 1;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, "..", "skills");

const cap = (entry) => ({
  kind: "query",
  method: "GET",
  readonly: true,
  requires: [],
  skill: null,
  params: { type: "object", properties: {} },
  ...entry,
});

export const CAPABILITIES = [
  // ---------------------------------------------------------------- app
  cap({
    id: "app.status",
    source: "app",
    title: "工作台状态",
    summary: "同步运行状态、登录态、输出目录、接口地址与最近同步时间。",
    path: "/api/status",
    returns: "状态对象（ok、running、hasSession、hasSaduckSession、dataDir、saduckDir 等）。",
    skill: "sync-and-status",
  }),
  cap({
    id: "app.datasets",
    source: "app",
    title: "粉笔数据集目录",
    summary: "粉笔侧可同步数据集及当前勾选状态。",
    path: "/api/datasets",
    returns: "{ ok, datasets: [{ id, title, enabled, ... }] }。",
    skill: "sync-and-status",
  }),
  cap({
    id: "app.manifest",
    source: "app",
    title: "粉笔输出目录清单",
    summary: "粉笔输出目录的 manifest（本次运行 + 现存文件清单）。",
    path: "/api/manifest",
    allowMissing: true,
    returns: "manifest 对象；从未同步过时返回 404。",
    skill: "sync-and-status",
  }),
  cap({
    id: "app.sync",
    source: "app",
    title: "触发粉笔同步",
    summary: "触发一次粉笔数据同步（只读上游接口，写入本地输出目录）。",
    method: "POST",
    path: "/api/sync",
    kind: "action",
    readonly: false,
    requires: ["fenbi.login"],
    params: {
      type: "object",
      properties: {
        datasets: { type: "array", items: { type: "string" }, description: "数据集 id 列表；省略时用应用内勾选" },
        full: { type: "boolean", description: "全量刷新（重新拉取全部题解），默认 false" },
      },
    },
    returns: "{ ok, datasets: { id: { title, items, files } }, warnings }。",
    skill: "sync-and-status",
  }),

  // ---------------------------------------------------------------- fenbi（题库只读）
  cap({
    id: "fenbi.labels",
    source: "fenbi",
    title: "题库分类树",
    summary: "行测/申论题库的分类树，用于挑选 labelId。",
    path: "/api/tiku/labels",
    requires: ["fenbi.login"],
    params: {
      type: "object",
      properties: {
        prefix: { type: "string", enum: ["xingce", "shenlun"], default: "xingce" },
      },
    },
    returns: "{ ok, prefix, data: 分类节点数组 }。",
    skill: "tiku-lookup",
  }),
  cap({
    id: "fenbi.papers",
    source: "fenbi",
    title: "试卷列表",
    summary: "按分类浏览试卷列表。",
    path: "/api/tiku/papers",
    requires: ["fenbi.login"],
    params: {
      type: "object",
      properties: {
        prefix: { type: "string", enum: ["xingce", "shenlun"], default: "xingce" },
        labelId: { type: "number", description: "分类 id（来自 labels）" },
        page: { type: "number", default: 0 },
        pageSize: { type: "number", description: "1-20，默认 15" },
      },
    },
    returns: "{ ok, data: { list, pageInfo } }。",
    skill: "tiku-lookup",
  }),
  cap({
    id: "fenbi.paper",
    source: "fenbi",
    title: "试卷详情",
    summary: "单份试卷的详情（元信息）。",
    path: "/api/tiku/paper",
    requires: ["fenbi.login"],
    params: {
      type: "object",
      properties: {
        prefix: { type: "string", enum: ["xingce", "shenlun"], default: "xingce" },
        paperId: { type: "number" },
      },
      required: ["paperId"],
    },
    returns: "{ ok, data }。",
    skill: "tiku-lookup",
  }),
  cap({
    id: "fenbi.paper-sheet",
    source: "fenbi",
    title: "试卷结构",
    summary: "试卷的题目清单（questionIds），用于后续按题号取题。",
    path: "/api/tiku/paper-sheet",
    requires: ["fenbi.login"],
    params: {
      type: "object",
      properties: {
        prefix: { type: "string", enum: ["xingce", "shenlun"], default: "xingce" },
        paperId: { type: "number" },
      },
      required: ["paperId"],
    },
    returns: "{ ok, data: { questionIds: [...] } }。",
    skill: "tiku-lookup",
  }),
  cap({
    id: "fenbi.questions",
    source: "fenbi",
    title: "按题号取题",
    summary: "按题目 id 批量取题干/选项/正确答案。",
    path: "/api/tiku/questions",
    requires: ["fenbi.login"],
    params: {
      type: "object",
      properties: {
        prefix: { type: "string", enum: ["xingce", "shenlun"], default: "xingce" },
        ids: { type: "string", description: "逗号分隔的题目 id，最多 20 个" },
      },
      required: ["ids"],
    },
    returns: "{ ok, data: [...] }。",
    skill: "tiku-lookup",
  }),
  cap({
    id: "fenbi.question-meta",
    source: "fenbi",
    title: "题目元数据",
    summary: "全站正确率与易错项（难度校准用）。",
    path: "/api/tiku/question-meta",
    requires: ["fenbi.login"],
    params: {
      type: "object",
      properties: {
        prefix: { type: "string", enum: ["xingce", "shenlun"], default: "xingce" },
        ids: { type: "string", description: "逗号分隔的题目 id，最多 50 个" },
      },
      required: ["ids"],
    },
    returns: "{ ok, data: [...] }。",
    skill: "tiku-lookup",
  }),
  cap({
    id: "fenbi.shenlun-solutions",
    source: "fenbi",
    title: "申论参考答案",
    summary: "按题目 id 取申论答案原文（仅本人做过的题可用）。",
    path: "/api/tiku/shenlun-solutions",
    requires: ["fenbi.login"],
    params: {
      type: "object",
      properties: {
        ids: { type: "string", description: "逗号分隔的题目 id，最多 10 个" },
      },
      required: ["ids"],
    },
    returns: "{ ok, text }。",
    skill: "tiku-lookup",
  }),

  // ---------------------------------------------------------------- naoku
  cap({
    id: "naoku.status",
    source: "naoku",
    title: "脑库状态",
    summary: "脑库副本路径、索引计数与警告。",
    path: "/api/naoku/status",
    returns: "{ ok, vaultDir, imported, indexed, counts, warnings }。",
    skill: "naoku-attribution",
  }),
  cap({
    id: "naoku.import",
    source: "naoku",
    title: "导入脑库副本",
    summary: "稀疏克隆/更新脑库副本（长任务，可能需要几分钟）。",
    method: "POST",
    path: "/api/naoku/import",
    kind: "maintenance",
    readonly: false,
    returns: "{ ok, dir, commit }。",
    skill: "naoku-attribution",
  }),
  cap({
    id: "naoku.index",
    source: "naoku",
    title: "重建脑库索引",
    summary: "扫描脑库副本并重建索引（长任务）。",
    method: "POST",
    path: "/api/naoku/index",
    kind: "maintenance",
    readonly: false,
    requires: ["naoku.imported"],
    returns: "{ ok, counts, warnings }。",
    skill: "naoku-attribution",
  }),
  cap({
    id: "naoku.tree",
    source: "naoku",
    title: "脑库考点树",
    summary: "按模块/大类聚合的考点与真题数量。",
    path: "/api/naoku/tree",
    requires: ["naoku.indexed"],
    returns: "{ ok, 模块: [...], counts }。",
    skill: "naoku-attribution",
  }),
  cap({
    id: "naoku.wrong-hits",
    source: "naoku",
    title: "错题命中脑库",
    summary: "把粉笔错题本（已同步）与脑库索引对碰，列出有标注的错题。",
    path: "/api/naoku/wrong-hits",
    requires: ["naoku.indexed", "fenbi.wrong-synced"],
    returns: "{ ok, total, hitCount, hits }。",
    skill: "naoku-attribution",
  }),
  cap({
    id: "naoku.search",
    source: "naoku",
    title: "脑库检索",
    summary: "按模块/大类/地区/年份/考点检索真题、考点或材料索引。",
    path: "/api/naoku/search",
    requires: ["naoku.indexed"],
    params: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["真题", "考点", "材料"], default: "真题" },
        q: { type: "string" },
        模块: { type: "string" },
        大类: { type: "string" },
        地区: { type: "string" },
        年份: { type: "string" },
        考点: { type: "string" },
        limit: { type: "number", description: "≤200" },
      },
    },
    returns: "{ ok, items, limit }。",
    skill: "naoku-attribution",
  }),
  cap({
    id: "naoku.note",
    source: "naoku",
    title: "读脑库笔记",
    summary: "按相对路径读取脑库笔记正文（真题/考点/材料）。",
    path: "/api/naoku/note",
    requires: ["naoku.imported"],
    params: {
      type: "object",
      properties: { path: { type: "string", description: "脑库内相对路径" } },
      required: ["path"],
    },
    returns: "{ ok, path, text }。",
    skill: "naoku-attribution",
  }),
  cap({
    id: "naoku.for-question",
    source: "naoku",
    title: "题号查标注",
    summary: "按粉笔题号返回考点、材料、相关题与母题摘要。",
    path: "/api/naoku/for-question",
    requires: ["naoku.indexed"],
    params: {
      type: "object",
      properties: { qid: { type: "string", description: "粉笔题号" } },
      required: ["qid"],
    },
    returns: "{ ok, qid, 考点, path, 摘要, 相关题 }。",
    skill: "naoku-attribution",
  }),
  cap({
    id: "naoku.points",
    source: "naoku",
    title: "考点列表",
    summary: "按模块/大类列考点，可按题数排序。",
    path: "/api/naoku/points",
    requires: ["naoku.indexed"],
    params: {
      type: "object",
      properties: {
        模块: { type: "string" },
        大类: { type: "string" },
        sort: { type: "string", enum: ["题数"] },
        limit: { type: "number" },
      },
    },
    returns: "{ ok, items }。",
    skill: "naoku-attribution",
  }),

  // ---------------------------------------------------------------- saduck
  cap({
    id: "saduck.status",
    source: "saduck",
    title: "SaDuck 状态",
    summary: "SaDuck 登录/会员状态、输出目录、最近同步时间。",
    path: "/api/saduck/status",
    returns: "{ ok, loggedIn, account: { emailMasked, vipType, vipEndTime }, dir }。",
    skill: "saduck-data",
  }),
  cap({
    id: "saduck.datasets",
    source: "saduck",
    title: "SaDuck 数据集目录",
    summary: "SaDuck 侧可同步数据集（8 项，7 项默认）。",
    path: "/api/saduck/datasets",
    returns: "{ ok, datasets: [{ id, name, default, description }] }。",
    skill: "saduck-data",
  }),
  cap({
    id: "saduck.data",
    source: "saduck",
    title: "实时读取 SaDuck 数据集",
    summary: "从 saduck.top 实时读取一个本人数据集（不落盘）。",
    path: "/api/saduck/data",
    requires: ["saduck.login"],
    params: {
      type: "object",
      properties: {
        dataset: {
          type: "string",
          enum: ["time", "plan", "words", "read", "sl", "wrong", "tklog", "bxcy"],
          description: "数据集 id（bxcy 为站点练习内容，默认不导出）",
        },
      },
      required: ["dataset"],
    },
    returns: "{ ok, dataset, name, data }。",
    skill: "saduck-data",
  }),
  cap({
    id: "saduck.sync",
    source: "saduck",
    title: "触发 SaDuck 同步",
    summary: "把本人 SaDuck 数据只读同步到 SaDuck 输出目录。",
    method: "POST",
    path: "/api/saduck/sync",
    kind: "action",
    readonly: false,
    requires: ["saduck.login"],
    params: {
      type: "object",
      properties: {
        datasets: { type: "array", items: { type: "string" }, description: "数据集 id 列表；省略时用默认 7 项" },
      },
    },
    returns: "HTTP 200 返回 { ok: true, outDir, datasets: { id: { title, items, status } } }。HTTP 409 返回 { ok: false, error }。已运行同步时还包含 outDir、datasets 和 manifest。",
    skill: "saduck-data",
  }),
  cap({
    id: "saduck.manifest",
    source: "saduck",
    title: "SaDuck 输出清单",
    summary: "SaDuck 输出目录的 manifest。",
    path: "/api/saduck/manifest",
    allowMissing: true,
    returns: "{ ok, manifest }；从未同步过时返回 404。",
    skill: "saduck-data",
  }),
];

export const AGENT_SKILLS = [
  {
    id: "sync-and-status",
    title: "同步与状态",
    summary: "粉笔与 SaDuck 的数据同步流程、登录前置与状态检查。",
    when: "用户要同步数据、问最近同步情况，或分析前需要确认登录与数据新鲜度时。",
    file: "sync-and-status.md",
  },
  {
    id: "tiku-lookup",
    title: "题库查询",
    summary: "按分类/试卷/题号查询粉笔题库（只读，含限额）。",
    when: "需要查看题库目录、找卷子、按题号取题干或全站正确率时。",
    file: "tiku-lookup.md",
  },
  {
    id: "naoku-attribution",
    title: "脑库归因",
    summary: "把错题按题号连到脑库的考点、材料与母题。",
    when: "做错因归类、考点级统计、或想知道某题属于哪个考点/母题时。",
    file: "naoku-attribution.md",
  },
  {
    id: "saduck-data",
    title: "SaDuck 数据",
    summary: "SaDuck 数据集语义、会员限制与读取方式。",
    when: "用户要 SaDuck 侧的学习数据（计时/打卡/生词/错题/申论记录）时。",
    file: "saduck-data.md",
  },
  {
    id: "outputs-and-privacy",
    title: "输出目录与隐私",
    summary: "输出目录的使用规则、可写范围与脱敏边界。",
    when: "要写分析产物、移动/引用输出目录文件，或涉及隐私边界时。",
    file: "outputs-and-privacy.md",
  },
];

export function readAgentSkill(id) {
  const skill = AGENT_SKILLS.find((s) => s.id === id);
  if (!skill) return null;
  try {
    return fs.readFileSync(path.join(SKILLS_DIR, skill.file), "utf8");
  } catch {
    return null;
  }
}

// MCP 工具名约束（部分客户端只接受 [a-zA-Z0-9_-]）。
export function toolName(capability) {
  return capability.id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function capabilityByToolName(name) {
  return CAPABILITIES.find((c) => toolName(c) === name) ?? null;
}

function validateSurface() {
  const ids = new Set();
  const routes = new Set();
  for (const c of CAPABILITIES) {
    if (ids.has(c.id)) throw new Error(`agent-surface: 能力 id 重复：${c.id}`);
    ids.add(c.id);
    const route = `${c.method} ${c.path}`;
    if (routes.has(route)) throw new Error(`agent-surface: 路由重复：${route}`);
    routes.add(route);
  }
  const skillIds = new Set();
  for (const s of AGENT_SKILLS) {
    if (skillIds.has(s.id)) throw new Error(`agent-surface: 技能 id 重复：${s.id}`);
    skillIds.add(s.id);
    if (!readAgentSkill(s.id)) throw new Error(`agent-surface: 技能文件缺失：${s.file}`);
  }
}

export function buildAgentManifest({ baseUrl, version, state = null }) {
  validateSurface();
  return {
    schema: AGENT_SURFACE_SCHEMA,
    app: "exam-workbench",
    version,
    baseUrl,
    auth: {
      header: "X-Sync-Token",
      required: false,
      note: "仅当应用设置里配置了接口令牌时必带。",
    },
    quickstart: [
      "GET /api/agent —— 能力清单与技能索引（本接口）",
      "GET /api/status —— 当前状态（登录/同步）",
      "GET /api/agent/skills/<id> —— 取技能原文（Markdown）",
      "查询类用 GET，动作类（sync/import/index）用 POST；readonly=false 的能力会写本地输出目录。",
    ],
    capabilities: CAPABILITIES.map((c) => ({
      ...c,
      call: `${c.method} ${baseUrl}${c.path}`,
    })),
    skills: AGENT_SKILLS.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      when: s.when,
      url: `/api/agent/skills/${s.id}`,
    })),
    state,
    generatedAt: new Date().toISOString(),
  };
}
