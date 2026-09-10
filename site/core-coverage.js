const REGIONS = new Set(["all", "china", "north-america", "other"]);
const TIERS = new Set(["all", "commercial", "platform", "strategic"]);
const ROUTES = new Set(["all", "数据与训练", "VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "部署与商业化"]);
const CAPITAL = new Set(["all", "verified", "evidence-insufficient"]);
const VALIDATION = new Set(["all", "production", "deployment", "product", "unknown"]);
const SORTS = new Set(["name", "recent"]);
const REGION_LABELS = { china: "中国", "north-america": "北美", other: "其他地区" };
const TIER_LABELS = { commercial: "商业主体", platform: "技术平台 / 实验室", strategic: "战略产业主体" };
const TIER_ORDER = ["commercial", "platform", "strategic"];

const list = (value) => Array.isArray(value) ? value : [];
const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value : fallback;
const safe = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const compare = (left, right) => left === right ? 0 : left < right ? -1 : 1;

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function selectToken(params, key, allowed) {
  const value = params.get(key);
  return value && allowed.has(value) ? value : "all";
}

export function decodeCoreCoverageFilters(search = "") {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  return {
    region: selectToken(params, "region", REGIONS),
    tier: selectToken(params, "tier", TIERS),
    route: selectToken(params, "route", ROUTES),
    capital: selectToken(params, "capital", CAPITAL),
    validation: selectToken(params, "validation", VALIDATION),
    sort: SORTS.has(params.get("sort")) ? params.get("sort") : "name",
  };
}

export function sortCoreCoverageEntries(entries, sort = "name") {
  return [...entries].sort((left, right) => {
    if (sort === "recent") {
      const leftDate = left.brief.lastMaterialChangeAt;
      const rightDate = right.brief.lastMaterialChangeAt;
      if (leftDate === "unknown" && rightDate !== "unknown") return 1;
      if (leftDate !== "unknown" && rightDate === "unknown") return -1;
      if (leftDate !== rightDate) return compare(rightDate, leftDate);
    }
    return compare(text(left.subject.name).normalize("NFKC"), text(right.subject.name).normalize("NFKC"))
      || compare(left.subject.companyId, right.subject.companyId);
  });
}

function noPrivateKeys(value) {
  if (!value || typeof value !== "object") return true;
  if (Object.keys(value).some((key) => /(?:ownerRole|private|internal|score|rank)/i.test(key))) return false;
  return Object.values(value).every(noPrivateKeys);
}

function validArtifact(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || !noPrivateKeys(value)
    || !value.coverage || !Array.isArray(value.coverage.members) || !Array.isArray(value.subjects) || !Array.isArray(value.briefs)
    || value.coverage.members.length !== 30 || value.subjects.length !== 30 || value.briefs.length !== 30
    || !value.windows || !/^\d{4}-\d{2}-\d{2}$/.test(value.windows.backfillStart) || !/^\d{4}-\d{2}-\d{2}$/.test(value.windows.currentStart) || !/^\d{4}-\d{2}-\d{2}$/.test(value.windows.through)
    || !value.metrics || !Number.isInteger(value.metrics.coveredSubjects) || !Number.isInteger(value.metrics.completeBriefs)
    || value.metrics.coverageRatio !== value.metrics.completeBriefs / 30) return false;
  const ids = value.coverage.members.map((member) => member?.companyId);
  if (new Set(ids).size !== 30 || value.subjects.some((subject, index) => subject?.companyId !== ids[index] || !text(subject.name) || !safeUrl(subject.officialUrl))
    || value.briefs.some((brief, index) => brief?.companyId !== ids[index] || !["coverage-only", "complete"].includes(brief.completeness)
      || !Array.isArray(brief.knownFacts) || brief.knownFacts.some((fact) => typeof fact?.materialChangeAt !== "string")
      || !Array.isArray(brief.analyses) || !Array.isArray(brief.gapsZh))) return false;
  const covered = value.briefs.filter((brief) => list(brief.identityEvidence).length).length;
  const complete = value.briefs.filter((brief) => brief.completeness === "complete").length;
  return value.metrics.coveredSubjects === covered && value.metrics.completeBriefs === complete;
}

function validHistory(history, artifact) {
  return history && typeof history === "object" && history.schemaVersion === 1 && history.generatedAt === artifact.generatedAt
    && Array.isArray(history.versions) && Array.isArray(history.corrections)
    && history.versions.some((version) => JSON.stringify(version) === JSON.stringify(artifact.coverage));
}

function fieldValues(brief, keys) {
  return brief.knownFacts.flatMap((fact) => keys.flatMap((key) => {
    const field = fact.fields?.[key];
    if (!field || field.status !== "verified") return [];
    return list(field.value).length ? field.value : [field.value];
  })).filter((value) => typeof value === "string" && value.trim());
}

function capitalState(brief) {
  return fieldValues(brief, ["round", "amount", "valuation", "investors"]).length ? "verified" : "evidence-insufficient";
}

function validationState(brief) {
  if (fieldValues(brief, ["productionStage"]).length) return "production";
  if (fieldValues(brief, ["deployment"]).length) return "deployment";
  if (fieldValues(brief, ["product"]).length) return "product";
  return "unknown";
}

function inWindow(day, from, through) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= from && day <= through;
}

