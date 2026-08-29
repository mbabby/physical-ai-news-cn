import "./decision-products-validator.js";

const root = document.getElementById("share-content");
const view = document.body.dataset.view;
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
const day = (value = "") => {
  const match = text(value).match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}` : "—";
};
const link = (url, label) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${safe(label || "查看原始来源")}</a>`;
const score = (value, fallbackValue = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallbackValue;
};
const validDecisionProducts = (value) => globalThis.DecisionProductsContract?.validate(value) === true;

function decisionArtifact(data) {
  if (!Object.prototype.hasOwnProperty.call(data || {}, "decisionProducts")) return undefined;
  return validDecisionProducts(data.decisionProducts) ? data.decisionProducts : null;
}

function invalidDecisionState(label) {
  root.innerHTML = `<p class="empty"><strong>Decision Product 数据未通过公开契约校验</strong>${safe(label)}已停止展示；这不是有效空状态。</p>`;
}

function topSignals(data) {
  return list(data.topSignals).length ? data.topSignals : list(data.keyEvents);
}

function weekly(data) {
  const artifact = decisionArtifact(data);
  if (artifact === null) return invalidDecisionState("Top Signals");
  const signals = artifact ? artifact.topSignals : topSignals(data).slice(0, 10);
  root.innerHTML = `<p class="share-intro">${safe(data.periodLabel || "近 30 天滚动窗口")} · 更新时间 ${safe(text(data.generatedAt).slice(0, 10) || "待同步")}。按证据、影响、时效与多源佐证综合排序，最多展示 10 条。</p>
    <div class="top-signals">${signals.map((item, index) => `<article class="top-signal" data-signal-id="${safe(item.signalId || "")}">
      <div class="signal-rank">${String(index + 1).padStart(2, "0")}</div>
      <div class="signal-copy"><div class="signal-badges"><span>${safe(item.kind || item.type || "已验证信号")}</span><span>${safe(item.evidenceState === "official" ? "官方一手" : item.evidenceState === "multi-source" ? "独立 B+B" : `证据 ${item.evidenceGrade || "B"}`)}</span></div>
      <h3>${artifact ? link(item.evidence[0]?.url, item.titleZh) : link(item.link, item.title)}</h3><p>${safe(artifact ? item.factsZh.join(" ") : item.summary || "查看原始证据了解详情。")}</p>
      ${artifact ? `<p><strong>排序依据</strong> ${item.rankReasons.map(safe).join(" · ")}</p><details><summary>证据与日期</summary><p>发生 ${safe(item.occurredAt)} · 核验 ${safe(item.verifiedAt)}</p><ul>${item.evidence.map((evidence) => `<li>${link(evidence.url, `${evidence.source} · ${evidence.grade}级`)}</li>`).join("")}</ul></details>` : ""}
      <footer><strong>为什么重要</strong> ${safe(item.whyItMatters || "该信号已通过公开展示门槛，值得持续跟踪。")} <i>${safe(item.entityName || item.entity || item.source || "公开来源")} · ${day(item.occurredAt || item.date)}</i></footer></div>
    </article>`).join("") || '<p class="empty">本周暂无达到公开门槛的信号。</p>'}</div>`;
}

function normalizedCompany(item) {
  const recentSignals = Number.isFinite(Number(item.recentSignals)) ? Number(item.recentSignals) : [item.funding, item.progress].filter(Boolean).length;
  const derivedScore = Math.min(88, recentSignals * 18 + (item.funding ? 22 : 0) + (item.progress ? 16 : 0));
  const momentumScore = score(item.momentumScore, derivedScore);
  return {
    ...item,
    routes: list(item.routes),
    recentSignals,
    momentumScore,
    momentumLabel: item.momentumLabel || (momentumScore >= 65 ? "高动量" : momentumScore >= 35 ? "升温" : "持续跟踪"),
    capitalStatus: item.capitalStatus || "证据不足",
  };
}

