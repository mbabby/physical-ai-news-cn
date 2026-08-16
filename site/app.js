const fallback = {
  generatedAt: new Date().toISOString(),
  periodLabel: "近 30 天滚动窗口",
  stats: { events: 0, companies: 0, research: 0, sources: 0 },
  confirmedSignals: [],
  developingSignals: [],
  topSignals: [],
  keyEvents: [],
  capital: [],
  industry: [],
  research: [],
  researchGraph: [],
  companyRadar: [],
  routes: [],
};

const byId = (id) => document.getElementById(id);
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value, fallbackValue = "") => (value == null ? fallbackValue : String(value));
const safe = (value = "") => text(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));
const safeUrl = (value) => {
  try {
    const url = new URL(text(value), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? safe(url.href) : "#";
  } catch {
    return "#";
  }
};
const date = (value) => {
  const match = text(value).match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}` : "—";
};
const percentage = (value, fallbackValue = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallbackValue;
};
const finiteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const countOf = (value) => Array.isArray(value) ? value.length : finiteNumber(value);
const formattedCount = (value) => {
  const number = finiteNumber(value);
  return number === null ? "—" : new Intl.NumberFormat("zh-CN", { notation: number >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number);
};

const evidenceStates = {
  official: { label: "官方确认", tone: "verified" },
  verified: { label: "官方确认", tone: "verified" },
  confirmed: { label: "官方确认", tone: "verified" },
  multi_source: { label: "多源确认", tone: "verified" },
  corroborated: { label: "多源确认", tone: "verified" },
  developing: { label: "补证中", tone: "developing" },
  pending: { label: "补证中", tone: "developing" },
  conflict: { label: "存在冲突", tone: "conflict" },
  disputed: { label: "存在冲突", tone: "conflict" },
  unknown: { label: "未知", tone: "unknown" },
  retracted: { label: "已撤回", tone: "retracted" },
  withdrawn: { label: "已撤回", tone: "retracted" },
  stale: { label: "已过期", tone: "stale" },
  expired: { label: "已过期", tone: "stale" },
};
const detailItems = new Map();
let lastDetailTrigger = null;

function evidenceState(item = {}, fallbackState = "unknown") {
  const raw = text(item.evidenceState || item.verificationState || item.verificationStatus || item.status || fallbackState).trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (evidenceStates[normalized]) return evidenceStates[normalized];
  if (/官方|official/.test(raw)) return evidenceStates.official;
  if (/多源|多方|交叉|corroborat/.test(raw)) return evidenceStates.multi_source;
  if (/补证|进行|develop|pending/.test(raw)) return evidenceStates.developing;
  if (/冲突|争议|conflict|disput/.test(raw)) return evidenceStates.conflict;
  if (/撤回|retract|withdraw/.test(raw)) return evidenceStates.retracted;
  if (/过期|失效|stale|expir/.test(raw)) return evidenceStates.stale;
  return { label: raw && raw !== "unknown" ? raw : "未知", tone: "unknown" };
}

function evidenceBadge(item, fallbackState) {
  const state = evidenceState(item, fallbackState);
  return `<span class="evidence-status evidence-status--${safe(state.tone)}" data-evidence-state="${safe(state.tone)}">${safe(state.label)}</span>`;
}

function signalId(item, index = 0) {
  const raw = text(item.id || item.slug || item.eventId || item.link || item.title || `signal-${index}`);
  let hash = 0;
  for (let position = 0; position < raw.length; position += 1) hash = ((hash << 5) - hash + raw.charCodeAt(position)) | 0;
  return text(item.id || item.slug || `signal-${Math.abs(hash)}`).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function rememberDetail(item, index) {
  const id = signalId(item, index);
  detailItems.set(id, item);
  return id;
}

function sourceList(item) {
  const candidates = [...list(item.sources), ...list(item.evidence), item.link ? [{ title: item.source, url: item.link }] : []];
  const seen = new Set();
  return candidates.map((source) => typeof source === "string" ? { title: source, url: source } : (source || {})).filter((source) => {
    const url = text(source.url || source.link || source.href);
    if (!url || safeUrl(url) === "#" || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function ensureDetailDrawer() {
  let drawer = byId("signal-detail-drawer");
  if (drawer) return drawer;
  drawer = document.createElement("aside");
  drawer.id = "signal-detail-drawer";
  drawer.className = "signal-detail-drawer";
  drawer.hidden = true;
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "signal-detail-title");
  drawer.innerHTML = '<button class="drawer-backdrop" type="button" data-close-detail aria-label="关闭详情"></button><div class="drawer-panel" tabindex="-1"><header><span>证据详情</span><button type="button" data-close-detail aria-label="关闭详情">×</button></header><div id="signal-detail-content"></div></div>';
  (byId("detail-drawer-root") || document.body).append(drawer);
  drawer.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-detail]")) closeDetail();
  });
  return drawer;
}

function issueUrl(item) {
  const title = `补充证据：${text(item.title, "未命名信号")}`;
  const body = [`## 对应信号`, text(item.title, "未命名信号"), ``, `## 待补证内容`, text(item.missingEvidence || item.unknowns || "请填写需要补充或纠正的字段"), ``, `## 来源`, `请粘贴可公开核验的原始来源链接。`].join("\n");
  return `https://github.com/mbabby/physical-ai-news-cn/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function detailMarkup(item) {
  const state = evidenceState(item);
  const sources = sourceList(item);
  const unknowns = list(item.unknowns).length ? list(item.unknowns).join("、") : text(item.missingEvidence || item.unknown || "暂无额外未知项记录");
  const occurredAt = item.eventDate || item.date || item.publishedAt;
  const verifiedAt = item.verifiedAt || item.reviewedAt || item.updatedAt;
  return `<div class="drawer-status">${evidenceBadge(item)}<span>事件 ${date(occurredAt)}</span><span>核验 ${date(verifiedAt)}</span></div>
    <h2 id="signal-detail-title">${safe(item.title || "未命名信号")}</h2>
    <section><h3>事实</h3><p>${safe(item.summary || item.fact || "该信号的事实摘要尚未补全。")}</p></section>
    <section><h3>为什么重要</h3><p>${safe(item.whyItMatters || item.why || "影响判断仍在补全，不做超出证据的推断。")}</p></section>
    <section><h3>证据</h3>${sources.length ? `<ol>${sources.map((source) => `<li><a href="${safeUrl(source.url || source.link || source.href)}" target="_blank" rel="noopener noreferrer">${safe(source.title || source.name || source.publisher || "原始来源")}</a></li>`).join("")}</ol>` : '<p class="empty">尚无可公开跳转的原始来源。</p>'}</section>
    <section><h3>未知 / 冲突</h3><p>${safe(state.tone === "conflict" ? (item.conflict || unknowns) : unknowns)}</p></section>
    <section><h3>下一观察点</h3><p>${safe(item.nextWatch || item.nextObservation || item.watchFor || "等待主体公告、第二个独立来源或后续落地证据。")}</p></section>
    <div class="drawer-actions"><button type="button" data-share-detail>分享</button><button type="button" data-copy-detail>复制链接</button><a href="${safe(issueUrl(item))}" target="_blank" rel="noopener noreferrer">补充证据</a>${sources[0] ? `<a href="${safeUrl(sources[0].url || sources[0].link || sources[0].href)}" target="_blank" rel="noopener noreferrer">原始来源 ↗</a>` : ""}</div>`;
}

function closeDetail({ updateUrl = true } = {}) {
  const drawer = byId("signal-detail-drawer");
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  document.body.classList.remove("detail-open");
  if (updateUrl) {
    const url = new URL(window.location.href);
    if (url.searchParams.has("signal")) {
      url.searchParams.delete("signal");
      history.replaceState({}, "", url);
    }
  }
  if (lastDetailTrigger?.isConnected) lastDetailTrigger.focus();
}

function openDetail(id, trigger = null, { updateUrl = true } = {}) {
  const item = detailItems.get(id);
  if (!item) return;
  lastDetailTrigger = trigger;
  const drawer = ensureDetailDrawer();
  byId("signal-detail-content").innerHTML = detailMarkup(item);
  drawer.hidden = false;
  document.body.classList.add("detail-open");
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("signal", id);
    history.pushState({ signal: id }, "", url);
  }
  drawer.querySelector(".drawer-panel").focus();
}

document.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-signal-detail]");
  if (trigger) {
    event.preventDefault();
    openDetail(trigger.dataset.signalDetail, trigger);
    return;
  }
  const drawer = event.target.closest("#signal-detail-drawer");
  if (!drawer) return;
  const id = new URL(window.location.href).searchParams.get("signal");
  const item = detailItems.get(id);
  if (!item) return;
  if (event.target.closest("[data-copy-detail]")) await navigator.clipboard?.writeText(window.location.href);
  if (event.target.closest("[data-share-detail]")) {
    if (navigator.share) await navigator.share({ title: item.title || "Physical AI 信号", text: item.summary || "", url: window.location.href }).catch(() => {});
    else await navigator.clipboard?.writeText(window.location.href);
  }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDetail(); });
window.addEventListener("popstate", () => {
  const id = new URL(window.location.href).searchParams.get("signal");
  if (id && detailItems.has(id)) openDetail(id, null, { updateUrl: false });
  else closeDetail({ updateUrl: false });
});

function itemCard(item, compact = false) {
  return `<a class="${compact ? "feed-item" : "key-card"}" href="${safeUrl(item.link)}" target="_blank" rel="noopener noreferrer">
    <div class="item-meta"><span>${safe(item.type || "已验证信号")}</span><time datetime="${safe(item.date)}">${date(item.date)}</time></div>
    <h3>${safe(item.title || "未命名信号")}</h3><p>${safe(item.summary || "查看原始证据了解详情。")}</p>
    ${compact ? "" : `<footer>${safe(item.route || "待分类")} <i aria-hidden="true">↗</i></footer>`}
  </a>`;
}

function signalCard(item, index) {
  const id = rememberDetail(item, index);
  return `<article class="top-signal">
    <div class="signal-rank">${String(index + 1).padStart(2, "0")}</div>
    <div class="signal-copy">
      <div class="signal-badges">${evidenceBadge(item, item.evidenceGrade === "A" ? "official" : "multi_source")}<span>${safe(item.type || "已验证信号")}</span><span>${safe(item.evidenceCount || 1)} 个独立证据</span></div>
      <h3><a href="?signal=${safe(id)}" data-signal-detail="${safe(id)}">${safe(item.title || "未命名信号")}</a></h3>
      <p>${safe(item.summary || "查看原始证据了解详情。")}</p>
      <footer><strong>为什么重要</strong> ${safe(item.whyItMatters || "该信号已通过公开展示门槛，值得持续跟踪。")} <i>${safe(item.entity || item.source || "公开来源")} · 事件 ${date(item.date)}${item.verifiedAt ? ` · 核验 ${date(item.verifiedAt)}` : ""}</i></footer>
    </div>
  </article>`;
}

function developingCard(item) {
  const id = rememberDetail(item, detailItems.size);
  return `<article class="developing-signal">
    <div class="signal-badges">${evidenceBadge(item, "developing")}<span>${safe(item.evidenceCount || 1)} 个独立证据</span><span>${safe(item.type || "产业信号")}</span></div>
    <h3><a href="?signal=${safe(id)}" data-signal-detail="${safe(id)}">${safe(item.title || "未命名信号")}</a></h3>
    <p>${safe(item.summary || "查看原始证据了解详情。")}</p>
    <footer><strong>仍待补证</strong> ${safe(item.missingEvidence || "缺少官方公告或第二个独立可信来源")}<i>${safe(item.entity || item.source || "主体已识别")} · ${date(item.date)}</i></footer>
  </article>`;
}

function renderFeed(id, items) {
  const emptyMessage = id === "capital"
    ? "近 30 天没有满足公开证据门槛的资本事件；这不代表没有发生融资。"
    : "等待下一条已验证信号";
  byId(id).innerHTML = list(items).length
    ? list(items).map((item) => itemCard(item, true)).join("")
    : `<p class="empty">${safe(emptyMessage)}</p>`;
}

function decisionValue(field, fallbackValue = "未知") {
  const value = field && typeof field === "object" && "value" in field ? field.value : undefined;
  if (value === undefined || value === null || value === "unknown") return fallbackValue;
  return Array.isArray(value) ? value.join(" · ") : String(value);
}

function renderResearchFeed(items) {
  byId("research").innerHTML = list(items).length ? list(items).map((item) => {
    const card = item.decisionCard;
    if (!card) return itemCard(item, true);
    const tags = [
      decisionValue(card.task, "任务未知"),
      decisionValue(card.embodiment, "本体未知"),
      `基准：${decisionValue(card.benchmark)}`,
      `实机：${decisionValue(card.realRobotTrials, "未知")}`,
      `复现成本：${decisionValue(card.reproducibilityCost)}`,
    ];
    return `<a class="feed-item research-decision" href="${safeUrl(item.link)}" target="_blank" rel="noopener noreferrer">
      <div class="item-meta"><span>研究决策卡</span><time datetime="${safe(item.date)}">${date(item.date)}</time></div>
      <h3>${safe(item.title || "未命名论文")}</h3><p>${safe(item.summary || "查看论文原文了解研究方法与实验结论。")}</p>
      <div class="decision-tags">${tags.map((tag) => `<span>${safe(tag)}</span>`).join("")}</div>
      <small>${safe(decisionValue(card.whyWorthAttention, "字段不足处已明确标记为未知，不进行推断。"))}</small>
    </a>`;
  }).join("") : '<p class="empty">等待完成身份、元数据和中文事实门槛的研究决策卡。</p>';
}

function fillOptions(id, values, firstLabel) {
  const select = byId(id);
  const current = select.value;
  const unique = [...new Set(list(values).filter(Boolean).map(text))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  select.innerHTML = `<option value="">${safe(firstLabel)}</option>${unique.map((value) => `<option value="${safe(value)}">${safe(value)}</option>`).join("")}`;
  select.value = unique.includes(current) ? current : "";
}

function compactFact(item, fallbackValue) {
  if (!item?.link || !item?.title) return `<span class="radar-muted">${safe(fallbackValue)}</span>`;
  return `<a href="${safeUrl(item.link)}" target="_blank" rel="noopener noreferrer">${safe(item.title)}</a>`;
}

function normalizedCompany(item) {
  const routes = list(item.routes).map(text).filter(Boolean);
  const recentSignals = Number.isFinite(Number(item.recentSignals))
    ? Number(item.recentSignals)
    : [item.funding, item.progress].filter(Boolean).length;
  const baseScore = recentSignals * 18 + (item.funding ? 22 : 0) + (item.progress ? 16 : 0) + (item.capitalStatus === "已证实" ? 16 : 0);
  const momentumScore = percentage(item.momentumScore, Math.min(88, baseScore));
  return {
    ...item,
    routes,
    recentSignals,
    momentumScore,
    momentumLabel: item.momentumLabel || (momentumScore >= 65 ? "高动量" : momentumScore >= 35 ? "升温" : "持续跟踪"),
    region: item.region || "区域待补全",
    stage: item.stage || "阶段待补全",
    capitalStatus: item.capitalStatus || "证据不足",
    validationStage: item.validationStage || "证据不足",
  };
}

function boardCapital(capital) {
  if (!capital || capital.state !== "verified") return "融资：证据不足（不代表未融资）";
  const value = capital.value === "unknown" || !capital.value ? "字段未知" : capital.value;
  return `融资：${value}${capital.eventDate && capital.eventDate !== "unknown" ? ` · 事件 ${date(capital.eventDate)}` : ""}`;
}

function boardEntryCard(item, mode) {
  const breakdown = list(item.scoreBreakdown);
  const evidenceDates = list(item.evidenceDates).filter((value) => /^\d{4}-\d{2}-\d{2}/.test(text(value)));
  const unknowns = list(item.unknowns).filter(Boolean);
  const rank = mode === "ranked" && Number.isFinite(Number(item.rank)) ? `#${safe(item.rank)}` : "观察";
  const scoreLabel = mode === "ranked" && finiteNumber(item.score) !== null ? `综合分 ${safe(Math.round(Number(item.score)))}` : "不展示精确分";
  return `<article class="board-entry">
    <div class="board-entry-head"><span class="board-rank">${rank}</span><div><h4><a href="${safeUrl(item.officialUrl)}" target="_blank" rel="noopener noreferrer">${safe(item.companyName || "待识别公司")}</a></h4><small>${scoreLabel}</small></div></div>
    <div class="board-score" aria-label="公开评分依据">${breakdown.length ? breakdown.map((part) => `<div><span>${safe(part.label || part.key || "评分项")}</span><b>${finiteNumber(part.points) !== null && mode === "ranked" ? safe(Math.round(Number(part.points))) : "已观察"}</b><small>${safe(part.basis || "依据待补全")}</small></div>`).join("") : '<span class="radar-muted">评分依据待补全</span>'}</div>
    <p class="board-capital ${item.capital?.state === "verified" ? "verified" : ""}">${safe(boardCapital(item.capital))}</p>
    <footer>证据日期：${evidenceDates.length ? evidenceDates.map(date).join(" · ") : "未知"}${unknowns.length ? ` · 未知项：${unknowns.map(safe).join("、")}` : ""}</footer>
  </article>`;
}

