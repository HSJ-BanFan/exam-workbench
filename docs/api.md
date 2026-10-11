# API 参考（非官方）

本项目的接口来自对**粉笔网页端**（`www.fenbi.com` / `spa.fenbi.com`）公开前端调用的观察与
实测（2026-10 快照）。接口由平台控制，可能随时变化；仅供个人学习用途，请遵守平台条款。

## 1. 基础

- 域名：
  - `tiku.fenbi.com`：题库与练习数据（`/api/...`、`/combine/...`、`/activity/...`）
  - `login.fenbi.com/api`：账号（`users/info`、`users/current`）
  - `ke.fenbi.com/api`：能力分析（`v3/user/analysis`）
- 认证：Cookie（HttpOnly）：`sess` + `userid` + `persistent`；无请求签名。
  浏览器内 `document.cookie` 读不到，需要从网络请求头或 Electron session 读取。
- 公共参数（网页端习惯附加，多数接口可省略）：
  `app=web&kav=131&av=134&hav=128&version=3.0.0.0&deviceId=..&gav=2&apcId=0&examcatid=..`
  `examcatid` 为当前考试类别（不同省份/类别取值不同，可从 `activity/userexamcategory/getCurrent` 获取）。
- 错误约定：业务错误也用 **HTTP 200** 返回，判断 `code !== 1`（`msg` 为原因）；
  `limit > 20` 会返回「参数不合法」；未登录多为 401。

## 2. 行测（prefix = `xingce`）

| 接口 | 说明 |
|---|---|
| `GET /combine/exercise/getExerciseBriefHistory?categoryId=&limit=&cursor=&routecs=xingce` | 练习历史；`categoryId`：`3`=练习 tab、`1`=试卷 tab；limit ≤ 20，cursor 翻页 |
| `GET /combine/exercise/getExerciseBriefHistory?categoryId=4` | 个人页「最近练习」小列表（历史版本入口） |
| `GET /combine/exercise/getSolution?format=html&key=<exerciseKey>&routecs=xingce` | 逐题作答（`userAnswers`：题号/选择/对错/计时）+ 静态题解签名 `switchVO.requestKey` |
| `GET /combine/static/solution?key=<requestKey>&routecs=xingce&type=1` | 题解正文：题干、选项、`correctAnswer`、解析、知识点 |
| `GET /combine/exercise/getReport?format=html&key=<exerciseKey>&routecs=xingce` | 成绩报告（按知识点：题数/对题数/用时） |
| `GET /api/xingce/errors/keypoint-tree?timeRange=0&order=desc` | 错题知识点树（节点含 questionIds） |
| `GET /api/xingce/questions?ids=` | 按题目 ID 取题干/选项/正确答案（不含解析） |
| `GET /api/xingce/user-answers?ids=` | 我的作答 |
| `GET /api/xingce/question/meta?ids=` | 全站正确率/易错项 |
| `GET /api/xingce/solution/keypoints?ids=` | 题目解析知识点 |
| `GET /api/xingce/userCollectNoteError?type=u_error,u_note,u_collect` | 错题/笔记/收藏数量 |
| `GET /api/xingce/notes?questionIds=` / `collects?ids=` | 笔记 / 收藏内容 |
| `GET /ke/v3/user/analysis?tiku_prefix=xingce`（ke.fenbi.com） | 官方能力报告：预测分/排名/模块正确率/趋势 |

## 3. 申论（prefix = `shenlun`）

| 接口 | 说明 | 状态 |
|---|---|---|
| `GET /api/shenlun/users/:userId` | 申论账号信息与批改额度（`leftCount`/`unitLeftCount`/`pdpgLeftCount`） | ✅ 实测 |
| `GET /api/shenlun/exercises/briefReportsForWeb?status=2&categoryId=1&currentPage=&pageSize=` | 申论练习历史 | ✅ 实测（空） |
| `GET /api/shenlun/papers?filter=review&labelId=&toPage=&pageSize=` | 申论试卷列表 | ✅ 实测 |
| `GET /api/shenlun/papers/:paperId` / `.../sheet` | 试卷详情 / 结构（questionIds） | ✅ 实测 |
| `GET /api/shenlun/questions?ids=` | 申论题干（type 21，含字数/分值约束） | ✅ 实测 |
| `GET /api/shenlun/exercises/:exerciseId` | 单场练习详情 | ⚠️ 端点验证（非本人 404） |
| `GET /api/shenlun/exercises/:id/report?format=html` / `.../manual/report?format=html` | 智能/人工批改报告 | ⚠️ 需本人练习数据 |
| `GET /api/shenlun/solution/questions?format=html&questionIds=` | 参考答案 | ⚠️ 未做过的题受限（空/400） |

## 4. 题库目录（公开）

