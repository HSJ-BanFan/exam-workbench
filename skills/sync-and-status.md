# 技能：同步与状态

## 何时用

- 用户要"同步一下数据"、"手机上的练习更新到电脑"、"最近同步了吗"。
- 任何分析开始前，需要确认数据是否新鲜、对应源是否已登录。

## 前置条件

- 应用「备考工作台」正在运行（本机接口默认 `http://127.0.0.1:8791`；设置了接口令牌时需带 `X-Sync-Token` 头）。
- 粉笔数据需要应用「刷题」页已登录；SaDuck 数据需要「SaDuck」页已登录。

## 调用序列

1. `GET /api/status`：看 `hasSession`（粉笔）、`hasSaduckSession`（SaDuck）、`lastSyncAt`、`dataDir`、`saduckDir`。
2. 粉笔同步：`POST /api/sync`（可选 `?datasets=history,wrong`；`full=1` 全量刷新）。
3. SaDuck 同步：`POST /api/saduck/sync`（可选 `?datasets=time,plan`）。
4. 落盘结果：`GET /api/manifest`、`GET /api/saduck/manifest`；人类可读摘要在各输出目录的 `状态/同步状态.md`。

## 示例

```powershell
Invoke-RestMethod http://127.0.0.1:8791/api/status
Invoke-RestMethod -Method Post "http://127.0.0.1:8791/api/sync?datasets=history,ability"
Invoke-RestMethod -Method Post "http://127.0.0.1:8791/api/saduck/sync?datasets=time,plan"
```

## 输出解读

- 同步摘要形如 `{ ok, datasets: { history: { title, items, files } } }`；`items` 是条目数。
- 未完成的历史场次会被跳过（没有完整题解），出现在 `warnings` 里。
- SaDuck 数据集中若某项返回 `status: "vip"` 表示会员受限（接口 code 102），其他数据集不受影响。

## 边界

- `sync` 是"读上游、写本地输出目录"，不会修改你在平台上的任何数据。
- 未登录时接口返回 `409` 与明确提示；请先让用户在应用内完成登录，不要反复重试。
- 不要高频轮询触发同步；先看状态，再决定是否同步。