function fieldEvidence(fact) {
  const seen = new Set();
  return Object.values(fact.fields || {}).flatMap((field) => list(field?.evidenceUrls).flatMap((url, index) => {
    const href = safeUrl(url);
    if (!href || seen.has(href)) return [];
    seen.add(href);
    return [{ href, id: list(field.evidenceIds)[index] || list(field.evidenceIds)[0] || "公开证据" }];
  }));
}

function factRow(fact, dateLabel, date) {
  const evidence = fieldEvidence(fact);
  return `<li data-fact-id="${safe(fact.claimId)}"><strong>${safe(dateLabel)}：${safe(date)}</strong><span>${safe(fact.summaryZh)}</span>${evidence.length ? `<span class="core-evidence-links">${evidence.map((item) => `<a href="${safe(item.href)}" target="_blank" rel="noopener noreferrer">${safe(item.id)} ↗</a>`).join("")}</span>` : ""}</li>`;
}

function datedRows(brief, key, label, from, through) {
  return brief.knownFacts.flatMap((fact) => inWindow(fact[key], from, through) ? [{ fact, date: fact[key], label }] : [])
    .sort((left, right) => compare(right.date, left.date) || compare(left.fact.claimId, right.fact.claimId));
}

function timelineRows(brief, from, through) {
  return brief.knownFacts.flatMap((fact) => {
    if (inWindow(fact.occurredOn, from, through)) return [{ fact, date: fact.occurredOn, label: "事件日期" }];
    if (inWindow(fact.publishedOn, from, through)) return [{ fact, date: fact.publishedOn, label: "披露日期" }];
    return [];
  }).sort((left, right) => compare(right.date, left.date) || compare(left.fact.claimId, right.fact.claimId));
}