| 接口 | 说明 |
|---|---|
| `GET /api/xingce/comptroller/subLabels` / `GET /api/shenlun/subLabels` | 分类树（labelId、paperCount、paperIds） |
| `GET /api/xingce/comptroller/papers?toPage=&pageSize=&labelId=` | 行测试卷列表 |
| `GET /api/xingce/comptroller/papers/:paperId/sheet` | 行测试卷结构（章节/时长/questionIds） |
| `GET /api/xingce/papers/:paperId` | 试卷详情 |
| `GET /api/xingce/subLabels/v2`、`papers/v2` | 新版目录接口（网页端在用） |

## 5. 模考（现状：接口可用，字段未验证）

| 接口 | 说明 |
|---|---|
| `GET /activity/awardExam/list?coursePrefix=xingce` | 当前模考活动列表 |
| `GET /activity/awardExam/exercise/history?coursePrefix=xingce` | 本人模考完成记录（`{items,total,hasMore}`） |

## 6. 本应用暴露的接口（127.0.0.1:8791）

| 接口 | 说明 |
|---|---|
| `GET /api/status` `/api/datasets` `/api/manifest` | 同步状态 / 数据集 / 清单 |
| `POST /api/sync[?datasets=a,b&full=1]` | 触发同步（只读拉取本人数据） |
| `GET /api/tiku/labels?prefix=` | 题库分类树 |
| `GET /api/tiku/papers?prefix=&labelId=&page=&pageSize=` | 试卷列表（pageSize ≤ 20） |
| `GET /api/tiku/paper?prefix=&paperId=` / `paper-sheet?...` | 试卷详情 / 结构 |
| `GET /api/tiku/questions?prefix=&ids=` | 题干（ids ≤ 20） |
| `GET /api/tiku/question-meta?prefix=&ids=` | 全站正确率/易错项（ids ≤ 50） |
| `GET /api/naoku/status` | 脑库副本与索引状态（本地，不需要登录态） |
| `POST /api/naoku/import` | 稀疏克隆或更新脑库副本（跳过 `90-图片`） |
| `POST /api/naoku/index` | 扫描脑库副本，重建 `脑库索引/` |
| `GET /api/naoku/search?type=&q=&模块=&大类=&地区=&年份=&考点=&limit=` | 在索引字段上检索（limit ≤ 200） |
| `GET /api/naoku/note?path=` | 读脑库笔记正文（路径限制在 vault 内） |
| `GET /api/naoku/for-question?qid=` | 按粉笔题号取「真题 → 考点/材料/相关题」 |
| `GET /api/naoku/points?模块=&大类=&limit=` | 考点列表（含母题摘要），供考点级复习 |

### SaDuck 同步结果

`POST /api/saduck/sync[?datasets=time,plan]` 同步所选的本人数据。所有数据集均成功或仅有会员限制时返回 HTTP 200。任一数据集状态为 `error` 时返回 HTTP 409。

未提供 `datasets` 时，应用使用已配置的默认选择。请求体中的 `{"datasets": []}` 或查询参数 `?datasets=` 表示不选数据集。查询参数存在时优先于请求体。

SaDuck 页面可用且会话校验通过时，空选择会写入空 manifest 和警告，不调用数据集接口，并返回 HTTP 200。页面不可用或会话校验失败时仍会返回错误状态。

数据集同步完成但有数据集失败时，响应保留顶层 `ok: false` 和 `error`，并返回 `datasets` 与 `manifest` 路径。页面不可用、会话校验失败或已有同步任务运行时，错误响应不包含这两项。`datasets[id].status` 分别为 `ok`、`vip` 或 `error`。读取 `datasets[id].message` 可查看对应数据集的详细原因。

其他成功数据集及其文件不会因同批次的失败而撤销，manifest 会记录本次各数据集状态。

```json
{
  "ok": false,
  "error": "部分数据集同步失败：每日打卡（plan）",
  "datasets": {
    "time": { "title": "计时记录", "items": 1, "status": "ok", "message": "", "files": ["计时记录/计时记录.md", "计时记录/time.json"] },
    "plan": { "title": "每日打卡", "items": 0, "status": "error", "message": "503 synthetic failure", "files": [] }
  },
  "manifest": "<configured SaDuck output directory>/manifest.json"
}
```

## 7. 脑库索引接口（`/api/naoku/*`）

