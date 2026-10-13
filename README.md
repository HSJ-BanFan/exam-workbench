# 备考工作台（exam-workbench）

> 非官方 · 本地优先：把「刷题 → 数据同步 → AI 复盘」串成一条流水线。

![备考工作台：刷题与错题聚类（手绘）](assets/hero.jpg)

把粉笔网页端装进一个桌面应用里刷题，并把**本人账号**的练习数据（练习/试卷/错题/申论/能力报告/模考）
**只读同步**到本地目录（Markdown + JSON，Obsidian 友好），同时通过本机 HTTP 接口提供给
Codex / Claude 等 AI agent 做聚类分析与复盘。

应用内同时内置 **SaDuck 公考知识库**页面，并把本人 SaDuck 学习数据（计时/打卡/生词/错题等）以同样方式只读同步。

*An unofficial Electron (webview) workbench: practice in-app, read-only sync your own practice
data to local Markdown/JSON, and expose a localhost API for AI agents to analyze and cluster
your mistakes.*

## 功能

- **Webview 刷题**：独立应用窗口内嵌题库，登录态持久化，接近原生的刷题体验
- **SaDuck 知识库页**：应用内打开 saduck.top（独立登录态持久化），一键「同步我的数据」；8 个 SaDuck 数据集（7 个默认）
- **Agent 发现接口**：`GET /api/agent` 一次返回能力清单 + 技能索引；配套 stdio MCP server，agent 直接发现 tools/prompts/resources
- **只读数据同步**：9 个粉笔数据集（练习记录 / 题解与逐题作答 / 错题本快照 / 能力报告 /
  笔记与收藏 / 模考记录 / 申论练习记录 / 申论作答与批改 / 可选题目元数据），增量缓存
- **第三方标注库里层**：接入开源「考公脑库」（资料分析 / 判断推理），把本人做过的题按粉笔题号连到
  考点、材料与相关题；只建索引，不分发其内容
- **AI 友好输出**：带 frontmatter 的 Markdown + 机器可读 JSON；输出目录可配置（例如你的学习库）
- **本机 HTTP 接口**：同步接口 + 只读题库接口（分类/试卷/题目/全站正确率）+ SaDuck 接口（状态/数据集/实时读取/同步），供 agent 调用
- **无窗口模式**：`--sync-only` 静默同步并退出，适合接入定时复盘工作流

## 明确的边界

- 只调用**读取**接口：不提交答案、不删除错题、不发布任何内容
- 仓库与导出不含登录凭据；输出前脱敏账号字段（手机号等）
- HTTP 接口仅在 `127.0.0.1` 监听；不提供批量导出题库的功能
- 未练习过的题目内容（尤其申论材料/参考答案）受平台权限限制，取不到就不取

## 快速开始

环境：Node.js ≥ 22.12（开发，`@electron/packager` 的要求）；运行打包版只需要 Windows。

```powershell
npm install
npm start        # 开发运行
npm run pack     # 打包到 dist/（免安装目录）
```

首次使用：

1. 「刷题」页登录粉笔账号（扫码/验证码，登录态保存在本机应用数据目录）
2. 「SaDuck」页登录 saduck.top；也可把 saduck-cli 的 `session.json` 复制为
   `%APPDATA%\备考工作台\saduck-session.json`，应用会在未登录时自动导入一次
3. 「数据同步」页确认粉笔数据集 → 点「立即同步」（或到「SaDuck」页点「同步我的数据」）
4. 「设置」里指定输出目录（可选；SaDuck 目录默认与粉笔目录同级）

无窗口同步（自动化友好，输出 JSON，退出码 0/1）：

```powershell
& "dist\exam-workbench-win32-x64\exam-workbench.exe" --sync-only
```

## 输出目录

```
<输出目录>/
├── manifest.json        # 机器索引：lastRun（本次运行）+ contents（现存文件清单）
├── 00-说明.md
├── 状态/同步状态.md
├── 练习记录/            # 练习历史（「练习」+「试卷」两个入口合并去重）
├── 题解/                # 每场已完成练习的逐题明细（题干/我的答案/正确答案/解析/知识点/计时）
├── 错题本/              # 错题快照（按知识点聚合、去重）
├── 能力报告/            # 官方预测分/排名/模块正确率/趋势
├── 笔记与收藏/          # 本人笔记与收藏
├── 模考记录/            # 模考大赛完成记录
├── 申论练习记录/        # 申论历史与批改额度
├── 申论作答与批改/      # 申论题目/详情/批改报告（有数据时产出）
├── 题目元数据/          # 可选：全站正确率/易错项（默认关闭）
└── 脑库索引/            # 第三方标注库的连接索引（真题/考点/材料，由 naoku 导入后生成）
```

