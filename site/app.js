const fallback = { generatedAt: new Date().toISOString(), stats: { events: 0, companies: 0, research: 0 }, keyEvents: [], capital: [], industry: [], research: [], companyRadar: [], routes: [] };
const byId = (id) => document.getElementById(id);
const date = (value) => value ? value.slice(5).replace("-", ".") : "—";
const safe = (value = "") => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
function itemCard(item, compact = false) {
  return `<a class="${compact ? "feed-item" : "key-card"}" href="${safe(item.link)}" target="_blank" rel="noreferrer"><div class="item-meta"><span>${safe(item.type)}</span><time>${date(item.date)}</time></div><h3>${safe(item.title)}</h3><p>${safe(item.summary)}</p>${compact ? "" : `<footer>${safe(item.route)} <i>↗</i></footer>`}</a>`;
}
function renderFeed(id, items) { byId(id).innerHTML = items.length ? items.map((item) => itemCard(item, true)).join("") : '<p class="empty">等待下一条已验证信号</p>'; }
function options(id, values) {
  const select = byId(id); const current = select.value;
  select.innerHTML = `${select.innerHTML.split("</option>")[0]}</option>${[...new Set(values)].sort().map((value) => `<option value="${safe(value)}">${safe(value)}</option>`).join("")}`;
  select.value = current;
}
function compactFact(item, fallback) {
  if (!item) return `<span class="radar-muted">${fallback}</span>`;
  return `<a href="${safe(item.link)}" target="_blank" rel="noreferrer">${safe(item.title)}</a>`;
}
function renderCompanyRadar(items) {
  const route = byId("route-filter").value; const region = byId("region-filter").value; const status = byId("status-filter").value;
  const visible = items.filter((item) => (!route || item.routes.includes(route)) && (!region || item.region === region) && (!status || item.capitalStatus === status));
  byId("company-radar").innerHTML = visible.length ? visible.map((item) => `<article class="company-card">
    <div class="company-card-head"><a href="${safe(item.officialUrl)}" target="_blank" rel="noreferrer"><h3>${safe(item.name)}</h3></a><span>${safe(item.region)} · ${safe(item.stage)}</span></div>
    <p>${safe(item.thesis)}</p><div class="route-tags">${item.routes.map((name) => `<span>${safe(name)}</span>`).join("")}</div>
    <dl><div><dt>资本</dt><dd class="${item.capitalStatus === "已证实" ? "verified" : ""}">${safe(item.capitalStatus === "证据不足" ? "证据不足（不代表未融资）" : item.capitalStatus)}</dd></div><div><dt>验证</dt><dd>${safe(item.validationStage)}</dd></div></dl>
    <div class="company-facts"><div><small>融资 / 并购</small>${compactFact(item.funding, "尚未收录可归属公开证据")}</div><div><small>产品 / 部署</small>${compactFact(item.progress, "尚未收录满足门槛的事件")}</div></div>
    <footer>主体证据：${safe(item.identitySource)}${item.updatedAt ? ` · 更新 ${date(item.updatedAt.slice(0, 10))}` : ""}</footer>
  </article>`).join("") : '<p class="empty">当前筛选条件下暂无可公开展示的公司档案。</p>';
}
function setupCompanyRadar(items) {
  options("route-filter", items.flatMap((item) => item.routes)); options("region-filter", items.map((item) => item.region));
  ["route-filter", "region-filter", "status-filter"].forEach((id) => byId(id).addEventListener("change", () => renderCompanyRadar(items)));
  renderCompanyRadar(items);
}
function render(data) {
  byId("event-count").textContent = data.stats.events; byId("company-count").textContent = data.stats.companies; byId("research-count").textContent = data.stats.research;
  byId("updated").textContent = `UPDATED ${new Date(data.generatedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`;
  byId("key-events").innerHTML = data.keyEvents.length ? data.keyEvents.map((item) => itemCard(item)).join("") : '<p class="empty">正在接收验证信号…</p>';
  renderFeed("capital", data.capital); renderFeed("industry", data.industry); renderFeed("research", data.research);
  setupCompanyRadar(data.companyRadar || []);
  byId("routes-grid").innerHTML = data.routes.map((route, index) => `<article class="route-card"><span>0${index + 1}</span><h3>${safe(route.name)}</h3><p>${safe(route.focus)}</p><small>${route.companies.map(safe).join(" · ") || "持续扩充中"}</small></article>`).join("");
}
fetch("data/dashboard.json").then((response) => response.ok ? response.json() : fallback).catch(() => fallback).then(render);
