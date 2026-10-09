# 备考工作台（exam-workbench）

> 非官方 · 本地优先：把「刷题 → 数据同步 → AI 复盘」串成一条流水线。

![备考工作台：刷题与错题聚类（手绘）](assets/hero.jpg)

把粉笔网页端装进一个桌面应用里刷题，并把**本人账号**的练习数据（练习/试卷/错题/申论/能力报告/模考）
**只读同步**到本地目录（Markdown + JSON，Obsidian 友好），同时通过本机 HTTP 接口提供给
Codex / Claude 等 AI agent 做聚类分析与复盘。

*An unofficial Electron (webview) workbench: practice in-app, read-only sync your own practice
data to local Markdown/JSON, and expose a localhost API for AI agents to analyze and cluster
your mistakes.*

## 功能

- **Webview 刷题**：独立应用窗口内嵌题库，登录态持久化，接近原生的刷题体验
- **只读数据同步**：9 个数据集（练习记录 / 题解与逐题作答 / 错题本快照 / 能力报告 /
  笔记与收藏 / 模考记录 / 申论练习记录 / 申论作答与批改 / 可选题目元数据），增量缓存
- **AI 友好输出**：带 frontmatter 的 Markdown + 机器可读 JSON；输出目录可配置（例如你的学习库）
- **本机 HTTP 接口**：同步接口 + 只读题库接口（分类/试卷/题目/全站正确率），供 agent 调用
- **无窗口模式**：`--sync-only` 静默同步并退出，适合接入定时复盘工作流

## 明确的边界

- 只调用**读取**接口：不提交答案、不删除错题、不发布任何内容
- 仓库与导出不含登录凭据；输出前脱敏账号字段（手机号等）
- HTTP 接口仅在 `127.0.0.1` 监听；不提供批量导出题库的功能
- 未练习过的题目内容（尤其申论材料/参考答案）受平台权限限制，取不到就不取

## 快速开始

环境：Node.js ≥ 20（开发）；运行打包版只需要 Windows。

```powershell
npm install
npm start        # 开发运行
npm run pack     # 打包到 dist/（免安装目录）
```

首次使用：

1. 「刷题」页登录你的账号（扫码/验证码，登录态保存在本机应用数据目录）
2. 「数据同步」页确认要同步的数据集 → 点「立即同步」
3. 「设置」里指定输出目录（默认在系统「文档」下的 `fenbi-sync`）

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
└── 题目元数据/          # 可选：全站正确率/易错项（默认关闭）
```

所有 Markdown 带 frontmatter（`type: generated / sample: false`），可以直接放进 Obsidian 库。

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

## 本机接口（默认 `http://127.0.0.1:8791`）

| 接口 | 说明 |
|---|---|
| `GET /api/status` / `GET /api/datasets` / `GET /api/manifest` | 同步状态 / 数据集 / 输出清单 |
| `POST /api/sync[?datasets=history,wrong&full=1]` | 触发一次同步并返回摘要 |
| `GET /api/tiku/labels?prefix=xingce\|shenlun` | 题库分类树 |
| `GET /api/tiku/papers?prefix=&labelId=&page=&pageSize=` | 试卷列表（pageSize ≤ 20） |
| `GET /api/tiku/paper?prefix=&paperId=` / `paper-sheet?...` | 试卷详情 / 结构（含 questionIds） |
| `GET /api/tiku/questions?prefix=&ids=` | 按题目 ID 取题干/选项/正确答案（ids ≤ 20） |
| `GET /api/tiku/question-meta?prefix=&ids=` | 全站正确率 / 易错项（ids ≤ 50） |

「设置」中可修改端口与访问令牌（设置后请求需带 `X-Sync-Token` 头）。
完整接口参考（含逆向说明与边界）：[`docs/api.md`](docs/api.md)。

```powershell
Invoke-RestMethod http://127.0.0.1:8791/api/status
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8791/api/sync"
Invoke-RestMethod "http://127.0.0.1:8791/api/tiku/papers?labelId=1&pageSize=5"
```

## 与 AI agent 一起工作（示例工作流）

1. 白天刷题（手机 App 或本应用都行，同一账号数据互通）
2. 触发同步（应用按钮 / `POST /api/sync` / `--sync-only`）
3. 让 Codex / Claude 读输出目录：错题聚类、错误模式归纳、复习优先级
4. 进阶：每晚定时任务先 `--sync-only` 再自动复盘，把结果写回学习库

## 开发与验证

```powershell
npm start                       # 开发运行
npm run pack                    # 打包
node scripts/dev-sync-test.mjs  # 不用 UI 直接跑同步引擎（SESSION_PATH 指向会话文件）
node scripts/api-test.mjs       # 启动应用并自动化测试 HTTP 接口
node scripts/probe.mjs "/api/xingce/errors/keypoint-tree?timeRange=0&order=desc"
npx electron . --self-test      # 全链路自测：导入会话→同步→截图→退出
```

## 隐私与合规（重要）

- **凭据本地**：`sess/persistent` 等 Cookie 只存在于本机应用会话目录；仓库与导出中不含凭据
- **个人数据**：导出包含你本人的作答与错题（手机号等已脱敏）；请勿公开分享你的输出目录
- **平台内容**：题目与解析的版权归平台所有；本项目不内置、不打包任何题库内容，只在你本人使用时读取
- **使用方式**：建议低频读取并遵守平台条款；接口为逆向所得，可能随时变化，不保证长期可用

## 免责声明

本项目为非官方工具，与粉笔及其关联公司无任何关系。仅供个人学习研究使用，使用风险自负；
请勿用于批量抓取、内容再分发或任何违反平台条款的用途。

## License

[MIT](LICENSE)。第三方依赖（Electron、@electron/packager 等）遵循各自许可证。