const watchlistGroups = [
  { value: "priority-focus", label: "重点关注" },
  { value: "continued-observation", label: "持续观察" },
];
const watchlistChangeLabels = { added: "新进入名单", strengthened: "判断强化", downgraded: "判断降级", exited: "退出名单" };
const periodChangeLabels = { addition: "新进入名单", strengthening: "判断强化", "awaiting-validation": "转为等待验证", downgrade: "判断降级", exit: "退出名单", correction: "公开判断修正" };
const privateWatchlistText = /\b(?:score|rank)\b|(?:internal|selection|momentum)[_-]?(?:score|rank)\b|分数|排名|内部诊断|候选(?:ID|标识)/i;

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const validValidationDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const watchlistRoutes = ["数据与训练", "VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "部署与商业化"];
const validWatchlistRoutes = (value) => Array.isArray(value) && value.length > 0
  && value.every((route) => watchlistRoutes.includes(route))
  && new Set(value).size === value.length
  && value.every((route, index) => index === 0 || value[index - 1] < route);

function validWatchlistCard(item, track) {
  return Boolean(item) && typeof item === "object"
    && nonEmpty(item.companyId) && nonEmpty(item.companyName) && item.track === track
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
  return Boolean(value) && typeof value === "object"
    && Boolean(week) && Number(week[1]) >= 1 && Number(week[1]) <= 53
    && typeof value.snapshotVersion === "number" && Number.isInteger(value.snapshotVersion) && value.snapshotVersion > 0
    && nonEmpty(value.methodologyVersion)
    && typeof value.lastSuccessfulAt === "string" && Number.isFinite(Date.parse(value.lastSuccessfulAt))
    && Array.isArray(value.companyIds) && value.companyIds.every(nonEmpty)
    && Array.isArray(value.forwardRadar) && value.forwardRadar.every((item) => validWatchlistCard(item, "forward-radar"))
    && Array.isArray(value.validatedMomentum) && value.validatedMomentum.every((item) => validWatchlistCard(item, "validated-momentum"))
    && Array.isArray(value.changes) && value.changes.every((item) => item && typeof item === "object" && nonEmpty(item.companyId) && nonEmpty(item.companyName) && ["added", "strengthened", "downgraded", "exited"].includes(item.change));
}

function watchlistEvidence(item, companyName) {
  const evidence = list(item.evidenceLinks).filter((entry) => entry && typeof entry === "object");
  if (!evidence.length) return '<span class="radar-muted">公开证据链接待同步</span>';
  return evidence.map((entry) => {
    const title = entry.title || "查看规范事件";
    const source = entry.source || "公开来源";
    const grade = entry.grade === "A" || entry.grade === "B" ? entry.grade : "B";
    return `<a href="${safeUrl(entry.url)}" target="_blank" rel="noopener noreferrer" aria-label="${safe(`打开 ${companyName} 证据：${title}（${source}，${grade}级）`)}">${safe(title)} <small>${safe(source)} · ${safe(grade)}级</small></a>`;
  }).join("");
}

function watchlistCard(item) {
  const companyName = text(item.companyName, "待识别公司");
  return `<article class="watchlist-card" data-company-id="${safe(item.companyId)}"><header><div><p class="eyebrow">AI 研究判断</p><h4>${safe(companyName)}</h4></div><span class="watchlist-badge">${safe(item.lifecycleLabel || "等待验证")}</span></header>
    <dl class="watchlist-thesis"><div><dt>为什么现在值得看</dt><dd>${safe(item.whyNow || "公开判断正在同步。")}</dd></div><div><dt>路线与依赖</dt><dd>${safe(item.routeAndDependencies || "依赖关系正在补证。")}</dd></div><div><dt>下一验证点</dt><dd>${list(item.nextValidationPoints).length ? list(item.nextValidationPoints).map((point) => `<span>${safe(point.text || "待验证")}${point.dueAt ? ` <small>验证期限 ${safe(point.dueAt)}</small>` : ""}</span>`).join("") : "等待新的公开验证点"}</dd></div><div><dt>反证条件</dt><dd>${list(item.falsifiers).length ? list(item.falsifiers).map((entry) => `<span>${safe(entry.text || "待补充")}</span>`).join("") : "反证条件正在同步"}</dd></div><div><dt>资本证据</dt><dd>${safe(item.capital?.summary || "证据不足（不代表未融资）")}</dd></div></dl>
    <div class="watchlist-evidence" aria-label="${safe(companyName)} 的规范证据">${watchlistEvidence(item, companyName)}</div></article>`;
}

function watchlistTrack(items, title, emptyMessage, identity) {
  const cards = list(items).filter((item) => item && typeof item === "object");
  if (!cards.length) return `<section class="watchlist-track"><header class="watchlist-track-head"><h3>${safe(title)}</h3><small>${safe(identity)}</small></header><p class="empty">${safe(emptyMessage)}</p></section>`;
  return `<section class="watchlist-track"><header class="watchlist-track-head"><h3>${safe(title)}</h3><small>${safe(identity)}</small></header>${watchlistGroups.map((group) => ({ ...group, cards: cards.filter((card) => card.group === group.value) })).filter((group) => group.cards.length).map((group) => `<section class="watchlist-group" aria-label="${safe(group.label)}"><h4>${safe(group.label)}</h4><div class="watchlist-track-grid">${group.cards.map(watchlistCard).join("")}</div></section>`).join("")}</section>`;
}

function watchlistShare(value) {
  if (!validWatchlist(value)) return '<section class="company-watchlist"><h2>公司 Watchlist</h2><p class="empty"><strong>Watchlist 数据未通过公开契约校验</strong>本次数据未被当作有效空快照展示，请等待下一次成功发布。</p></section>';
  const identity = `最后成功快照：${value.week} · v${value.snapshotVersion} · ${text(value.lastSuccessfulAt).slice(0, 10)}`;
  const changes = list(value.changes).filter((item) => item && typeof item === "object");
  return `<section class="company-watchlist"><header class="watchlist-share-head"><div><p class="eyebrow">DUAL-TRACK WATCHLIST</p><h2>公司 Watchlist</h2></div><small>${safe(identity)}</small></header>
    ${watchlistTrack(value.forwardRadar, "前瞻雷达", `${value.week} 最后成功快照中，前瞻雷达暂无公开公司。`, identity)}
    ${watchlistTrack(value.validatedMomentum, "已验证动量", `${value.week} 最后成功快照中，已验证动量暂无公开公司。`, identity)}
    <section class="watchlist-changes"><header class="watchlist-track-head"><h3>本周变化</h3><small>${safe(value.week)}</small></header>${changes.length ? `<ul>${changes.map((item) => `<li data-company-id="${safe(item.companyId)}"><strong>${safe(item.companyName || "待识别公司")}</strong><span class="watchlist-badge watchlist-badge--change">${safe(watchlistChangeLabels[item.change] || "状态变化")}</span></li>`).join("")}</ul>` : '<p class="empty">本周没有公开的名单变化。</p>'}</section></section>`;
}

function companyDossiers(data, showMomentum) {
  const companies = list(data.companyRadar).map(normalizedCompany).sort((a, b) => b.momentumScore - a.momentumScore).slice(0, 18);
  return `<p class="share-intro">资本状态不明不等于未融资。这里按近 30 天可归属事件、资本证据与产品验证阶段计算动量。</p>
    <div class="company-radar">${companies.map((item) => `<article class="company-card">
      <div class="company-card-head"><h3>${link(item.officialUrl, item.name || "待识别公司")}</h3><span>${safe(item.region || "区域待补全")} · ${safe(item.stage || "阶段待补全")}</span></div>
      ${showMomentum ? `<div class="momentum"><b>${safe(item.momentumLabel)}</b><span style="--momentum:${item.momentumScore}%"></span><small>${item.momentumScore}/100 · 30D ${safe(item.recentSignals)} 条</small></div>` : ""}
      <p>${safe(item.thesis || "公司技术路线与产业定位仍在补全。")}</p>
      <div class="route-tags">${item.routes.length ? item.routes.map((route) => `<span>${safe(route)}</span>`).join("") : "<span>路线待补全</span>"}</div>
      <dl><div><dt>资本</dt><dd>${safe(item.capitalStatus === "证据不足" ? "证据不足（不代表未融资）" : item.capitalStatus)}</dd></div><div><dt>验证</dt><dd>${safe(item.validationStage || "证据不足")}</dd></div></dl>
      <div class="company-facts"><div><small>最近资本事件</small>${item.funding?.link ? link(item.funding.link, item.funding.title) : '<span class="radar-muted">尚未收录可归属公开证据</span>'}</div><div><small>最近产品 / 部署</small>${item.progress?.link ? link(item.progress.link, item.progress.title) : '<span class="radar-muted">尚无满足门槛的事件</span>'}</div></div>
    </article>`).join("") || '<p class="empty">公司档案正在同步。</p>'}</div>`;
}

function companies(data) {
  const artifact = decisionArtifact(data);
  if (artifact === null) return invalidDecisionState("公司卡");
  if (artifact) {
    root.innerHTML = `<p class="share-intro">五个答案均来自同一已校验决策产品；unknown 不代表否定。</p><div class="company-radar">${artifact.companyCards.map((item) => `<article class="company-card" id="${safe(item.cardId)}" data-card-id="${safe(item.cardId)}"><div class="company-card-head"><h3>${link(item.officialUrl, item.companyName)}</h3><span>${safe(item.region)} · ${safe(item.stage)}</span></div><p>${safe(item.routes.join(" · "))}</p><dl><div><dt>资本</dt><dd>${safe(item.capital.summary)}</dd></div><div><dt>验证阶段</dt><dd>${safe(item.validationStage)}</dd></div><div><dt>产品 / 部署</dt><dd>${safe(item.productDeployment.summary)}</dd></div><div><dt>近期变化</dt><dd>${safe(item.recentChanges.map((change) => change.title).join(" · ") || "unknown")}</dd></div><div><dt>下一验证</dt><dd>${safe(item.watchlist.nextValidationPoints.map((point) => point.text).join(" · ") || "unknown")}</dd></div></dl><details><summary>字段与证据</summary><p>未知字段：${safe(item.unknownFields.join(" · ") || "无")}</p><ul>${[...item.capital.evidence, ...item.productDeployment.evidence].map((evidence) => `<li>${link(evidence.url, `${evidence.source} · ${evidence.grade}级`)}</li>`).join("") || "<li>公开证据待补充</li>"}</ul></details></article>`).join("") || '<p class="empty">当前没有通过公开契约的公司卡。</p>'}</div>`;
    return;
  }
  const hasWatchlist = Boolean(data) && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "watchlist");
  if (!hasWatchlist) {
    root.innerHTML = companyDossiers(data, true);
    return;
  }
  root.innerHTML = `${watchlistShare(data.watchlist)}<section class="company-dossiers"><h2>公司档案</h2>${companyDossiers(data, false)}</section>`;
}

