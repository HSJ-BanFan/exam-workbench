// 粉笔网页端只读 API 客户端（在 case-2026-fenbi01 中实测验证）。
// 只调用本人在网页端会触发的读取接口；不包含任何写操作。

export const TIKU = "https://tiku.fenbi.com";
export const LOGIN = "https://login.fenbi.com/api";
export const KE = "https://ke.fenbi.com/api";

export function makeClient(cookieHeader, { prefix = "xingce" } = {}) {
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9",
        cookie: cookieHeader,
        origin: "https://www.fenbi.com",
        referer: "https://www.fenbi.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
    });
    const text = await res.text();
    if (opts.raw) {
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return text;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
    try {
      const parsed = JSON.parse(text);
      // 平台习惯：业务错误也用 HTTP 200 返回，code !== 1 视为失败（errors 等接口返回纯数组）。
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "code" in parsed && parsed.code !== 1) {
        throw new Error(`接口返回 code=${parsed.code}（${parsed.msg ?? "无消息"}）：${url}`);
      }
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) return text;
      throw error;
    }
  }

  const qs = (obj) => new URLSearchParams(obj).toString();

  // 题库（公开目录 + 卷子内容）的每个课程前缀有各自的路径风格。
  const BANK_ROUTES = {
    xingce: {
      labels: () => `${TIKU}/api/xingce/comptroller/subLabels`,
      papers: (q) =>
        `${TIKU}/api/xingce/comptroller/papers?${qs({ toPage: q.page, pageSize: q.pageSize, labelId: q.labelId })}`,
      paper: (id) => `${TIKU}/api/xingce/papers/${id}`,
      sheet: (id) => `${TIKU}/api/xingce/comptroller/papers/${id}/sheet`,
    },
    shenlun: {
      labels: () => `${TIKU}/api/shenlun/subLabels`,
      papers: (q) =>
        `${TIKU}/api/shenlun/papers?${qs({ filter: "review", labelId: q.labelId, toPage: q.page, pageSize: q.pageSize })}`,
      paper: (id) => `${TIKU}/api/shenlun/papers/${id}`,
      sheet: (id) => `${TIKU}/api/shenlun/papers/${id}/sheet`,
    },
  };
  const bankRoute = (p) => BANK_ROUTES[p] ?? BANK_ROUTES.xingce;

  return {
    async getUser() {
      const info = await api(`${LOGIN}/users/info?app=web`).catch(() => null);
      if (info?.userId) return info;
      return api(`${LOGIN}/users/current?app=web`);
    },
    async getExamCategory() {
      const j = await api(`${TIKU}/activity/userexamcategory/getCurrent?app=web`);
      return j?.data ?? j;
    },
    // 练习历史：categoryId 3 =「练习」tab，1 =「试卷」tab（前端 673.js 硬编码映射）。
    // 单页上限经验值 ≤ 20（大于 20 的 limit 会返回“参数不合法”）；逐页跟随 cursor。
    async getHistory({ maxItems = 500, categoryId = 3 } = {}) {
      const perPage = 15;
      const items = [];
      let cursor = "";
      for (let page = 0; page < 40; page++) {
        const q = qs({ noCacheTag: Date.now(), categoryId, limit: perPage, cursor, routecs: prefix });
        const j = await api(`${TIKU}/combine/exercise/getExerciseBriefHistory?${q}`);
        const data = j?.data ?? j;
        const batch = data?.historyItems ?? [];
        items.push(...batch);
        cursor = data?.cursor ?? "";
        if (!cursor || !batch.length || items.length >= maxItems) break;
      }
      return { cursor: null, historyItems: items.slice(0, maxItems) };
    },
    // 模考大赛完成记录（结构与报告格式未验证；当前账号无数据）
    async getMockHistory() {
      return api(`${TIKU}/activity/awardExam/exercise/history?${qs({ coursePrefix: prefix })}`);
    },
    async getExerciseSolution(key) {
      const j = await api(
        `${TIKU}/combine/exercise/getSolution?${qs({ format: "html", key, routecs: prefix })}`
      );
      return j?.data ?? j;
    },
    async getExerciseReport(key) {
      const j = await api(
        `${TIKU}/combine/exercise/getReport?${qs({ format: "html", key, routecs: prefix, no_toast: "true" })}`
      );
      return j?.data ?? j;
    },
    async getStaticSolution(requestKey) {
      return api(
        `${TIKU}/combine/static/solution?${qs({ key: requestKey, routecs: prefix, type: 1 })}`
      );
    },
    async getErrorsTree(timeRange = 0, order = "desc") {
      return api(`${TIKU}/api/${prefix}/errors/keypoint-tree?${qs({ timeRange, order })}`);
    },
    async getQuestions(ids) {
      return api(`${TIKU}/api/${prefix}/questions?${qs({ ids: ids.join(",") })}`);
    },
    async getUserAnswers(ids) {
      return api(`${TIKU}/api/${prefix}/user-answers?${qs({ ids: ids.join(",") })}`);
    },
    async getSolutionKeypoints(ids) {
      return api(`${TIKU}/api/${prefix}/solution/keypoints?${qs({ ids: ids.join(",") })}`);
    },
    async getQuestionMeta(ids) {
      return api(`${TIKU}/api/${prefix}/question/meta?${qs({ ids: ids.join(",") })}`);
    },
    async getUserCollectNoteError(type = "u_error,u_note,u_collect") {
      return api(`${TIKU}/api/${prefix}/userCollectNoteError?${qs({ type })}`);
    },
    async getNotesTree(timeRange = 0, order = "desc") {
      return api(`${TIKU}/api/${prefix}/notes/keypoint-tree?${qs({ timeRange, order })}`);
    },
    async getCollectsTree(timeRange = 0, order = "desc") {
      return api(`${TIKU}/api/${prefix}/collects/keypoint-tree?${qs({ timeRange, order })}`);
    },
    async getNotes(ids) {
      return api(`${TIKU}/api/${prefix}/notes?${qs({ questionIds: ids.join(",") })}`);
    },
    async getCollects(ids) {
      return api(`${TIKU}/api/${prefix}/collects?${qs({ ids: ids.join(",") })}`);
    },
    async getUserAnalysis() {
      const j = await api(`${KE}/v3/user/analysis?tiku_prefix=${prefix}`);
      return j?.data ?? j;
    },

    // ---- 题库接口（只读，供本地 agent） ----
    async getBankLabels(p) {
      return api(bankRoute(p).labels());
    },
    async getBankPapers(p, { labelId = 1, page = 0, pageSize = 15 } = {}) {
      return api(
        bankRoute(p).papers({
          labelId,
          page: Math.max(0, page),
          pageSize: Math.min(20, Math.max(1, pageSize)),
        })
      );
    },
    async getBankPaper(p, paperId) {
      return api(bankRoute(p).paper(paperId));
    },
    async getBankPaperSheet(p, paperId) {
      return api(bankRoute(p).sheet(paperId));
    },

    // ---- 申论 ----
    async getShenlunUserInfo(userId) {
      return api(`${TIKU}/api/shenlun/users/${userId}`);
    },
    async getShenlunBriefReports({ status = 2, categoryId = 1, currentPage = 0, pageSize = 15 } = {}) {
      return api(
        `${TIKU}/api/shenlun/exercises/briefReportsForWeb?${qs({ status, categoryId, currentPage, pageSize })}`
      );
    },
    async getShenlunExercise(id) {
      return api(`${TIKU}/api/shenlun/exercises/${id}`);
    },
    async getShenlunReportRaw(id) {
      return api(`${TIKU}/api/shenlun/exercises/${id}/report?format=html`, { raw: true });
    },
    async getShenlunManualReportRaw(id) {
      // 前端有两个变体路径，按顺序尝试
      try {
        return await api(`${TIKU}/api/shenlun/exercises/${id}/manual/report?format=html`, { raw: true });
      } catch {
        return api(`${TIKU}/api/shenlun/shenlun/exercises/${id}/manual/report?format=html`, { raw: true });
      }
    },
    async getShenlunSolutionRaw(questionIds) {
      return api(
        `${TIKU}/api/shenlun/solution/questions?format=html&questionIds=${questionIds.join(",")}`,
        { raw: true }
      );
    },
    async getShenlunSolutionAndMaterialRaw(questionIds) {
      return api(
        `${TIKU}/api/shenlun/questionIds/solutionAndMaterial?format=html&questionIds=${questionIds.join(",")}`,
        { raw: true }
      );
    },
  };
}