function renderCompanyBoards(value) {
  const container = byId("company-boards");
  const grid = byId("company-board-grid");
  if (!container || !grid || !value || typeof value !== "object") {
    if (container) container.hidden = true;
    return;
  }
  const boards = [value.momentum, value.strategic].filter((board) => board && typeof board === "object");
  if (!boards.length) {
    container.hidden = true;
    return;
  }
  grid.innerHTML = boards.map((board) => {
    const entries = list(board.entries).slice(0, 5);
    const mode = board.mode === "ranked" ? "ranked" : "watchlist";
    return `<section class="company-board" aria-label="${safe(board.title || "公司观察榜")}">
      <header><div><p class="eyebrow">${mode === "ranked" ? "RANKED TOP 5" : "UNRANKED WATCHLIST"}</p><h3>${safe(board.title || "公司观察榜")}</h3></div><span>${mode === "ranked" ? `样本 ${safe(board.sampleSize ?? entries.length)}` : "样本不足 · 无名次"}</span></header>
      <p class="board-reason">${safe(board.reason || (mode === "ranked" ? "已达到公开排名样本门槛。" : "样本不足，降级为无序观察清单。"))}</p>
      <div class="board-entries">${entries.length ? entries.map((item) => boardEntryCard(item, mode)).join("") : '<p class="empty">当前没有达到证据门槛的公司。</p>'}</div>
    </section>`;
  }).join("");
  container.hidden = false;
}