function validChangeIdentity(value) {
  const canonicalTimestamp = (timestamp) => {
    if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)) return false;
    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed)) return false;
    const normalized = new Date(parsed).toISOString();
    return normalized === timestamp || normalized === timestamp.replace("Z", ".000Z");
  };
  return Boolean(value) && typeof value === "object" && Object.keys(value).length === 3
    && typeof value.week === "string" && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value.week)
    && Number.isInteger(value.snapshotVersion) && value.snapshotVersion > 0
    && canonicalTimestamp(value.generatedAt);
}

function validChangeEvidence(value) {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 5 || !nonEmpty(value.eventId) || !nonEmpty(value.title) || !nonEmpty(value.url) || !nonEmpty(value.source) || !["A", "B"].includes(value.grade)) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validChangePage(value) {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 5 || value.schemaVersion !== 1
    || !validChangeIdentity(value.current) || (value.baseline !== null && !validChangeIdentity(value.baseline))
    || typeof value.emptyBaseline !== "boolean" || value.emptyBaseline !== (value.baseline === null)
    || !Array.isArray(value.changes) || (value.emptyBaseline && value.changes.length)) return false;
  const ids = new Set();
  return value.changes.every((item, index) => item && typeof item === "object" && Object.keys(item).length === 6
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.companyId) && !ids.has(item.companyId) && (ids.add(item.companyId) || true)
    && (!index || value.changes[index - 1].companyId < item.companyId)
    && nonEmpty(item.companyName) && typeof item.kind === "string" && Object.hasOwn(periodChangeLabels, item.kind) && nonEmpty(item.whatChanged) && nonEmpty(item.why)
    && Array.isArray(item.evidenceLinks) && item.evidenceLinks.length && item.evidenceLinks.every(validChangeEvidence)
    && !privateWatchlistText.test(`${item.companyId}\n${item.companyName}\n${item.whatChanged}\n${item.why}\n${item.evidenceLinks.map((link) => `${link.eventId}\n${link.title}\n${link.url}\n${link.source}`).join("\n")}`));
}