数据来源是第三方 Obsidian vault「[考公脑库](https://github.com/ERRRC/kaogongzhentizhengliu)」，只覆盖
行测的「资料分析」「判断推理」。本组接口只在**本地副本与索引**上工作，不联网取题面，也不复制脑库正文；
许可与出处见 [`数据来源与许可.md`](数据来源与许可.md)。

前置：先 `POST /api/naoku/import`（稀疏克隆，跳过 206MB 的 `90-图片`），再 `POST /api/naoku/index`。
命令行等价入口是 `npx electron . --naoku-import`（无窗口导入 + 重建索引）。

### `GET /api/naoku/status`

```json
{
  "ok": true,
  "vaultDir": "D:\\Documents\\fenbi-sync\\考公脑库",
  "repo": "https://github.com/ERRRC/kaogongzhentizhengliu.git",
  "imported": true,
  "indexed": true,
  "indexDir": "D:\\Documents\\fenbi-sync\\脑库索引",
  "counts": { "真题": 11282, "考点": 10375, "材料": 717, "笔记总数": 22380, "考点链接未命中": 1, "材料链接未命中": 0 },
  "vaultCommit": "84ab93d4b64b61d897bece8a1c0a5bab06b4feb2",
  "generatedAtText": "2026-10-10T02:31:07.412Z",
  "warnings": []
}
```

### `POST /api/naoku/import` / `POST /api/naoku/index`

`import` 幂等：目录无 `.git` 时按 `--depth 1 --filter=blob:none --sparse` 克隆，已存在时
`fetch --depth 1` + 重放 sparse 规则 + `reset --hard FETCH_HEAD`（不递归删除任何目录）。

```json
{ "ok": true, "dir": "D:\\Documents\\fenbi-sync\\考公脑库", "repo": "https://github.com/ERRRC/kaogongzhentizhengliu.git", "commit": "84ab93d4b6…", "cloned": false }
```

`index` 未导入时返回 `409` 与 `脑库未导入（…），先运行 POST /api/naoku/import`。成功返回：

```json
{ "ok": true, "counts": { "真题": 11282, "考点": 10375, "材料": 717, "笔记总数": 22380, "考点链接未命中": 1, "材料链接未命中": 0 },
  "模块列表": ["判断推理", "资料分析"], "warnings": ["考点题数与真题反查不一致 1 处，例如：…"], "vault": { "dir": "…", "commit": "84ab93d4…" } }
```

### `GET /api/naoku/search`

`type` 取 `真题`（默认）、`考点`、`材料`，其他值返回 `400`。`q` 是跨字段关键字，其余参数按字段包含匹配。
`limit` 默认 50，**上限 200**，非法值回落到默认。

```powershell
Invoke-RestMethod "http://127.0.0.1:8791/api/naoku/search?type=真题&地区=广东&年份=2024&limit=5"
```

```json
{ "ok": true, "type": "真题", "total": 56, "limit": 5,
  "items": [{ "qid": "10204443", "模块": "资料分析", "大类": "增长", "考点": "增长 / 年均增长量",
    "考点路径": "20-考点/资料分析/增长/年均增长量", "地区": "广东", "年份": "2024",
    "相关题": ["5514931", "5102148", "12881983"], "材料": "4463712",
    "path": "10-真题/资料分析/增长/10204443 年均增长量.md" }] }
```

### `GET /api/naoku/for-question?qid=`

`qid` 用粉笔题号，和 `GET /api/tiku/questions?ids=` 是同一套编号；`考点`/`材料`/`相关题` 都带 `path`，可直接接 `note`。

```json
{ "ok": true, "qid": "10204443",
  "笔记": { "qid": "10204443", "考点": "增长 / 年均增长量", "材料": "4463712", "path": "10-真题/…/10204443 年均增长量.md" },
  "考点": { "考点": "年均增长量", "题数": 3, "母题": "当题干出现…", "真题": ["5102148", "5514931", "10204443"], "path": "20-考点/资料分析/增长/年均增长量.md" },
  "材料": { "mid": "4463712", "小题数": 5, "真题": ["10204443", "…"], "path": "15-材料/资料分析/4463712 …md" },
  "相关题": [{ "qid": "5514931", "path": "10-真题/资料分析/增长/5514931 年均增长量.md" }] }
```

未收录的 qid 返回 `{ "ok": true, "qid": "…", "笔记": null, "考点": null, "材料": null, "相关题": [] }`；
缺 `qid` 返回 `400`。

### `GET /api/naoku/note?path=`

`path` 必须是 vault 内的相对路径（索引里的 `path` 直接可用）。越界、绝对路径、空值一律 `400`，服务端在
`realpath` 之后复核文件确实落在 vault 内，符号链接同样挡掉。

```json
{ "ok": true, "path": "20-考点/资料分析/增长/年均增长量.md", "content": "---\n类型: \"考点\"\n…" }
```

### `GET /api/naoku/points?模块=&大类=&limit=`

等价于 `search?type=考点`，返回考点与其母题摘要，`limit` 同样上限 200。

## 8. 使用边界

- 仅用于**本人账号**的读取与学习分析；不要用于批量抓取题库或再分发平台内容。
- 应用侧只调用读接口；提交答案/删除错题/写作等写操作一律未实现。
- 平台可能调整接口或收紧权限（例如未练习内容不可取材料/答案），本项目不保证长期可用。
- 脑库是**第三方**内容：本项目只做本地副本与索引，不分发其笔记、题面、材料与图片；上游标注部分为
  CC BY-NC 4.0（非商业），引用需署名。详见 [`数据来源与许可.md`](数据来源与许可.md)。