const watchlistGroups = [
  { value: "priority-focus", label: "重点关注" },
  { value: "continued-observation", label: "持续观察" },
];
const watchlistChangeLabels = {
  added: "新进入名单",
  strengthened: "判断强化",
  downgraded: "判断降级",
  exited: "退出名单",
};

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const validValidationDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const watchlistRoutes = ["数据与训练", "VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "部署与商业化"];
const watchlistRouteSlugs = [
  { route: "数据与训练", slug: "data-and-training" },
  { route: "VLA 与具身模型", slug: "vla-and-embodied-models" },
  { route: "世界模型与空间智能", slug: "world-models-and-spatial-intelligence" },
  { route: "本体与硬件", slug: "embodiment-and-hardware" },
  { route: "部署与商业化", slug: "deployment-and-commercialization" },
];
const watchlistRouteSlugByName = new Map(watchlistRouteSlugs.map(({ route, slug }) => [route, slug]));
const canonicalWatchlistRouteSlugs = new Set(watchlistRouteSlugs.map(({ slug }) => slug));
const watchlistMaxCompanies = 30;
const watchlistMaxRoutes = 10;
const watchlistMaxQueryLength = 2048;
const validWatchlistRoutes = (value) => Array.isArray(value) && value.length > 0
  && value.every((route) => watchlistRoutes.includes(route))
  && new Set(value).size === value.length
  && value.every((route, index) => index === 0 || value[index - 1] < route);

function validWatchlistCard(item, track) {
  return Boolean(item) && typeof item === "object"
    && nonEmpty(item.companyId) && nonEmpty(item.companyName)
    && item.track === track
    && (item.group === "priority-focus" || item.group === "continued-observation")
    && ["new", "strengthening", "awaiting-validation", "downgraded"].includes(item.lifecycle)
    && nonEmpty(item.lifecycleLabel) && validWatchlistRoutes(item.routes) && nonEmpty(item.whyNow) && nonEmpty(item.routeAndDependencies)
    && Array.isArray(item.nextValidationPoints) && item.nextValidationPoints.every((point) => point && typeof point === "object" && nonEmpty(point.text) && validValidationDate(point.dueAt))
    && Array.isArray(item.falsifiers) && item.falsifiers.every((entry) => entry && typeof entry === "object" && nonEmpty(entry.text))
    && Array.isArray(item.evidenceLinks) && item.evidenceLinks.every((entry) => entry && typeof entry === "object" && nonEmpty(entry.eventId) && nonEmpty(entry.title) && nonEmpty(entry.url) && nonEmpty(entry.source) && (entry.grade === "A" || entry.grade === "B"))
    && item.capital && typeof item.capital === "object"
    && (item.capital.status === "verified" || item.capital.status === "evidence-insufficient")
    && nonEmpty(item.capital.summary);
}

function validWatchlist(value) {
  const week = typeof value?.week === "string" ? /^\d{4}-W(\d{2})$/.exec(value.week) : null;
  const structurallyValid = Boolean(value) && typeof value === "object"
    && Boolean(week) && Number(week[1]) >= 1 && Number(week[1]) <= 53
    && typeof value.snapshotVersion === "number" && Number.isInteger(value.snapshotVersion) && value.snapshotVersion > 0
    && nonEmpty(value.methodologyVersion)
    && typeof value.lastSuccessfulAt === "string" && Number.isFinite(Date.parse(value.lastSuccessfulAt))
    && Array.isArray(value.companyIds) && value.companyIds.every(nonEmpty)
    && Array.isArray(value.forwardRadar) && value.forwardRadar.every((item) => validWatchlistCard(item, "forward-radar"))
    && Array.isArray(value.validatedMomentum) && value.validatedMomentum.every((item) => validWatchlistCard(item, "validated-momentum"))
    && Array.isArray(value.changes) && value.changes.every((item) => item && typeof item === "object" && nonEmpty(item.companyId) && nonEmpty(item.companyName) && ["added", "strengthened", "downgraded", "exited"].includes(item.change));
  if (!structurallyValid) return false;
  const cardIds = [...value.forwardRadar, ...value.validatedMomentum].map((card) => card.companyId);
  return new Set(cardIds).size === cardIds.length
    && new Set(value.companyIds).size === value.companyIds.length
    && value.companyIds.length === cardIds.length
    && value.companyIds.every((companyId, index) => companyId === cardIds[index]);
}

const unsafeWatchlistValue = (value) => value.length === 0 || value !== value.trim() || /[\u0000-\u001F\u007F<>"'&]/.test(value);
const stableWatchlistValues = (values) => [...new Set(list(values).filter((value) => typeof value === "string" && !unsafeWatchlistValue(value)))].sort();

function safelyDecodeWatchlistValue(value) {
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, " "));
    return unsafeWatchlistValue(decoded) ? null : decoded;
  } catch {
    return null;
  }
}