function periodEvidence(links) {
  return links.map((item) => `<li>${link(item.url, item.title)} <small>${safe(item.source)} · ${safe(item.grade)}级</small></li>`).join("");
}

function changes(data) {
  if (!validChangePage(data)) {
    root.innerHTML = '<p class="empty"><strong>变化数据未通过公开契约校验</strong>本次数据不会作为有效空状态展示，请等待下一次成功发布。</p>';
    return;
  }
  const current = `${data.current.week} · v${data.current.snapshotVersion}`;
  if (data.emptyBaseline) {
    root.innerHTML = `<section class="watchlist-changes"><header class="watchlist-track-head"><h2>Watchlist 周期变化</h2><small>当前：${safe(current)}</small></header><p class="empty">这是首个公开 Watchlist 快照；没有可比较的上一期基线，因此暂无变化列表。</p></section>`;
    return;
  }
  const baseline = `${data.baseline.week} · v${data.baseline.snapshotVersion}`;
  root.innerHTML = `<section class="watchlist-changes"><header class="watchlist-track-head"><div><p class="eyebrow">ADJACENT IMMUTABLE SNAPSHOTS</p><h2>Watchlist 周期变化</h2></div><small>当前：${safe(current)}<br>基线：${safe(baseline)}</small></header>${data.changes.length ? `<div class="watchlist-track-grid">${data.changes.map((item) => `<article class="watchlist-card" data-company-id="${safe(item.companyId)}"><header><div><h3>${safe(item.companyName)}</h3><p class="eyebrow">${safe(periodChangeLabels[item.kind])}</p></div></header><dl class="watchlist-thesis"><div><dt>发生了什么变化</dt><dd>${safe(item.whatChanged)}</dd></div><div><dt>为什么变化</dt><dd>${safe(item.why)}</dd></div></dl><div class="watchlist-evidence"><strong>规范证据</strong><ul>${periodEvidence(item.evidenceLinks)}</ul></div></article>`).join("")}</div>` : '<p class="empty">相邻公开快照之间没有可由规范证据支持的变化。</p>'}</section>`;
}

