const fallback = {
  generatedAt: new Date().toISOString(),
  periodLabel: "近 30 天滚动窗口",
  stats: { events: 0, companies: 0, research: 0, sources: 0 },
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

function itemCard(item, compact = false) {
  return `<a class="${compact ? "feed-item" : "key-card"}" href="${safeUrl(item.link)}" target="_blank" rel="noopener noreferrer">
    <div class="item-meta"><span>${safe(item.type || "已验证信号")}</span><time datetime="${safe(item.date)}">${date(item.date)}</time></div>
    <h3>${safe(item.title || "未命名信号")}</h3><p>${safe(item.summary || "查看原始证据了解详情。")}</p>
    ${compact ? "" : `<footer>${safe(item.route || "待分类")} <i aria-hidden="true">↗</i></footer>`}
  </a>`;
}

function signalCard(item, index) {
  return `<article class="top-signal">
    <div class="signal-rank">${String(index + 1).padStart(2, "0")}</div>
    <div class="signal-copy">
      <div class="signal-badges"><span>${safe(item.type || "已验证信号")}</span><span>证据 ${safe(item.evidenceGrade || "B")}</span>${item.score != null ? `<span>影响分 ${safe(item.score)}</span>` : ""}</div>
      <h3><a href="${safeUrl(item.link)}" target="_blank" rel="noopener noreferrer">${safe(item.title || "未命名信号")}</a></h3>
      <p>${safe(item.summary || "查看原始证据了解详情。")}</p>
      <footer><strong>为什么重要</strong> ${safe(item.whyItMatters || "该信号已通过公开展示门槛，值得持续跟踪。")} <i>${safe(item.entity || item.source || "公开来源")} · ${date(item.date)}</i></footer>
    </div>
  </article>`;
}

function renderFeed(id, items) {
  byId(id).innerHTML = list(items).length
    ? list(items).map((item) => itemCard(item, true)).join("")
    : '<p class="empty">等待下一条已验证信号</p>';
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

function renderCompanyRadar(items) {
  const route = byId("route-filter").value;
  const region = byId("region-filter").value;
  const status = byId("status-filter").value;
  const visible = list(items).filter((item) => (!route || item.routes.includes(route)) && (!region || item.region === region) && (!status || item.capitalStatus === status));
  byId("company-radar").innerHTML = visible.length ? visible.map((item) => `<article class="company-card">
    <div class="company-card-head"><a href="${safeUrl(item.officialUrl)}" target="_blank" rel="noopener noreferrer"><h3>${safe(item.name || "待识别公司")}</h3></a><span>${safe(item.region)} · ${safe(item.stage)}</span></div>
    <div class="momentum"><b>${safe(item.momentumLabel)}</b><span style="--momentum:${item.momentumScore}%"></span><small>${item.momentumScore}/100 · 30D ${safe(item.recentSignals)} 条信号</small></div>
    <p>${safe(item.thesis || "公司技术路线与产业定位仍在补全。")}</p>
    <div class="route-tags">${item.routes.length ? item.routes.map((name) => `<span>${safe(name)}</span>`).join("") : "<span>路线待补全</span>"}</div>
    <dl><div><dt>资本</dt><dd class="${item.capitalStatus === "已证实" ? "verified" : ""}">${safe(item.capitalStatus === "证据不足" ? "证据不足（不代表未融资）" : item.capitalStatus)}</dd></div><div><dt>验证</dt><dd>${safe(item.validationStage)}</dd></div></dl>
    <div class="company-facts"><div><small>融资 / 并购</small>${compactFact(item.funding, "尚未收录可归属公开证据")}</div><div><small>产品 / 部署</small>${compactFact(item.progress, "尚未收录满足门槛的事件")}</div></div>
    <footer>主体证据：${safe(item.identitySource || "待补全")}${item.updatedAt ? ` · 更新 ${date(item.updatedAt)}` : ""}</footer>
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
  byId("research-graph-grid").innerHTML = list(items).length ? list(items).map((item) => `<article class="research-link">
    <p class="eyebrow">${safe(item.route || "机器人学习")}</p>
    <h3><a href="${safeUrl(item.paper?.link)}" target="_blank" rel="noopener noreferrer">${safe(item.paper?.title || "未命名论文")}</a></h3>
    <p>${safe(item.paper?.summary || "查看论文原文了解研究方法与实验结论。")}</p>
    <div class="graph-line"><span>论文</span><i aria-hidden="true">→</i><span>${safe(item.route || "机器人学习")}</span><i aria-hidden="true">→</i><span>${list(item.companies).length ? list(item.companies).map(safe).join(" · ") : "产业关联待补证"}</span></div>
    <small>${safe(item.connection || "持续追踪工程化与商业验证。")}</small>
  </article>`).join("") : '<p class="empty">等待完整中文研究卡与产业路线建立连接。</p>';
}

function setupCompanyRadar(items) {
  const companies = list(items).map(normalizedCompany);
  fillOptions("route-filter", companies.flatMap((item) => item.routes), "全部路线");
  fillOptions("region-filter", companies.map((item) => item.region), "全部区域");
  ["route-filter", "region-filter", "status-filter"].forEach((id) => byId(id).addEventListener("change", () => renderCompanyRadar(companies)));
  renderCompanyRadar(companies);
}

function render(data) {
  const stats = data.stats || fallback.stats;
  byId("event-count").textContent = text(stats.events, "0");
  byId("company-count").textContent = text(stats.companies, "0");
  byId("research-count").textContent = text(stats.research, "0");
  byId("source-count").textContent = text(stats.sources, "—");
  const generated = new Date(data.generatedAt);
  byId("updated").textContent = Number.isNaN(generated.getTime()) ? "UPDATE PENDING" : `UPDATED ${generated.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`;

  const topSignals = list(data.topSignals).length ? data.topSignals : list(data.keyEvents);
  byId("top-signals").innerHTML = topSignals.length ? topSignals.slice(0, 10).map(signalCard).join("") : '<p class="empty">正在接收满足公开门槛的验证信号…</p>';
  renderFeed("capital", data.capital);
  renderFeed("industry", data.industry);
  renderFeed("research", data.research);
  setupCompanyRadar(data.companyRadar);
  renderResearchGraph(researchGraph(data));
  const routes = list(data.routes);
  byId("routes-grid").innerHTML = routes.length ? routes.map((route, index) => `<article class="route-card"><span>${String(index + 1).padStart(2, "0")}</span><h3>${safe(route.name || "待命名路线")}</h3><p>${safe(route.focus || "路线定义与竞争焦点持续补全。")}</p><small>${list(route.companies).length ? list(route.companies).map(safe).join(" · ") : "持续扩充中"}</small></article>`).join("") : '<p class="empty">技术路线数据正在更新。</p>';
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