function card(entry, windows) {
  const { subject, member, brief } = entry;
  const isLab = subject.entityType === "实验室" || member.tier === "platform";
  const capital = Object.entries({ round: "轮次", amount: "融资金额", valuation: "估值", investors: "投资方" })
    .flatMap(([key, label]) => fieldValues(brief, [key]).map((value) => `${label}：${value}`));
  const stage = fieldValues(brief, ["productionStage", "deployment", "product"]);
  const currentOccurred = datedRows(brief, "occurredOn", "事件日期", windows.currentStart, windows.through);
  const currentDisclosed = datedRows(brief, "publishedOn", "披露日期", windows.currentStart, windows.through);
  const timeline = timelineRows(brief, windows.backfillStart, windows.through);
  const identity = list(brief.identityEvidence);
  const official = safeUrl(subject.officialUrl);
  return `<article class="core-card" id="company-${safe(subject.companyId)}" data-company-id="${safe(subject.companyId)}">
    <header><div><h2><a href="${safe(official)}" target="_blank" rel="noopener noreferrer">${safe(subject.name)}</a></h2></div><span class="core-completeness core-completeness--${safe(brief.completeness)}">${brief.completeness === "complete" ? "完整 Brief" : "覆盖卡 · 待补证"}</span></header>
    <p class="core-positioning">${safe(brief.positioningZh)}</p>
    <div class="core-tags"><span>${safe(REGION_LABELS[member.coverageRegion] || member.coverageRegion)}</span><span>${safe(TIER_LABELS[member.tier] || member.tier)}</span>${list(subject.routes).map((route) => `<span>${safe(route)}</span>`).join("")}</div>
    <dl class="core-fact-grid"><div><dt>${isLab ? "研究资源 / 资本" : "资本证据"}</dt><dd>${capital.length ? safe(capital.join(" · ")) : isLab ? "研究主体不要求创业融资证据；现有页面仅陈列直接核验的研究资源与研究产出证据。" : "现有证据不足以得出资本结论，不代表未融资。"}</dd></div><div><dt>产品验证阶段</dt><dd>${stage.length ? safe(stage.join(" · ")) : "现有证据不足以得出验证阶段结论。"}</dd></div><div><dt>最近实质变化</dt><dd>${safe(brief.lastMaterialChangeAt === "unknown" ? "日期未知" : brief.lastMaterialChangeAt)}</dd></div><div><dt>主体证据</dt><dd>${identity.length ? `${identity.length} 项已核验` : "身份专项证据待补充"}</dd></div></dl>
    <details><summary>打开 30 秒 Brief 与 12 个月时间线</summary>
      <section class="core-window"><h3>近 90 天发生</h3>${currentOccurred.length ? `<ul>${currentOccurred.map((row) => factRow(row.fact, row.label, row.date)).join("")}</ul>` : '<p class="empty">没有具备明确事件日期的合格事实；不代表没有进展。</p>'}</section>
      <section class="core-window"><h3>近 90 天披露</h3>${currentDisclosed.length ? `<ul>${currentDisclosed.map((row) => factRow(row.fact, row.label, row.date)).join("")}</ul>` : '<p class="empty">没有具备明确披露日期的合格事实。</p>'}</section>
      <section class="core-window"><h3>12 个月时间线</h3>${timeline.length ? `<ul>${timeline.map((row) => factRow(row.fact, row.label, row.date)).join("")}</ul>` : '<p class="empty">当前 12 个月窗口内没有满足门槛且日期明确的事实。</p>'}</section>
      <section class="core-analysis"><h3>研究分析</h3>${brief.analyses.length ? brief.analyses.map((analysis) => `<article data-analysis-id="${safe(analysis.id)}"><p>${safe(analysis.textZh)}</p><p><strong>局限</strong> ${safe(analysis.limitationZh)}</p><p><strong>下一验证</strong> ${safe(analysis.nextValidationZh)}</p><small>依赖事实：${analysis.claimIds.map(safe).join(" · ")}</small></article>`).join("") : '<p class="empty">缺少与当前核验事实一致的已批准中文分析。</p>'}</section>
      <section class="core-evidence"><h3>直接证据</h3>${identity.length ? `<ul>${identity.map((proof) => `<li><a href="${safe(safeUrl(proof.link))}" target="_blank" rel="noopener noreferrer">${safe(proof.source)} ↗</a><span>${safe(proof.supports)}</span></li>`).join("")}</ul>` : '<p class="empty">官方主体身份证据尚不可用。</p>'}</section>
      <section class="core-gaps"><h3>证据缺口</h3>${brief.gapsZh.length ? `<ul>${brief.gapsZh.map((gap) => `<li>${safe(gap)}</li>`).join("")}</ul>` : '<p class="empty">当前没有额外公开缺口。</p>'}</section>
    </details>
  </article>`;
}

