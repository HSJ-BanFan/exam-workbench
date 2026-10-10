# 技能：SaDuck 数据

## 何时用

- 用户要 SaDuck（saduck.top）侧的学习数据：计时、打卡、生词、晨读收藏、申论练习、错题、行测练习记录。
- 需要判断 SaDuck 会员状态对数据的影响时。

## 前置条件

- `GET /api/saduck/status`：`loggedIn=true` 才能读数据；`account.vipType != 0` 为会员。
- 会员受限时接口返回 `409` 与 `code 102` 语义（"会员功能"），不是故障。

## 调用序列

1. `GET /api/saduck/datasets` 看数据集目录（8 项，7 项默认）。
2. 实时读取（不落盘）：`GET /api/saduck/data?dataset=time`。
3. 需要落盘给其他工具：`POST /api/saduck/sync`（可指定 `?datasets=time,plan`），随后 `GET /api/saduck/manifest`。

## 数据集语义

| id | 名称 | 说明 |
|---|---|---|
| time | 计时记录 | 计时助手保存的记录 |
| plan | 每日打卡 | 打卡记录 |
| words | 生词锦囊 | 本人保存的词语 |
| read | 晨读收藏 | 收藏列表（不含正文） |
| sl | 申论练习记录 | 本人申论记录 |
| wrong | 错题列表 | 本人错题 |
| tklog | 行测练习记录 | 练习统计（tkMyRecords + myNodes） |
| bxcy | 词语辨析练习组 | 站点练习内容，默认不导出 |

## 输出解读

- 空数组表示"账号还没有这类数据"，不是错误；新账号多数数据集为空。
- 输出目录里每个数据集是 `<名称>.md`（可读）+ `<id>.json`（完整结构）。

## 边界

- 只读；token 不出应用会话，不写入输出目录。
- 词库查询、试卷与晨读正文等站点内容不在同步范围。