function encodeWatchlistConfig(config = {}) {
  const companies = stableWatchlistValues(config.companyIds).slice(0, watchlistMaxCompanies);
  const routes = stableWatchlistValues(config.routes).slice(0, watchlistMaxRoutes);
  return [companies.length ? `watch=${companies.map(encodeURIComponent).join(",")}` : "", routes.length ? `routes=${routes.map(encodeURIComponent).join(",")}` : ""].filter(Boolean).join("&");
}

function watchlistValuesFor(query, name, warnings) {
  const values = [];
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const rawName = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? "" : pair.slice(separator + 1);
    if (safelyDecodeWatchlistValue(rawName) !== name || rawValue === "") continue;
    const decodedValue = safelyDecodeWatchlistValue(rawValue);
    if (decodedValue === null) {
      warnings.push("已忽略无效的观察名单配置值");
      continue;
    }
    for (const item of decodedValue.split(",")) {
      if (item === "") continue;
      if (unsafeWatchlistValue(item)) warnings.push("已忽略无效的观察名单配置值");
      else values.push(item);
    }
  }
  return stableWatchlistValues(values);
}

function decodeWatchlistConfig(value, catalog) {
  let query;
  try {
    query = (typeof value === "string" ? value.replace(/^\?/, "") : String(value));
  } catch {
    return { config: { companyIds: [], routes: [] }, warnings: ["观察名单配置过长，已忽略"] };
  }
  if (query.length > watchlistMaxQueryLength) return { config: { companyIds: [], routes: [] }, warnings: ["观察名单配置过长，已忽略"] };
  const warnings = [];
  if (/%(?![0-9a-fA-F]{2})/.test(query)) warnings.push("已忽略无效的观察名单配置值");
  const companyCatalog = new Set(stableWatchlistValues(catalog?.companyIds));
  const routeCatalog = new Set(stableWatchlistValues(catalog?.routes));
  const requestedCompanies = watchlistValuesFor(query, "watch", warnings);
  const requestedRoutes = watchlistValuesFor(query, "routes", warnings);
  const companies = requestedCompanies.filter((id) => companyCatalog.has(id));
  const routes = requestedRoutes.filter((slug) => canonicalWatchlistRouteSlugs.has(slug) && routeCatalog.has(slug));
  const missingCompanies = requestedCompanies.filter((id) => !companyCatalog.has(id));
  const missingRoutes = requestedRoutes.filter((slug) => !canonicalWatchlistRouteSlugs.has(slug) || !routeCatalog.has(slug));
  if (missingCompanies.length) warnings.push(`已忽略未知或已退出当前观察名单的公司：${missingCompanies.join("、")}`);
  if (companies.length > watchlistMaxCompanies) warnings.push(`公司选择超过 ${watchlistMaxCompanies} 个上限，已忽略其余项目`);
  if (missingRoutes.length) warnings.push(`已忽略未知技术路线：${missingRoutes.join("、")}`);
  if (routes.length > watchlistMaxRoutes) warnings.push(`路线选择超过 ${watchlistMaxRoutes} 个上限，已忽略其余项目`);
  return { config: { companyIds: companies.slice(0, watchlistMaxCompanies), routes: routes.slice(0, watchlistMaxRoutes) }, warnings };
}

