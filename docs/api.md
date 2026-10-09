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

## 7. 使用边界

- 仅用于**本人账号**的读取与学习分析；不要用于批量抓取题库或再分发平台内容。
- 应用侧只调用读接口；提交答案/删除错题/写作等写操作一律未实现。
- 平台可能调整接口或收紧权限（例如未练习内容不可取材料/答案），本项目不保证长期可用。