所有 Markdown 带 frontmatter（`type: generated / sample: false`），可以直接放进 Obsidian 库。

SaDuck 的输出写在同一层级的 `SaDuck同步/` 目录（结构一致：每个数据集一个子目录 + `manifest.json` + `状态/同步状态.md`，
可在「设置」中单独指定）。

## SaDuck 集成（v0.2.0）

左侧「SaDuck」页内嵌 saduck.top（`persist:saduck` 独立登录态）：

- 应用内直接使用 SaDuck 的知识库与工具（题库、每月时政、词语工具等）；
- 点「同步我的数据」把本人账号的学习数据只读同步到 `SaDuck同步/`：
  计时记录 / 每日打卡 / 生词锦囊 / 晨读收藏 / 申论练习记录 / 错题列表 / 行测练习记录；
  词语辨析练习组属站点内容，默认不同步；
- 「设置」中可修改 SaDuck 输出目录；token 不进入输出目录（只存在应用会话与引导文件）。

已在本地实测（2026-10-10）：开发版与打包版 `--self-test` 均 PASS；`scripts/api-test.mjs` 全绿（含 SaDuck 断言）；
输出目录通过考公库 `vault check`（0 错误 0 警告）。

### 数据集与初始推荐

| 数据集 | 初始推荐 | 内容 | 给 agent 的用途 |
|---|---|---|---|
| 练习记录 | ✅ | 练习历史索引（时间/题数/对题/难度） | 进度时间线、挑复盘场次 |
| 题解与逐题作答 | ✅ | 题干/选项/我的答案/正确答案/解析/知识点/计时 | 错因归类、知识聚类 |
| 错题本快照 | ✅ | 错题按知识点聚合（去重，含解析） | 复习队列、薄弱点排序 |
| 能力报告 | ✅ | 官方预测分/排名/模块正确率/趋势 | 阶段对比、优先级 |
| 笔记与收藏 | ✅ | 本人笔记/收藏清单 | 高优先级复习集合 |
| 模考记录 | ✅ | 模考大赛完成记录（可能为空） | 实战成绩/排名变化 |
| 申论练习记录 | ✅ | 申论历史 + 批改额度（可能为空） | 申论进度与额度追踪 |
| 申论作答与批改 | ✅ | 每场申论的题目/详情/批改报告（有数据时产出） | 申论逐题复盘 |
| 题目元数据 | ⬜ 可选 | 全站正确率/易错项 | 难度校准（普遍难 vs 个别弱） |
| 考公脑库索引 | ✅ | 第三方标注库的索引：题号 → 考点/材料/相关题 + 母题摘要（不含题面原文） | 考点级归因、同类题推荐 |

## 考公脑库（第三方标注库）

