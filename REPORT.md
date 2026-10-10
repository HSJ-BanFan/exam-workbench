# 验收报告：备考工作台（webview 桌面应用 + 数据同步接口）

> 说明：本文件是项目验收记录，包含开发过程中的本地实测证据；其中出现的本机路径仅为作者环境，
> 读者无需具备相同目录结构。个人账号数据不在本仓库中。

- 日期：2026-10-09（Asia/Shanghai）
- 上游依赖：`cases/case-2026-fenbi01`（粉笔网页端接口逆向，只读）
- 结论：桌面应用已打包并实测；同步接口、数据集选择、目录输出、本机 HTTP 接口全部通过验证

## 1. 需求与验证对照

| 需求 | 实现 | 验证证据 |
|---|---|---|
| webview 打包桌面应用 | Electron 44.7，`<webview partition="persist:fenbi">` 内嵌粉笔题库 | 打包版运行截图（`.selftest/packaged/window.png`）：应用窗口内显示本人已登录的题库页；`dist/exam-workbench-win32-x64/exam-workbench.exe` 存在（246MB） |
| 原生刷题体验 | 独立应用窗口 + 应用内登录态持久化 + 工具栏（题库首页/刷新/浏览器打开） | 同上截图；登录态在应用重启后保留（分区持久化） |
| 手机刷题数据同步到电脑 | 手机端（粉笔 App）→ 粉笔云端 → 本应用只读同步 | 练习记录 `client:"ANDROID"`（`题解/练习-1_1_3tejoup.json`，该场练习在手机端完成），同步后在电脑端落盘 |
| 对外暴露数据同步接口 | 本机 HTTP API（127.0.0.1:8791） | `scripts/api-test.mjs`（开发版 + 打包版两次全绿）：status/datasets/sync/manifest 四接口 |
| 用户可选择同步数据（初始推荐） | 7 个数据集 + 应用内勾选（默认推荐 6 个） | 截图（数据同步页勾选列表）；`/api/datasets` 返回 7 项、默认启用 6 项 |
| 输出到一个目录、按子目录存放 | `60-资料/粉笔同步/` + 每数据集一个子目录（md + json） | 目录实测列出 6 个子目录（含模考记录）；`GET /api/manifest` 的 `contents` 字段与实际一致 |
| 供 Codex/Claude 分析、沉淀聚类与复盘 | frontmatter 规范的可读 md + 机器 json；考公库校验通过 | `node tools/vault.mjs check`：3903 文件、0 错误、0 警告 |

## 2. 实测记录（本机）

环境：Node v24.20.0；Electron v44.7.0；@electron/packager 20.3.0；Chrome UA 154。

1. `node scripts/dev-sync-test.mjs`（全 6 数据集，输出到 scratch）
   → `ok:true`；history 2、exercises 1（拉取 1）、wrong 11、question-meta 15、ability 1、notes-collects 0。
2. `npx electron . --self-test`（开发版）
   → PASS；cookie 导入 4 个；同步 5 个默认数据集到考公库目录；API 端口 8791 就绪；截图生成。
3. `node scripts/api-test.mjs`（开发版）
   → `ok:true`；`POST /api/sync?datasets=history,ability` 返回 200 且 `ok:true`。
4. `npm run pack` → `dist/exam-workbench-win32-x64/exam-workbench.exe`。
5. 打包版 `--self-test` → PASS（同 2，独立 userData 分区重新导入会话）。
6. `node scripts/api-test.mjs <打包版 exe>` → `ok:true`（同 3）。
7. `node tools/vault.mjs check`（考公库）→ 0 错误 0 警告（对生成目录含 `type: generated` 的 md 同样适用）。

### 2.1 补强验证（同日第二次迭代）

以网页端源码为准修正了「练习历史」的覆盖口径，并接入模考与申论探测：

- `673.js udpateNavTabs` 显示练习历史 = 「练习」(type 3) + 「试卷」(type 1) 两个 tab；
  实测 `categoryId=3` 返回本人 2 条记录、`categoryId=1` 返回 0 条（本人未做过整卷）；
  同步逻辑改为两 tab 合并去重，练习记录表新增「来源」列。
- 模考：`activity/awardExam/exercise/history?coursePrefix=xingce` 实测 200，本人 `items:[]`；
  已作为数据集「模考记录」接入（默认开启，暂无数据）。
- 申论：`api/shenlun/exercises/briefReportsForWeb` 实测 200（返回空 pageInfo）；完整链路未验证。
- 重新打包并复测：开发版 `--self-test` PASS；打包版 `--self-test` PASS（6 个默认数据集全部落盘）。

