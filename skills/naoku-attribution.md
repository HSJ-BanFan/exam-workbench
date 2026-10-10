# 技能：脑库归因

## 何时用

- 把错题从"做错了"升级为"属于哪个考点/母题"。
- 做考点级统计、同类题推荐、跨卷聚合时。

## 前置条件

- `GET /api/naoku/status` 确认 `imported` 与 `indexed` 均为 true。
- 未就绪时：`POST /api/naoku/import` 之后 `POST /api/naoku/index`（都是长任务，可能几分钟）。
- 脑库只覆盖行测的「资料分析」「判断推理」两个模块，其他模块命中 0 是正常结果。

## 调用序列

1. `GET /api/naoku/wrong-hits` 拿本人错题中命中脑库的清单（依赖已同步的粉笔错题本）。
2. `GET /api/naoku/for-question?qid=<题号>` 取该题的考点、材料、相关题与母题摘要。
3. `GET /api/naoku/note?path=<相对路径>` 读对应笔记正文（推理链、易错点等）。
4. 浏览：`GET /api/naoku/tree`（模块/大类）→ `GET /api/naoku/points?模块=&大类=&sort=题数`。
5. 检索：`GET /api/naoku/search?type=真题&模块=资料分析&limit=20`。

## 输出解读

- `wrong-hits` 返回 `total / hitCount / hits`；未命中不等于接口坏了，先看模块覆盖。
- 母题摘要截断到 300 字符；完整内容用 `note?path=` 读取。
- 题面/材料原文不在脑库里，用 `fenbi.questions` 按题号取。

## 边界

- 只读本地索引与副本；`import`/`index` 会写应用数据目录（不属于输出目录）。
- 脑库标注为 CC BY-NC 4.0（非商业）；不要把脑库副本或其索引公开分享。