[考公脑库](https://github.com/ERRRC/kaogongzhentizhengliu) 是一个 Obsidian vault，把 2016–2026 年行测真题
按考点重新组织，只覆盖「资料分析」和「判断推理」两个模块。本应用把它当作**标注层**：你继续用粉笔的
题面和本人练习数据，脑库只补上「这道题属于哪个考点、同考点的其他题、材料结构、母题抽象」。

导入（不需要登录粉笔；副本默认放在**应用数据目录**下的 `考公脑库`，即
`%APPDATA%\备考工作台\考公脑库`）：

```powershell
# 无窗口导入 + 重建索引；也可用 POST /api/naoku/import 与 /api/naoku/index
exam-workbench.exe --naoku-import
```

导入用稀疏克隆（`--depth 1 --filter=blob:none --sparse`），**默认排除 `90-图片`**（21,829 张第三方
配图，约 207MB）。索引写在 `脑库索引/`，只含连接关系与考点母题摘要（截断到 300 字符），不含题面原文；
题面仍用 `/api/tiku/questions` 按题号取。
已有副本更新前会检查工作树改动、Git 索引保护标记、提交历史和被忽略文件是否与远端路径冲突；发现本地内容风险会取消更新并保留本地文件与提交。落后于已跟踪远端的干净副本仍可继续更新。

副本刻意不放进数据目录：数据目录通常位于 Obsidian 库内，而脑库是 2 万余篇外来笔记，落进去会污染库图谱，
并让库校验器把每篇都判为 `type 无效`。要换位置就改 `%APPDATA%\备考工作台\config.json` 里的 `naokuDir`
（应用设置页目前没有该字段），指向已有副本即可。想用 Obsidian 浏览脑库，把它单独作为一个仓库打开；
若一定要放进库里，在 Obsidian 的忽略过滤器里排除该目录，并同步调整你的库校验脚本。

许可边界：脑库自有部分（考点体系与逐题标注）是 **CC BY-NC 4.0（非商业）**，题面/材料/图片的著作权归
原出题机构与题库平台。本项目不打包、不再分发任何第三方内容，只在你本机克隆并生成索引，请勿把数据目录
（含索引与本人作答）公开分享。细节见 [`docs/数据来源与许可.md`](docs/数据来源与许可.md)。

## 本机接口（默认 `http://127.0.0.1:8791`）

| 接口 | 说明 |
|---|---|
| `GET /api/agent` | 能力清单 + 技能索引（发现入口） |
| `GET /api/agent/skills/<id>` | 技能原文（Markdown） |
| `GET /api/status` / `GET /api/datasets` / `GET /api/manifest` | 同步状态 / 数据集 / 输出清单 |
| `POST /api/sync[?datasets=history,wrong&full=1]` | 触发一次同步并返回摘要 |
| `GET /api/tiku/labels?prefix=xingce\|shenlun` | 题库分类树 |
| `GET /api/tiku/papers?prefix=&labelId=&page=&pageSize=` | 试卷列表（pageSize ≤ 20） |
| `GET /api/tiku/paper?prefix=&paperId=` / `paper-sheet?...` | 试卷详情 / 结构（含 questionIds） |
| `GET /api/tiku/questions?prefix=&ids=` | 按题目 ID 取题干/选项/正确答案（ids ≤ 20） |
| `GET /api/tiku/question-meta?prefix=&ids=` | 全站正确率 / 易错项（ids ≤ 50） |
| `GET /api/naoku/status` `POST /api/naoku/import` `POST /api/naoku/index` | 脑库副本与索引状态 / 导入 / 重建索引 |
| `GET /api/naoku/search?type=&q=&模块=&大类=&地区=&年份=&考点=&limit=` | 检索索引（limit ≤ 200） |
| `GET /api/naoku/for-question?qid=` | 按题号取考点/材料/相关题 |
| `GET /api/naoku/note?path=` `GET /api/naoku/points?模块=&大类=` | 读脑库笔记正文 / 考点列表 |
| `GET /api/saduck/status` | SaDuck 登录/会员状态、输出目录、最近同步 |
| `GET /api/saduck/datasets` | SaDuck 数据集目录（8 项，7 项默认） |
| `GET /api/saduck/data?dataset=time` | 实时读取一个数据集（JSON；需应用内 SaDuck 登录） |
| `POST /api/saduck/sync[?datasets=time,plan]` | 触发 SaDuck 同步并返回摘要 |
| `GET /api/saduck/manifest` | SaDuck 输出目录清单 |

「设置」中可修改端口与访问令牌（设置后请求需带 `X-Sync-Token` 头）。
完整接口参考（含逆向说明与边界）：[`docs/api.md`](docs/api.md)。

```powershell
Invoke-RestMethod http://127.0.0.1:8791/api/status
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8791/api/sync"
Invoke-RestMethod "http://127.0.0.1:8791/api/tiku/papers?labelId=1&pageSize=5"
```

## Agent 接入（发现接口 + MCP）

应用自己描述自己，agent 不需要在应用外手写规则来猜测能力：

- `GET /api/agent` 一次返回：能力清单（每条含 HTTP 路由、参数 JSON Schema、前置条件、是否只读、示例）、
  技能索引，以及当前状态（登录/同步）。
- `GET /api/agent/skills/<id>` 返回技能原文（Markdown）。技能共 5 篇：同步与状态 / 题库查询 / 脑库归因 /
  SaDuck 数据 / 输出目录与隐私。
- 单一事实源在 `src/agent-surface.mjs`；HTTP 出口与 MCP 出口都从它生成，避免文档漂移。

MCP（stdio，零依赖）。建议注册为**项目级**配置，不要加全局：

Codex（项目根 `.codex/config.toml`）：

```toml
[mcp_servers.exam-workbench]
command = 'D:\02_Dev\Tools\nodejs\node.exe'
args = ['<path-to-repo>/mcp/server.mjs']
env = { WORKBENCH_PORT = "8791" }
```

Claude Code（项目根 `.mcp.json`）：

```json
{
  "mcpServers": {
    "exam-workbench": {
      "command": "D:\\02_Dev\\Tools\\nodejs\\node.exe",
      "args": ["<path-to-repo>/mcp/server.mjs"],
      "env": { "WORKBENCH_PORT": "8791" }
    }
  }
}
```

- tools 25 个（与能力清单一一对应）、prompts 5 个（技能原文）、resources（状态 + 两个 manifest）。
- 应用未运行时工具返回明确的离线提示（不会自动拉起应用）；接口令牌通过 `WORKBENCH_TOKEN` 传入。
- 本机实例：考公库 `D:\05_Life\Documents\ChatGPT\考公` 已按上述两种形式注册（仅对该项目生效）。

## 与 AI agent 一起工作（示例工作流）

1. 白天刷题（手机 App 或本应用都行，同一账号数据互通）
2. 触发同步（应用按钮 / `POST /api/sync` / `--sync-only`）
3. 让 Codex / Claude 读输出目录：错题聚类、错误模式归纳、复习优先级
4. 进阶：每晚定时任务先 `--sync-only` 再自动复盘，把结果写回学习库

## 开发与验证

```powershell
npm start                       # 开发运行
npm run pack                    # 打包
npm run test:naoku-import      # 合成本地 Git 远端回归测试，不访问真实数据或网络
node scripts/dev-sync-test.mjs  # 不用 UI 直接跑同步引擎（SESSION_PATH 指向会话文件）
node scripts/api-test.mjs       # 启动应用并自动化测试 HTTP 接口（含 /api/agent 与 MCP 冒烟）
node scripts/naoku-test.mjs     # 脑库索引自测（合成 fixture；带 NAOKU_VAULT=<路径> 时对真实副本再跑一遍）
node scripts/probe.mjs "/api/xingce/errors/keypoint-tree?timeRange=0&order=desc"
npx electron . --self-test      # 全链路自测：导入会话 → 粉笔同步 → SaDuck 同步 → 截图 → 退出
npx electron . --naoku-import   # 无窗口导入脑库副本并重建索引
```

## 构建与发布（GitHub Actions）

仓库自带 [`.github/workflows/build.yml`](.github/workflows/build.yml)，在 windows runner 上自动构建便携版：

- **PR / push**：每次提交自动构建并上传构建产物（Actions 运行页可下载 zip）
- **合并到 main**：自动更新预发布 [`main-latest`](https://github.com/HSJ-BanFan/exam-workbench/releases/tag/main-latest)，始终可下载最新的开发版
- **推送 `v*` 标签**：发布正式 Release 并附带 zip（要求标签与 `package.json` 的 `version` 一致）

发正式版：改 `package.json` 的 `version` → 合并到 main → `git tag vX.Y.Z && git push origin vX.Y.Z`。

## 隐私与合规（重要）

- **凭据本地**：`sess/persistent` 等 Cookie 只存在于本机应用会话目录；仓库与导出中不含凭据
- **个人数据**：导出包含你本人的作答与错题（手机号等已脱敏）；请勿公开分享你的输出目录
- **SaDuck**：只读；token 不入输出目录；导出仅本人数据，站点正文内容（词库/试卷/晨读正文）不导出
- **平台内容**：题目与解析的版权归平台所有；本项目不内置、不打包任何题库内容，只在你本人使用时读取
- **第三方标注库**：脑库标注部分为 CC BY-NC 4.0（非商业，需署名）；本项目不转发其内容，见
  [`docs/数据来源与许可.md`](docs/数据来源与许可.md)
- **使用方式**：建议低频读取并遵守平台条款；接口为逆向所得，可能随时变化，不保证长期可用

## 免责声明

本项目为非官方工具，与粉笔、SaDuck 及其关联方无任何关系。仅供个人学习研究使用，使用风险自负；
请勿用于批量抓取、内容再分发或任何违反平台条款的用途。

## License

[MIT](LICENSE)。第三方依赖（Electron、@electron/packager 等）遵循各自许可证。