### 2.2 第三次迭代：申论 + 题库接口（2026-10-09 晚）

需求：申论数据也要同步；对外（本地 agent）暴露题库接口。

**申论（实测证据）**

- 站点：申论练习/报告在独立子站 `spa.fenbi.com/shenlun`（构建产物 `weblts_spa_online/shenlun/*`）。
- 实测通过的接口：`/api/shenlun/users/:id`（批改额度：pdpgLeftCount=1）、
  `/api/shenlun/exercises/briefReportsForWeb`（历史，空列表 200）、
  `/api/shenlun/papers` / `papers/:id` / `papers/:id/sheet`（小模考 4473791：3 题）、
  `/api/shenlun/questions?ids=`（取到真实申论题干，含字数/分值约束）。
- 已接线、待真实数据验证：`/api/shenlun/exercises/:id`（实测对非本人练习 404「未找到练习」）、
  `/exercises/:id/report|manual/report?format=html`（对非本人练习返回空）。
- 权限门槛观察：未做过的申论题，`solutionAndMaterial` 返回 400、`solution/questions` 返回空
  —— 与「只同步本人做过的内容」的边界一致。

**题库接口（实测证据，api-test 打包版与开发版均通过）**

- `GET /api/tiku/labels` → 行测 38 个分类 / 申论 37 个分类。
- `GET /api/tiku/papers?labelId=1&pageSize=3` → 国考行测试卷列表，首条 5823067。
- `GET /api/tiku/paper-sheet?paperId=5823067` → 130 个 questionIds；申论 4473791 → 3 个 questionIds。
- `GET /api/tiku/questions?ids=` → 取回题干内容（hasContent=true）。
- 参数边界：pageSize ≤ 20、ids ≤ 20（题目）/50（元数据）；只读、无批量导出端点。

**同步输出**：新增「申论练习记录」「申论作答与批改」两个数据集（默认开启，共 8 个默认数据集）；
申论无数据时输出空表 + 说明占位。开发版/打包版 `--self-test` 均 PASS；
考公库 `node tools/vault.mjs check` → 3907 文件 0 错误 0 警告。

## 3. 接口数据链路（承接上游案件）

- 历史：`combine/exercise/getExerciseBriefHistory`（注意 limit≤20，逐页 cursor 翻页；>20 返回 code=-1）
- 题解签名与作答：`combine/exercise/getSolution` → `combine/static/solution`（题干/选项/答案/解析/知识点）
- 报告：`combine/exercise/getReport`（知识点树 + 用时）
- 错题：`api/xingce/errors/keypoint-tree`；补充用 `questions / user-answers / solution/keypoints`
- 能力：`ke.fenbi.com/api/v3/user/analysis`
- 业务错误约定：HTTP 200 + `code !== 1`（客户端已按此校验）

## 4. 未验证 / 限制

- 申论（shenlun）链路与 `categoryId`；当前仅行测。
- 模考记录字段/报告格式（账号暂无模考数据，仅有列表接口的 200 验证）。
- 手机端若新增练习，需在应用内触发同步才能落到电脑（无后台定时任务，符合考公库约定）。
- 打包版未做单文件（one-file）打包与签名，目录分发；移动端未打包。
- 计时单位未证实；`capacityTrendVOS` 等字段未解读。

## 5. 安全边界

- 只读接口；不调用提交/删除/收藏等写操作。
- 凭据（sess/persistent/userid）只存在于本机 Electron 分区与引导用 session.json，
  不写入输出目录；输出目录中手机号等字段已脱敏（151****5169）。
- HTTP 接口仅 127.0.0.1；支持设置 X-Sync-Token。

## 附录：第四次迭代 — SaDuck 接入（2026-10-10）

需求：在应用内使用 SaDuck（saduck.top），并通过本机 HTTP 接口把 SaDuck 能力暴露给本地 agent。

实现（上游：`cases/case-2026-saduck01`）：

- 新增 `src/saduck.mjs`：8 个数据集（7 个默认；词语辨析练习组默认关闭）、经 webview 页面上下文
  调用官方接口（token 不出页面）、导出为与 saduck-cli 相同结构的 md + json + manifest + 状态。
- `src/main.mjs`：跟踪 `persist:saduck` webview；`doSaduckSync`；会话引导
  （`%APPDATA%\备考工作台\saduck-session.json`，格式同 saduck-cli `session.json`）；
  IPC `saduck:status` / `saduck:sync`；HTTP `/api/saduck/*`；自检扩展为「粉笔 + SaDuck」双链路。
