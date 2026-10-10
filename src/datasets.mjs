// 数据集注册表：定义可同步的数据类别、初始推荐与敏感度说明。
// 用户可在应用「数据同步」页勾选；本地 agent 只应读取被选中的数据子目录。
// source 标明数据来源："fenbi" 需要登录会话拉取；"naoku" 来自本地脑库副本，不联网。

export const DATASETS = [
  {
    id: "history",
    title: "练习记录",
    dir: "练习记录",
    source: "fenbi",
    recommended: true,
    sensitivity: "低",
    description:
      "每次练习的索引：时间、名称、题数、对题数、难度、完成状态。适合作为总览与时间线。",
    agentUse: "统计练习频率与进度；找到值得复盘的场次（低分场/新考点场）。",
  },
  {
    id: "exercises",
    title: "题解与逐题作答",
    dir: "题解",
    source: "fenbi",
    recommended: true,
    sensitivity: "中（仅本人练习过的题目与解析）",
    description:
      "已完成练习的完整题解：题干、选项、我的答案、正确答案、解析、知识点、计时。",
    agentUse: "错因归类、知识点聚类、逐题复盘的核心材料。",
  },
  {
    id: "wrong",
    title: "错题本快照",
    dir: "错题本",
    source: "fenbi",
    recommended: true,
    sensitivity: "中（本人错题集合）",
    description: "错题按知识点树聚合，含题干、我的答案、正确答案与解析（来自已同步的练习）。",
    agentUse: "复习队列生成、薄弱知识点排序、错题重练规划。",
  },
  {
    id: "ability",
    title: "能力报告",
    dir: "能力报告",
    source: "fenbi",
    recommended: true,
    sensitivity: "低",
    description: "粉笔官方能力分析：预测分、排名、模块正确率、目标正确率、趋势。",
    agentUse: "阶段对比与目标差距分析；判断该优先攻哪一模块。",
  },
  {
    id: "notes-collects",
    title: "笔记与收藏",
    dir: "笔记与收藏",
    source: "fenbi",
    recommended: true,
    sensitivity: "中（本人笔记内容）",
    description: "本人笔记/收藏的题目清单与数量统计。当前为空时输出空表。",
    agentUse: "把「自己标记过」的题与错题合并成高优先级复习集合。",
  },
  {
    id: "mock-exams",
    title: "模考记录",
    dir: "模考记录",
    source: "fenbi",
    recommended: true,
    sensitivity: "低",
    description: "粉笔模考大赛的完成记录列表（当前账号无数据时输出占位说明）。",
    agentUse: "评估实战成绩/排名变化；与日常练习数据交叉分析。",
  },
  {
    id: "shenlun-history",
    title: "申论练习记录",
    dir: "申论练习记录",
    source: "fenbi",
    recommended: true,
    sensitivity: "低",
    description: "申论练习历史列表与批改额度（leftCount/pdpgLeftCount）。当前账号无申论数据时输出空表。",
    agentUse: "申论进度追踪、批改额度提醒。",
  },
  {
    id: "shenlun-details",
    title: "申论作答与批改",
    dir: "申论作答与批改",
    source: "fenbi",
    recommended: true,
    sensitivity: "中（本人申论作答与批改结果）",
    description:
      "每场申论练习的题目、作答与批改报告（智能批改/人工批改的原始报告）。有数据时自动产出。",
    agentUse: "申论逐题复盘、批改意见归纳、写作问题聚类。",
  },
  {
    id: "question-meta",
    title: "题目元数据（全站正确率/易错项）",
    dir: "题目元数据",
    source: "fenbi",
    recommended: false,
    sensitivity: "低（平台统计）",
    description:
      "对练习过的题目抓取全站正确率、易错选项等统计。请求数随题量线性增长，默认关闭。",
    agentUse: "难度校准：区分「大家都错」与「只有我错」，避免错误归因。",
  },
  {
    id: "naoku-index",
    title: "考公脑库索引",
    dir: "脑库索引",
    source: "naoku",
    recommended: true,
    sensitivity: "低（第三方公开标注库的索引）",
    description:
      "第三方标注库「考公脑库」（Obsidian vault，CC BY-NC 4.0）的索引：真题的粉笔题号 → 考点 / 材料 / 相关题的连接关系与母题摘要。只覆盖行测「资料分析」「判断推理」两个模块；不含题面原文、材料正文与图片，题面用 /api/tiku/* 按 qid 取。",
    agentUse: "把本人做过的题按 qid 接到考点与母题上，做考点级归因、同类题推荐与跨卷聚合。",
  },
];

export const DATASET_IDS = DATASETS.map((d) => d.id);

export function defaultSelection() {
  return DATASETS.filter((d) => d.recommended).map((d) => d.id);
}

export function datasetById(id) {
  return DATASETS.find((d) => d.id === id) ?? null;
}

// 明确不对外暴露的内容（写死在说明里，也写进 manifest）。
export const NEVER_EXPOSED = [
  "登录凭据（sess / persistent / userid Cookie）与任何 Token",
  "手机号、身份字段等账号个人信息（导出前统一脱敏）",
  "任何写操作能力（提交答案、删除错题、发布内容）",
  "未练习过的题库内容与付费课程资料（只导出本人做过的题）",
];