// ---------------------------------------------------------------- helpers

export function maskPhone(value) {
  return String(value ?? "").replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
}

export function redactUser(user) {
  if (!user) return null;
  const clone = { ...user };
  for (const k of ["phone", "identity"]) if (clone[k]) clone[k] = maskPhone(clone[k]);
  return clone;
}

export function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, "\n[图片]($1)\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function choiceToLetters(choice) {
  if (choice == null || choice === "") return "（未作答）";
  const parts = String(choice)
    .split(/[,，]/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!parts.length) return "（未作答）";
  return parts
    .map((c) => {
      const n = Number(c);
      return Number.isInteger(n) && n >= 0 && n < 26 ? String.fromCharCode(65 + n) : String(c);
    })
    .join("");
}

export function flattenErrorTree(tree, out = [], depth = 0) {
  for (const node of tree ?? []) {
    out.push({ id: node.id, name: node.name, questionIds: node.questionIds ?? [], depth });
    flattenErrorTree(node.children, out, depth + 1);
  }
  return out;
}

function walkReportDetails(details, out = []) {
  for (const d of details ?? []) {
    out.push(d);
    walkReportDetails(d.children, out);
  }
  return out;
}

export function summarizeReport(report) {
  const subs = report?.subReports ?? [];
  const basic = subs.find((r) => r.basicType === 1) ?? {};
  const courseEntry = subs.find((r) => r.courseReports) ?? {};
  const course = (courseEntry.courseReports ?? [])[0] ?? {};
  const stat = course.courseStat ?? {};
  return {
    name: report?.name,
    questionCount: basic.questionCount ?? stat.questionCount,
    correctCount: basic.correctCount ?? stat.correctCount,
    difficulty: basic.difficulty,
    submitTime: basic.submitTime,
    details: walkReportDetails(course.details),
  };
}

export function buildQuestionRows(solution, staticData) {
  const userAnswers = solution?.userAnswers ?? {};
  const staticById = new Map((staticData?.solutions ?? []).map((s) => [s.globalId, s]));
  const rows = [];
  for (const [globalId, ua] of Object.entries(userAnswers)) {
    const q = staticById.get(globalId) ?? {};
    rows.push({
      globalId,
      id: q.id ?? ua.id,
      content: htmlToText(q.content),
      options: (q.accessories?.[0]?.options ?? []).map((o, i) => ({
        letter: String.fromCharCode(65 + i),
        text: htmlToText(o),
      })),
      myChoice: choiceToLetters(ua.answer?.choice),
      correctChoice: choiceToLetters(q.correctAnswer?.choice),
      isCorrect: ua.status === 1,
      time: ua.time,
      explanation: htmlToText(q.solution),
      keypoints: (q.keypoints ?? []).map((k) => k.name),
    });
  }
  return rows;
}

export function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function todayShanghai() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