- `ui/`：新增「SaDuck」页（webview + 首页/刷新/浏览器打开/同步我的数据）、侧栏 SaDuck 登录灯、
  设置项「SaDuck 数据输出目录」、接口卡新增 SaDuck 段。
- `scripts/api-test.mjs`：新增 SaDuck 断言（status/datasets/data/sync；未登录时自动降级）。

实测证据（2026-10-10）：

1. 开发版 `npx electron . --self-test`（scratch userData + 双源会话引导）：PASS；
   粉笔 history 3 场 + ability ✓；SaDuck 7 数据集全部 ok。
2. `node scripts/api-test.mjs`：`ok: true`；`saduckStatus{loggedIn:true}`、`saduckDatasets=8`、
   `saduckData ok`、`saduckSync 200`（time,plan）。
3. 真实配置实测：`/api/saduck/status` → `dir=D:\05_Life\...\60-资料\SaDuck同步`；
   `POST /api/saduck/sync` → 7 数据集落盘；考公库 `node tools/vault.mjs check` → 3923 文件 0 错误 0 警告。
4. 打包版 `dist/exam-workbench-win32-x64/exam-workbench.exe --self-test` → PASS（exit 0），
   截图 `window.png` + `window-saduck.png`；产物与本记录同目录 `.selftest/saduck-e2e/result-packaged3/`。

边界与限制：

- SaDuck 全程只读；不含写操作与站点正文内容；token 只存应用会话目录与引导文件，不进输出目录。
- SaDuck 同步需要应用窗口（webview）在线；`--sync-only` 目前仍只覆盖粉笔（SaDuck 待接线）。
- 会员状态变化（如到期）会以接口 `code 102` 反映到同步状态表，不会中断其他数据集。

## 附录：第五次迭代 — Agent Surface（发现接口 + MCP）（2026-10-10）

需求：agent 不应在应用外手写规则才能使用工作台；应有一个接口包装能力与技能，调用它即可理解工作台。

实现：

- `src/agent-surface.mjs`（新增，单一事实源）：25 条能力（HTTP 路由 / 参数 JSON Schema / 前置条件 / 只读标记 /
  示例说明）+ 5 个技能索引；`/api/agent`、`/api/agent/skills/<id>` 与 `mcp/server.mjs` 都从它生成。
- `skills/`（新增 5 篇）：sync-and-status / tiku-lookup / naoku-attribution / saduck-data / outputs-and-privacy。
- `mcp/server.mjs`（新增，stdio、零依赖）：JSON-RPC over stdio；tools 25、prompts 5、
  resources（工作台状态 + 两个 manifest + 技能原文）。
- `src/server.mjs`、`src/main.mjs`：`/api/agent` 路由与 handler；state 只含布尔与时间，不泄露邮箱/token。
- `scripts/api-test.mjs`：新增 `/api/agent` 契约断言、技能可取、能力抽样可达、MCP 冒烟
  （initialize / tools/list / prompts/list / tools.call app_status）。
- 项目级注册：考公库 `.codex/config.toml`（Codex）与 `.mcp.json`（Claude Code）；工作台仓库不再保留注册，避免跨项目出现。
- 版本 0.3.0。

实测证据（2026-10-10，日志在 `.selftest/saduck-e2e/`）：

1. 开发版 api-test：`ok:true`；`agent{capabilities:25, skills:5}`；技能 URL 200（text/markdown）；
   5 个能力探针全部 200；`mcp{server:"exam-workbench", tools:25, prompts:5, statusOk:true}`。
2. 打包版 api-test（`dist\exam-workbench-win32-x64\exam-workbench.exe`）：`ok:true`，同上一套断言。
3. 精确配置验证：真实应用运行时，按考公项目级配置同款命令（绝对 node 路径 + `mcp/server.mjs` + 默认端口，
   cwd=考公库）握手成功并可调用 `app_status`（server v0.3.0）。

偏差说明：MCP 冒烟放在 api-test（普通 node 进程，便于驱动 stdio），未放进 Electron selftest。

边界与限制：

- `/api/agent` 受与全站一致的 `X-Sync-Token` 保护；state 不含邮箱与 token。
- 应用未运行时 MCP 工具返回离线提示；不自动拉起应用，避免隐式副作用。
- surface schema 版本为 1；破坏性变更需要升版本并在 README 标注。