function watchlistCatalog(value) {
  const cards = [...list(value?.forwardRadar), ...list(value?.validatedMomentum)];
  const usedRoutes = new Set(cards.flatMap((card) => list(card?.routes)));
  return {
    companyIds: stableWatchlistValues(cards.map((card) => card?.companyId)),
    routes: watchlistRouteSlugs.filter(({ route }) => usedRoutes.has(route)).map(({ slug }) => slug),
  };
}

function filterWatchlistCards(cards, config) {
  const companies = new Set(list(config?.companyIds));
  const routes = new Set(list(config?.routes));
  if (!companies.size && !routes.size) return list(cards);
  return list(cards).filter((card) => companies.has(card.companyId) || list(card.routes).some((route) => routes.has(watchlistRouteSlugByName.get(route))));
}

function watchlistControlMarkup(value, catalog, config) {
  const cards = [...list(value.forwardRadar), ...list(value.validatedMomentum)];
  const names = new Map(cards.map((card) => [card.companyId, card.companyName]));
  const companies = catalog.companyIds;
  const routes = watchlistRouteSlugs.filter(({ slug }) => catalog.routes.includes(slug));
  if (!companies.length && !routes.length) return {
    companies: '<p class="empty">当前快照没有可分享的公司或路线筛选；复制将保留当前页面。</p>',
    routes: "",
  };
  return {
    companies: `<fieldset><legend>当前公司</legend><div class="watchlist-option-grid">${companies.map((id, index) => `<label for="watchlist-company-${index}"><input id="watchlist-company-${index}" data-watchlist-company type="checkbox" value="${safe(id)}"${config.companyIds.includes(id) ? " checked" : ""}> ${safe(names.get(id) || id)}</label>`).join("")}</div></fieldset>`,
    routes: `<fieldset><legend>固定技术路线</legend><div class="watchlist-option-grid">${routes.map(({ route, slug }, index) => `<label for="watchlist-route-${index}"><input id="watchlist-route-${index}" data-watchlist-route type="checkbox" value="${safe(slug)}"${config.routes.includes(slug) ? " checked" : ""}> ${safe(route)}</label>`).join("")}</div></fieldset>`,
  };
}