function option(value, label, current) {
  return `<option value="${safe(value)}"${current === value ? " selected" : ""}>${safe(label)}</option>`;
}

function filtersForm(filters) {
  return `<form class="core-filters" id="core-filters" aria-label="Core 30 筛选"><label>覆盖地区<select name="region">${option("all", "全部", filters.region)}${option("china", "中国", filters.region)}${option("north-america", "北美", filters.region)}${option("other", "其他地区", filters.region)}</select></label><label>比较层级<select name="tier">${option("all", "全部", filters.tier)}${option("commercial", "商业", filters.tier)}${option("platform", "平台 / 实验室", filters.tier)}${option("strategic", "战略", filters.tier)}</select></label><label>技术路线<select name="route">${["all", ...[...ROUTES].filter((item) => item !== "all")].map((value) => option(value, value === "all" ? "全部" : value, filters.route)).join("")}</select></label><label>资本证据<select name="capital">${option("all", "全部", filters.capital)}${option("verified", "有已核验字段", filters.capital)}${option("evidence-insufficient", "现有证据不足", filters.capital)}</select></label><label>验证阶段<select name="validation">${option("all", "全部", filters.validation)}${option("production", "已核验阶段字段", filters.validation)}${option("deployment", "已核验部署字段", filters.validation)}${option("product", "已核验产品 / 研究产出", filters.validation)}${option("unknown", "证据不足", filters.validation)}</select></label><label>排序<select name="sort">${option("name", "名称 + ID", filters.sort)}${option("recent", "最近实质变化", filters.sort)}</select></label></form>`;
}

function historySection(history, artifact) {
  const names = new Map(artifact.subjects.map((subject) => [subject.companyId, subject.name]));
  const versions = history.versions.map((version, index) => {
    const previous = history.versions[index - 1];
    const previousIds = new Set(list(previous?.members).map((member) => member.companyId));
    const currentIds = new Set(version.members.map((member) => member.companyId));
    const added = version.members.filter((member) => !previousIds.has(member.companyId));
    const exited = list(previous?.members).filter((member) => !currentIds.has(member.companyId));
    return `<article><h3>${safe(version.version)} · ${safe(version.effectiveFrom)}</h3><p>${safe(version.changeReasonZh)}</p>${index === 0 ? '<p>首个公开覆盖基线，不倒签更早季度。</p>' : `<p>新增：${added.map((member) => safe(names.get(member.companyId) || member.companyId)).join("、") || "无"}</p><p>退出：${exited.map((member) => safe(names.get(member.companyId) || member.companyId)).join("、") || "无"}</p>`}</article>`;
  }).join("");
  const correctionValue = (field) => {
    const value = Array.isArray(field?.value) ? field.value.join("、") : field?.value;
    return `${text(value, "unknown")}（${text(field?.status, "unknown")}）`;
  };
  const corrections = history.corrections.map((change) => `<li data-correction-id="${safe(change.changeId)}"><strong>${safe(names.get(change.companyId) || change.companyId)}</strong> · ${safe(change.fieldPath)} · ${safe(change.reason)} · ${safe(change.correctedAt)}<span>${safe(correctionValue(change.before))} → ${safe(correctionValue(change.after))}</span></li>`).join("");
  return `<section class="core-history" id="history"><header><h2>季度覆盖与更正</h2></header><div class="core-version-grid">${versions || '<p class="empty">覆盖版本历史当前不可用。</p>'}</div><h3>事实更正</h3>${corrections ? `<ul>${corrections}</ul>` : '<p class="empty">当前没有追加的公开事实更正。</p>'}</section>`;
}

export function renderCoreCoverageUnavailable(detail = "Core 30 公开工件缺失或未通过校验") {
  return `<section class="core-unavailable" role="status"><h2>Core 30 当前不可用</h2><p>${safe(detail)}。这不是“30 个主体都已完成”，也不表示行业没有进展。</p></section>`;
}

