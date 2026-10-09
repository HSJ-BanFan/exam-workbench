// 数据集注册表：定义可同步的数据类别、初始推荐与敏感度说明。
// 用户可在应用「数据同步」页勾选；本地 agent 只应读取被选中的数据子目录。

export const DATASETS = [
  {
    id: "history",
    title: "练习记录",
    dir: "练习记录",
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
    recommended: true,
    sensitivity: "中（本人错题集合）",
    description: "错题按知识点树聚合，含题干、我的答案、正确答案与解析（来自已同步的练习）。",
    agentUse: "复习队列生成、薄弱知识点排序、错题重练规划。",
  },
  {
    id: "ability",
    title: "能力报告",
    dir: "能力报告",
    recommended: true,
    sensitivity: "低",
    description: "粉笔官方能力分析：预测分、排名、模块正确率、目标正确率、趋势。",
    agentUse: "阶段对比与目标差距分析；判断该优先攻哪一模块。",
  },
  {
    id: "notes-collects",
    title: "笔记与收藏",
    dir: "笔记与收藏",
    recommended: true,
    sensitivity: "中（本人笔记内容）",
    description: "本人笔记/收藏的题目清单与数量统计。当前为空时输出空表。",
    agentUse: "把「自己标记过」的题与错题合并成高优先级复习集合。",
  },
  {
    id: "mock-exams",
    title: "模考记录",
    dir: "模考记录",
    recommended: true,
    sensitivity: "低",
    description: "粉笔模考大赛的完成记录列表（当前账号无数据时输出占位说明）。",
    agentUse: "评估实战成绩/排名变化；与日常练习数据交叉分析。",
  },
  {
    id: "shenlun-history",
    title: "申论练习记录",
    dir: "申论练习记录",
    recommended: true,
    sensitivity: "低",
    description: "申论练习历史列表与批改额度（leftCount/pdpgLeftCount）。当前账号无申论数据时输出空表。",
    agentUse: "申论进度追踪、批改额度提醒。",
  },
  {
    id: "shenlun-details",
    title: "申论作答与批改",
    dir: "申论作答与批改",
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
    recommended: false,
    sensitivity: "低（平台统计）",
    description:
      "对练习过的题目抓取全站正确率、易错选项等统计。请求数随题量线性增长，默认关闭。",
    agentUse: "难度校准：区分「大家都错」与「只有我错」，避免错误归因。",
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