function inferredResearchRoute(paper) {
  const content = `${text(paper.title)} ${text(paper.summary)}`.toLowerCase();
  if (/world model|世界模型|spatial|3d/.test(content)) return "世界模型与空间智能";
  if (/vla|vision-language-action|具身|策略|policy/.test(content)) return "VLA 与具身模型";
  if (/data|dataset|benchmark|数据|训练/.test(content)) return "数据与训练";
  if (/humanoid|hardware|人形|本体/.test(content)) return "本体与硬件";
  return paper.route && paper.route !== "研究" ? paper.route : "机器人学习";
}

function researchItems(data) {
  if (list(data.researchGraph).length) return data.researchGraph;
  return list(data.research).map((paper) => ({
    route: inferredResearchRoute(paper),
    paper,
    companies: [],
    connection: "研究卡已达到公开门槛，产业关联仍在持续补证。",
  }));
}

function research(data) {
  const artifact = decisionArtifact(data);
  if (artifact === null) return invalidDecisionState("研究护照");
  if (artifact) {
    root.innerHTML = `<p class="share-intro">Passport 标签、缺口与资产均来自同一已校验决策产品。</p><div class="research-graph-grid">${artifact.researchPassports.map((item) => `<article class="research-link" id="${safe(item.passportId)}" data-passport-id="${safe(item.passportId)}"><p class="eyebrow">REPRODUCIBILITY PASSPORT</p><h3>${link(item.sourceUrl, item.titleZh)}</h3><p>${safe(item.factsZh.join(" "))}</p><div class="decision-tags"><span>任务 ${safe(Array.isArray(item.task) ? item.task.join(" · ") : item.task)}</span><span>本体 ${safe(Array.isArray(item.embodiment) ? item.embodiment.join(" · ") : item.embodiment)}</span><span>基准 ${safe(item.benchmark.name)}</span><span>实机 ${safe(item.realRobotTrials)}</span><span>成本 ${safe(item.reproducibilityCost.level)}</span></div><details><summary>缺口与复现资产</summary><p>OpenAlex ${link(`https://openalex.org/${item.authority.openAlexWorkId}`, item.authority.openAlexWorkId)}</p><p>缺口：${safe(item.gaps.join(" · ") || "无")}</p><p>代码 ${safe(item.assets.code)} · 数据 ${safe(item.assets.data)} · 权重 ${safe(item.assets.weights)}</p></details></article>`).join("") || '<p class="empty">当前没有通过公开契约的研究护照。</p>'}</div>`;
    return;
  }
  const items = researchItems(data).slice(0, 12);
  root.innerHTML = `<p class="share-intro">论文不是孤立列表：每张卡连接到主要技术路线及同路线公司，便于继续追踪工程化与商业验证。</p>
    <div class="research-graph-grid">${items.map((item) => `<article class="research-link">
      <p class="eyebrow">${safe(item.route || "机器人学习")}</p><h3>${link(item.paper?.link, item.paper?.title || "未命名论文")}</h3>
      <p>${safe(item.paper?.summary || "查看论文原文了解研究方法与实验结论。")}</p>
      <div class="graph-line"><span>论文</span><i aria-hidden="true">→</i><span>${safe(item.route || "机器人学习")}</span><i aria-hidden="true">→</i><span>${list(item.companies).length ? list(item.companies).map(safe).join(" · ") : "产业关联待补证"}</span></div>
      <small>${safe(item.connection || "持续追踪工程化与商业验证。")}</small>
    </article>`).join("") || '<p class="empty">研究卡正在同步。</p>'}</div>`;
}

async function loadDashboard() {
  const localPath = "data/dashboard.json";
  const remotePath = "https://raw.githubusercontent.com/mbabby/physical-ai-news-cn/main/site/data/dashboard.json";
  const source = window.location.protocol === "file:" ? remotePath : localPath;
  const response = await fetch(`${source}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadChanges() {
  const localPath = "data/watchlist-changes.json";
  const remotePath = "https://raw.githubusercontent.com/mbabby/physical-ai-news-cn/main/site/data/watchlist-changes.json";
  const source = window.location.protocol === "file:" ? remotePath : localPath;
  const response = await fetch(`${source}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const views = { weekly, companies, research };
const load = view === "changes" ? loadChanges : loadDashboard;
const renderer = view === "changes" ? changes : (views[view] || weekly);
load().then(renderer).catch((error) => {
  console.warn("Share-page data unavailable.", error);
  root.innerHTML = '<p class="empty">数据暂时不可用。若正在本地预览，请检查网络后刷新；线上页面会在下一次日报成功后自动恢复。</p>';
});