export function renderCoreCoverage(artifact, history, filters = decodeCoreCoverageFilters("")) {
  if (!validArtifact(artifact)) throw new Error("Core 30 公开工件未通过契约校验");
  if (!validHistory(history, artifact)) throw new Error("Core 30 当前工件与公开历史时钟不一致");
  const entries = artifact.coverage.members.map((member, index) => ({ member, subject: artifact.subjects[index], brief: artifact.briefs[index] }));
  const filtered = sortCoreCoverageEntries(entries.filter((entry) => (filters.region === "all" || entry.member.coverageRegion === filters.region)
    && (filters.tier === "all" || entry.member.tier === filters.tier)
    && (filters.route === "all" || entry.subject.routes.includes(filters.route))
    && (filters.capital === "all" || capitalState(entry.brief) === filters.capital)
    && (filters.validation === "all" || validationState(entry.brief) === filters.validation)), filters.sort);
  const groups = TIER_ORDER.flatMap((tier) => {
    const tierEntries = filtered.filter((entry) => entry.member.tier === tier);
    return tierEntries.length ? [`<section class="core-tier-group" data-tier-group="${safe(tier)}"><header><h2>${safe(TIER_LABELS[tier])}</h2><span>${tierEntries.length} 个主体</span></header><div class="core-card-grid">${tierEntries.map((entry) => card(entry, artifact.windows)).join("")}</div></section>`] : [];
  }).join("");
  return `<section class="core-overview"><p class="core-clock">覆盖版本 ${safe(artifact.coverage.version)} · 生效 ${safe(artifact.coverage.effectiveFrom)} · 快照 ${safe(artifact.generatedAt)}</p><p>覆盖地区是研究资源配置，不代表法律国籍；三种比较层级分开呈现，不构成投资排名或评分。</p><div class="core-metrics"><div><span>固定覆盖</span><strong>30</strong></div><div><span>已核验身份</span><strong>${artifact.metrics.coveredSubjects}</strong></div><div><span>完整 Brief</span><strong>${artifact.metrics.completeBriefs}</strong></div><div><span>当前显示</span><strong>${filtered.length}</strong></div></div></section>${filtersForm(filters)}<section class="core-results" aria-live="polite"><p class="core-result-count">当前显示 ${filtered.length}/30；筛选不会改变固定覆盖成员。</p>${groups || '<p class="empty">没有符合当前筛选的覆盖主体；可清除筛选查看固定 30 名单。</p>'}</section>${historySection(history, artifact)}`;
}

async function boot() {
  const root = document.querySelector("#core-coverage-root");
  if (!root) return;
  let artifact;
  let historyData;
  try {
    const [artifactResponse, historyResponse] = await Promise.all([fetch("./data/core-coverage.json", { cache: "no-store" }), fetch("./data/core-coverage-history.json", { cache: "no-store" })]);
    if (!artifactResponse.ok || !historyResponse.ok) throw new Error("Core 30 工件或历史缺失");
    [artifact, historyData] = await Promise.all([artifactResponse.json(), historyResponse.json()]);
    const render = () => {
      const filters = decodeCoreCoverageFilters(window.location.search);
      root.innerHTML = renderCoreCoverage(artifact, historyData, filters);
      const form = root.querySelector("#core-filters");
      form?.addEventListener("change", () => {
        const params = new URLSearchParams();
        const data = new FormData(form);
        for (const key of ["region", "tier", "route", "capital", "validation", "sort"]) {
          const value = data.get(key);
          if (typeof value === "string" && value !== "all" && !(key === "sort" && value === "name")) params.set(key, value);
        }
        const query = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
        render();
      });
    };
    render();
  } catch (error) {
    root.innerHTML = renderCoreCoverageUnavailable(error instanceof Error ? error.message : "Core 30 数据读取失败");
  }
}

if (typeof document !== "undefined") void boot();
