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

function topSignals(data) {
  return list(data.topSignals).length ? data.topSignals : list(data.keyEvents);
}

function weekly(data) {
  const signals = topSignals(data).slice(0, 10);
  root.innerHTML = `<p class="share-intro">${safe(data.periodLabel || "近 30 天滚动窗口")} · 更新时间 ${safe(text(data.generatedAt).slice(0, 10) || "待同步")}。按证据、影响、时效与多源佐证综合排序，最多展示 10 条。</p>
    <div class="top-signals">${signals.map((item, index) => `<article class="top-signal">
      <div class="signal-rank">${String(index + 1).padStart(2, "0")}</div>
      <div class="signal-copy"><div class="signal-badges"><span>${safe(item.type || "已验证信号")}</span><span>证据 ${safe(item.evidenceGrade || "B")}</span>${item.score != null ? `<span>影响分 ${safe(item.score)}</span>` : ""}</div>
      <h3>${link(item.link, item.title)}</h3><p>${safe(item.summary || "查看原始证据了解详情。")}</p>
      <footer><strong>为什么重要</strong> ${safe(item.whyItMatters || "该信号已通过公开展示门槛，值得持续跟踪。")} <i>${safe(item.entity || item.source || "公开来源")} · ${day(item.date)}</i></footer></div>
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

function companies(data) {
  const companies = list(data.companyRadar).map(normalizedCompany).sort((a, b) => b.momentumScore - a.momentumScore).slice(0, 18);
  root.innerHTML = `<p class="share-intro">资本状态不明不等于未融资。这里按近 30 天可归属事件、资本证据与产品验证阶段计算动量。</p>
    <div class="company-radar">${companies.map((item) => `<article class="company-card">
      <div class="company-card-head"><h3>${link(item.officialUrl, item.name || "待识别公司")}</h3><span>${safe(item.region || "区域待补全")} · ${safe(item.stage || "阶段待补全")}</span></div>
      <div class="momentum"><b>${safe(item.momentumLabel)}</b><span style="--momentum:${item.momentumScore}%"></span><small>${item.momentumScore}/100 · 30D ${safe(item.recentSignals)} 条</small></div>
      <p>${safe(item.thesis || "公司技术路线与产业定位仍在补全。")}</p>
      <div class="route-tags">${item.routes.length ? item.routes.map((route) => `<span>${safe(route)}</span>`).join("") : "<span>路线待补全</span>"}</div>
      <dl><div><dt>资本</dt><dd>${safe(item.capitalStatus === "证据不足" ? "证据不足（不代表未融资）" : item.capitalStatus)}</dd></div><div><dt>验证</dt><dd>${safe(item.validationStage || "证据不足")}</dd></div></dl>
      <div class="company-facts"><div><small>最近资本事件</small>${item.funding?.link ? link(item.funding.link, item.funding.title) : '<span class="radar-muted">尚未收录可归属公开证据</span>'}</div><div><small>最近产品 / 部署</small>${item.progress?.link ? link(item.progress.link, item.progress.title) : '<span class="radar-muted">尚无满足门槛的事件</span>'}</div></div>
    </article>`).join("") || '<p class="empty">公司档案正在同步。</p>'}</div>`;
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

const views = { weekly, companies, research };
loadDashboard().then((data) => (views[view] || weekly)(data)).catch((error) => {
  console.warn("Share-page data unavailable.", error);
  root.innerHTML = '<p class="empty">数据暂时不可用。若正在本地预览，请检查网络后刷新；线上页面会在下一次日报成功后自动恢复。</p>';
});