function updateWatchlistUrl(config) {
  const query = encodeWatchlistConfig(config);
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function bindWatchlistControls(value, catalog) {
  const controls = byId("watchlist-config-controls");
  if (!controls || controls.dataset?.watchlistBound) return;
  if (controls.dataset) controls.dataset.watchlistBound = "true";
  const selected = () => ({
    companyIds: [...controls.querySelectorAll("[data-watchlist-company]:checked")].map((input) => input.value),
    routes: [...controls.querySelectorAll("[data-watchlist-route]:checked")].map((input) => input.value),
  });
  controls.addEventListener("change", () => {
    updateWatchlistUrl(selected());
    renderWatchlist(value);
  });
  controls.addEventListener("click", (event) => {
    if (event.target.closest("#watchlist-reset")) {
      updateWatchlistUrl({ companyIds: [], routes: [] });
      renderWatchlist(value);
    }
    if (event.target.closest("#watchlist-copy")) {
      const feedback = byId("watchlist-copy-feedback");
      const query = encodeWatchlistConfig(selected());
      const url = `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
      if (!navigator.clipboard?.writeText) {
        if (feedback) feedback.textContent = "无法访问剪贴板；请复制地址栏中的链接。";
        return;
      }
      Promise.resolve(navigator.clipboard?.writeText(url)).then(() => {
        if (feedback) feedback.textContent = "分享链接已复制。";
      }).catch(() => {
        if (feedback) feedback.textContent = "无法访问剪贴板；请复制地址栏中的链接。";
      });
    }
  });
}

function watchlistEvidence(item, companyName) {
  const links = list(item.evidenceLinks).filter((evidence) => evidence && typeof evidence === "object");
  if (!links.length) return '<span class="radar-muted">公开证据链接待同步</span>';
  return links.map((evidence) => {
    const title = evidence.title || "查看规范事件";
    const source = evidence.source || "公开来源";
    const grade = evidence.grade === "A" || evidence.grade === "B" ? evidence.grade : "B";
    const label = `打开 ${companyName} 证据：${title}（${source}，${grade}级）`;
    return `<a href="${safeUrl(evidence.url)}" target="_blank" rel="noopener noreferrer" aria-label="${safe(label)}">${safe(title)} <small>${safe(source)} · ${safe(grade)}级</small></a>`;
  }).join("");
}

function watchlistCard(item) {
  const companyName = text(item.companyName, "待识别公司");
  const validationPoints = list(item.nextValidationPoints);
  const falsifiers = list(item.falsifiers);
  return `<article class="watchlist-card" data-company-id="${safe(item.companyId)}">
    <header><div><p class="eyebrow">AI 研究判断</p><h4>${safe(companyName)}</h4></div><span class="watchlist-badge">${safe(item.lifecycleLabel || "等待验证")}</span></header>
    <dl class="watchlist-thesis">
      <div><dt>为什么现在值得看</dt><dd>${safe(item.whyNow || "公开判断正在同步。")}</dd></div>
      <div><dt>路线与依赖</dt><dd>${safe(item.routeAndDependencies || "依赖关系正在补证。")}</dd></div>
      <div><dt>下一验证点</dt><dd>${validationPoints.length ? validationPoints.map((point) => `<span>${safe(point.text || "待验证")}${point.dueAt ? ` <small>验证期限 ${safe(point.dueAt)}</small>` : ""}</span>`).join("") : "等待新的公开验证点"}</dd></div>
      <div><dt>反证条件</dt><dd>${falsifiers.length ? falsifiers.map((item) => `<span>${safe(item.text || "待补充")}</span>`).join("") : "反证条件正在同步"}</dd></div>
      <div><dt>资本证据</dt><dd>${safe(item.capital?.summary || "证据不足（不代表未融资）")}</dd></div>
    </dl>
    <div class="watchlist-evidence" aria-label="${safe(companyName)} 的规范证据">${watchlistEvidence(item, companyName)}</div>
  </article>`;
}

function renderWatchlistTrack(items, title, emptyMessage, identity) {
  const cards = list(items).filter((item) => item && typeof item === "object");
  const groups = watchlistGroups.map((group) => ({ ...group, cards: cards.filter((item) => item.group === group.value) }));
  if (!cards.length) return `<header class="watchlist-track-head"><div><p class="eyebrow">DUAL-TRACK WATCHLIST</p><h3>${safe(title)}</h3></div><small>${safe(identity)}</small></header><p class="empty">${safe(emptyMessage)}</p>`;
  return `<header class="watchlist-track-head"><div><p class="eyebrow">DUAL-TRACK WATCHLIST</p><h3>${safe(title)}</h3></div><small>${safe(identity)}</small></header>
    ${groups.filter((group) => group.cards.length).map((group) => `<section class="watchlist-group" aria-label="${safe(group.label)}"><h4>${safe(group.label)}</h4><div class="watchlist-track-grid">${group.cards.map(watchlistCard).join("")}</div></section>`).join("")}`;
}

function renderWatchlist(value) {
  const container = byId("company-watchlist");
  const controls = byId("watchlist-config-controls");
  const companyOptions = byId("watchlist-company-options");
  const routeOptions = byId("watchlist-route-options");
  const warning = byId("watchlist-config-warning");
  const copyFeedback = byId("watchlist-copy-feedback");
  const forward = byId("watchlist-forward");
  const momentum = byId("watchlist-momentum");
  const changes = byId("watchlist-changes");
  if (!container || !controls || !companyOptions || !routeOptions || !warning || !copyFeedback || !forward || !momentum || !changes) return;
  container.hidden = false;
  if (!validWatchlist(value)) {
    forward.innerHTML = '<p class="empty"><strong>Watchlist 数据未通过公开契约校验</strong>本次数据未被当作有效空快照展示，请等待下一次成功发布。</p>';
    momentum.innerHTML = "";
    changes.innerHTML = "";
    return;
  }
  const lastSuccessfulDate = text(value.lastSuccessfulAt).slice(0, 10);
  const identity = `最后成功快照：${value.week} · v${value.snapshotVersion} · ${lastSuccessfulDate}`;
  const catalog = watchlistCatalog(value);
  const decoded = decodeWatchlistConfig(window.location.search, catalog);
  const markup = watchlistControlMarkup(value, catalog, decoded.config);
  companyOptions.innerHTML = markup.companies;
  routeOptions.innerHTML = markup.routes;
  warning.textContent = decoded.warnings.join(" ");
  copyFeedback.textContent = "";
  bindWatchlistControls(value, catalog);
  const hasSelection = decoded.config.companyIds.length > 0 || decoded.config.routes.length > 0;
  forward.innerHTML = renderWatchlistTrack(filterWatchlistCards(value.forwardRadar, decoded.config), "前瞻雷达", `${value.week} 最后成功快照中，前瞻雷达暂无${hasSelection ? "符合当前筛选的" : ""}公开公司。`, identity);
  momentum.innerHTML = renderWatchlistTrack(filterWatchlistCards(value.validatedMomentum, decoded.config), "已验证动量", `${value.week} 最后成功快照中，已验证动量暂无${hasSelection ? "符合当前筛选的" : ""}公开公司。`, identity);
  const changeItems = list(value.changes).filter((item) => item && typeof item === "object");
  changes.innerHTML = `<header class="watchlist-track-head"><div><p class="eyebrow">WEEKLY CHANGES</p><h3>本周变化</h3></div><small>${safe(value.week)}</small></header>${changeItems.length ? `<ul>${changeItems.map((item) => `<li data-company-id="${safe(item.companyId)}"><strong>${safe(item.companyName || "待识别公司")}</strong><span class="watchlist-badge watchlist-badge--change">${safe(watchlistChangeLabels[item.change] || "状态变化")}</span></li>`).join("")}</ul>` : '<p class="empty">本周没有公开的名单变化。</p>'}`;
}

function renderCompanySection(data) {
  const container = byId("company-watchlist");
  const legacy = byId("company-boards");
  const legacyGrid = byId("company-board-grid");
  const hasWatchlist = Boolean(data) && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "watchlist");
  if (!hasWatchlist) {
    if (container) container.hidden = true;
    renderCompanyBoards(data?.companyBoards);
    return;
  }
  if (legacy) legacy.hidden = true;
  if (legacyGrid) legacyGrid.innerHTML = "";
  renderWatchlist(data.watchlist);
}

function renderCompanyRadar(items) {
  const route = byId("route-filter").value;
  const region = byId("region-filter").value;
  const status = byId("status-filter").value;
  const visible = list(items).filter((item) => (!route || item.routes.includes(route)) && (!region || item.region === region) && (!status || item.capitalStatus === status));
  byId("company-radar").innerHTML = visible.length ? visible.map((item) => `<article class="company-card">
    <div class="company-card-head"><a href="${safeUrl(item.officialUrl)}" target="_blank" rel="noopener noreferrer"><h3>${safe(item.name || "待识别公司")}</h3></a><span>${safe(item.region)} · ${safe(item.stage)}</span></div>
    <div class="momentum"><b>${safe(item.momentumLabel)}</b><span style="--momentum:${item.recentSignals ? item.momentumScore : 0}%"></span><small>${item.recentSignals ? `近 30 天 ${safe(item.recentSignals)} 条信号` : "样本不足 · 不展示精确分"}</small></div>
    <p>${safe(item.thesis || "公司技术路线与产业定位仍在补全。")}</p>
    <div class="route-tags">${item.routes.length ? item.routes.map((name) => `<span>${safe(name)}</span>`).join("") : "<span>路线待补全</span>"}</div>
    <dl><div><dt>资本</dt><dd class="${item.capitalStatus === "已证实" ? "verified" : ""}">${safe(item.capitalStatus === "证据不足" ? "证据不足（不代表未融资）" : item.capitalStatus)}</dd></div><div><dt>验证</dt><dd>${safe(item.validationStage)}</dd></div></dl>
    <div class="company-facts"><div><small>融资 / 并购</small>${compactFact(item.funding, "证据不足（不代表未融资）")}</div><div><small>产品 / 部署</small>${compactFact(item.progress, "尚未收录满足门槛的事件")}</div></div>
    <footer>主体证据：${safe(item.identitySource || "待补全")}${item.updatedAt ? ` · 更新 ${date(item.updatedAt)}` : ""}${item.claimCompleteness != null ? ` · 字段完整 ${Math.round(Number(item.claimCompleteness) * 100)}%` : ""}${Number(item.staleClaims) > 0 ? ` · ${safe(item.staleClaims)} 条证据过期` : ""}</footer>
  </article>`).join("") : '<p class="empty">当前筛选条件下暂无可公开展示的公司档案。</p>';
}

function inferredResearchRoute(paper) {
  const content = `${text(paper.title)} ${text(paper.summary)}`.toLowerCase();
  if (/world model|世界模型|spatial|3d/.test(content)) return "世界模型与空间智能";
  if (/vla|vision-language-action|具身|策略|policy/.test(content)) return "VLA 与具身模型";
  if (/data|dataset|benchmark|数据|训练/.test(content)) return "数据与训练";
  if (/humanoid|hardware|人形|本体/.test(content)) return "本体与硬件";
  return paper.route && paper.route !== "研究" ? paper.route : "机器人学习";
}

function researchGraph(data) {
  if (list(data.researchGraph).length) return data.researchGraph;
  return list(data.research).map((paper) => ({
    route: inferredResearchRoute(paper),
    paper,
    companies: [],
    connection: "研究卡已达到公开门槛，产业关联仍在持续补证。",
  }));
}

function renderResearchGraph(items) {
  byId("research-graph-grid").innerHTML = list(items).length ? list(items).map((item) => {
    const verifiedRelations = list(item.relations).filter((relation) => relation?.state === "verified");
    const hasVerifiedConnection = verifiedRelations.length > 0 || (list(item.companies).length > 0 && !list(item.relations).length && item.connectionState === "verified");
    return `<article class="research-link">
    <p class="eyebrow">${safe(item.route || "机器人学习")}</p>
    <h3><a href="${safeUrl(item.paper?.link)}" target="_blank" rel="noopener noreferrer">${safe(item.paper?.title || "未命名论文")}</a></h3>
    <p>${safe(item.paper?.summary || "查看论文原文了解研究方法与实验结论。")}</p>
    ${hasVerifiedConnection ? `<div class="graph-line"><span>论文</span><i aria-hidden="true">→</i><span>${safe(item.route || "机器人学习")}</span><i aria-hidden="true">→</i><span>${list(item.companies).map(safe).join(" · ")}</span></div>` : `<div class="graph-line graph-line--unverified"><span>产业关系尚未核验 · 不绘制连线</span></div>`}
    <small>${safe(item.connection || "持续追踪工程化与商业验证。")}${verifiedRelations.length ? ` · ${verifiedRelations.length} 条已核验关系` : ""}</small>
  </article>`;
  }).join("") : '<p class="empty">当前没有达到核验门槛的研究—产业关系；不绘制推断连线。</p>';
}

function setupCompanyRadar(items) {
  const companies = list(items).map(normalizedCompany);
  fillOptions("route-filter", companies.flatMap((item) => item.routes), "全部路线");
  fillOptions("region-filter", companies.map((item) => item.region), "全部区域");
  ["route-filter", "region-filter", "status-filter"].forEach((id) => byId(id).addEventListener("change", () => renderCompanyRadar(companies)));
  renderCompanyRadar(companies);
}

function render(data) {
  detailItems.clear();
  const stats = data.stats || fallback.stats;
  byId("event-count").textContent = text(stats.events, "0");
  byId("company-count").textContent = text(stats.companies, "0");
  byId("research-count").textContent = text(stats.research, "0");
  byId("source-count").textContent = text(stats.sources, "—");
  const generated = new Date(data.generatedAt);
  byId("updated").textContent = Number.isNaN(generated.getTime()) ? "UPDATE PENDING" : `UPDATED ${generated.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`;

  const topSignals = list(data.confirmedSignals).length ? data.confirmedSignals : (list(data.topSignals).length ? data.topSignals : list(data.keyEvents));
  byId("top-signals").innerHTML = topSignals.length ? topSignals.slice(0, 10).map(signalCard).join("") : '<p class="empty">正在接收满足公开门槛的验证信号…</p>';
  const renderedFacts = new Set(topSignals.map((item, index) => signalId(item, index)));
  const developingSignals = list(data.developingSignals).filter((item, index) => !renderedFacts.has(signalId(item, index))).slice(0, 5);
  byId("developing-signals").innerHTML = developingSignals.length ? developingSignals.map(developingCard).join("") : '<p class="empty">当前没有主体明确、达到单一可信来源门槛的新线索。</p>';
  renderFeed("capital", data.capital);
  renderFeed("industry", data.industry);
  renderResearchFeed(data.research);
  renderCompanySection(data);
  setupCompanyRadar(data.companyRadar);
  renderResearchGraph(researchGraph(data));
  const routes = list(data.routes);
  byId("routes-grid").innerHTML = routes.length ? routes.map((route, index) => `<article class="route-card"><span>${String(index + 1).padStart(2, "0")}</span><h3>${safe(route.name || "待命名路线")}</h3><p>${safe(route.focus || "路线定义与竞争焦点持续补全。")}</p><small>${list(route.companies).length ? list(route.companies).map(safe).join(" · ") : "持续扩充中"}</small></article>`).join("") : '<p class="empty">技术路线数据正在更新。</p>';
  const deepLinkedSignal = new URL(window.location.href).searchParams.get("signal");
  if (deepLinkedSignal && detailItems.has(deepLinkedSignal)) openDetail(deepLinkedSignal, null, { updateUrl: false });
}

function renderCommunity(data) {
  const community = data && typeof data === "object" ? data : {};
  const repository = community.repository && typeof community.repository === "object" ? community.repository : {};
  byId("community-stars").textContent = formattedCount(repository.stars);
  byId("community-forks").textContent = formattedCount(repository.forks);
  byId("community-watchers").textContent = formattedCount(repository.subscribers);
  byId("community-issues").textContent = formattedCount(repository.openIssues);

  const generated = new Date(community.generatedAt);
  byId("community-updated").textContent = Number.isNaN(generated.getTime())
    ? "社区数据待同步"
    : `同步 ${generated.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`;

  const traffic = community.traffic && typeof community.traffic === "object" ? community.traffic : {};
  const trafficMetrics = [traffic.views14d, traffic.uniqueVisitors14d, traffic.clones14d, traffic.uniqueCloners14d].map(finiteNumber);
  const hasTrafficMetrics = trafficMetrics.some((value) => value !== null);
  const trafficStatus = text(traffic.status).toLowerCase();
  const trafficUnavailable = ["unavailable", "disabled", "forbidden", "missing", "error"].includes(trafficStatus);
  const referrers = list(traffic.referrers).filter((item) => item && typeof item === "object").slice(0, 3);
  if (!trafficUnavailable && hasTrafficMetrics) {
    byId("community-traffic").innerHTML = `<div class="traffic-metrics"><div><strong>${formattedCount(traffic.views14d)}</strong><span>Views</span></div><div><strong>${formattedCount(traffic.uniqueVisitors14d)}</strong><span>Visitors</span></div><div><strong>${formattedCount(traffic.clones14d)}</strong><span>Clones</span></div><div><strong>${formattedCount(traffic.uniqueCloners14d)}</strong><span>Cloners</span></div></div>${referrers.length ? `<p class="traffic-referrers"><b>Top referrers</b> ${referrers.map((item) => safe(item.referrer || item.name || "未知来源")).join(" · ")}</p>` : ""}`;
  } else {
    const message = trafficUnavailable
      ? "GitHub Traffic 暂不可用（通常需要仓库管理员权限）；未将缺失数据计为 0。"
      : "GitHub Traffic 尚未同步；未将缺失数据计为 0。";
    byId("community-traffic").innerHTML = `<p class="community-unavailable">${safe(message)}</p>`;
  }

  const contributors = community.contributors && typeof community.contributors === "object" ? community.contributors : {};
  const codeCount = countOf(contributors.codeContributors);
  const evidenceCount = countOf(contributors.acceptedEvidenceContributors);
  const contributorCount = finiteNumber(contributors.count);
  byId("community-contributors").textContent = formattedCount(contributorCount);
  const contributorParts = [];
  if (codeCount !== null) contributorParts.push(`${formattedCount(codeCount)} 位代码贡献者`);
  if (evidenceCount !== null) contributorParts.push(`${formattedCount(evidenceCount)} 位已采纳证据贡献者`);
  byId("community-contributor-detail").textContent = contributorParts.length
    ? contributorParts.join(" · ")
    : "贡献者明细尚未同步；欢迎提交信源、证据与纠错。";
}

async function loadDashboard() {
  const localPath = "data/dashboard.json";
  const remotePath = "https://raw.githubusercontent.com/mbabby/physical-ai-news-cn/main/site/data/dashboard.json";
  const source = window.location.protocol === "file:" ? remotePath : localPath;
  try {
    const response = await fetch(`${source}${source.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("Dashboard data unavailable; rendering safe fallback.", error);
    return fallback;
  }
}

async function loadCommunity() {
  const localPath = "data/community.json";
  const remotePath = "https://raw.githubusercontent.com/mbabby/physical-ai-news-cn/main/site/data/community.json";
  const source = window.location.protocol === "file:" ? remotePath : localPath;
  try {
    const response = await fetch(`${source}${source.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("Community data unavailable; rendering explicit unavailable state.", error);
    return null;
  }
}

loadDashboard().then(render);
loadCommunity().then(renderCommunity);
