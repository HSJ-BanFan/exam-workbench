# 技能：题库查询

## 何时用

- 要浏览粉笔题库目录、找试卷、按题号取题干/选项/正确答案。
- 复盘时需要补充"全站正确率/易错项"做难度校准。

## 前置条件

- 应用运行中，且「刷题」页已登录粉笔账号（未登录时接口返回 409/401 提示）。
- 只需行测用 `prefix=xingce`，申论用 `prefix=shenlun`（默认 xingce）。

## 调用序列

1. `GET /api/tiku/labels?prefix=xingce` 拿分类树，挑出 `labelId`。
2. `GET /api/tiku/papers?labelId=1&pageSize=5` 列试卷（pageSize ≤ 20）。
3. `GET /api/tiku/paper-sheet?paperId=<id>` 拿该卷的 `questionIds`。
4. `GET /api/tiku/questions?ids=19526238,19526244` 取题干/选项/正确答案（≤ 20 个）。
5. 可选：`GET /api/tiku/question-meta?ids=...`（≤ 50 个）取全站正确率/易错项。
6. 申论参考答案：`GET /api/tiku/shenlun-solutions?ids=...`（≤ 10 个，仅本人做过的题可用）。

## 示例

```powershell
Invoke-RestMethod "http://127.0.0.1:8791/api/tiku/labels?prefix=xingce"
Invoke-RestMethod "http://127.0.0.1:8791/api/tiku/paper-sheet?paperId=5823067"
Invoke-RestMethod "http://127.0.0.1:8791/api/tiku/questions?ids=19526238"
```

## 输出解读

- `labels` 返回树形分类；`papers.data.list` 是试卷数组；`paper-sheet` 的 `questionIds` 是题号列表。
- `questions` 返回题干内容与选项；解析与知识点以本人在平台的练习数据为准（见输出目录 `题解/`）。

## 边界

- 只读；有单次数量上限（题目 20、元数据 50、申论答案 10），不要批量导出整库。
- 未做过的申论题材料/答案受平台权限限制，取不到属正常。
- 题目内容版权归平台，仅用于个人复盘，不要转发。
