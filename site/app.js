const fallback = { generatedAt: new Date().toISOString(), stats: { events: 0, companies: 0, research: 0 }, keyEvents: [], capital: [], industry: [], research: [], routes: [] };
const byId = (id) => document.getElementById(id);
const date = (value) => value ? value.slice(5).replace("-", ".") : "—";
const safe = (value = "") => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
function itemCard(item, compact = false) {
  return `<a class="${compact ? "feed-item" : "key-card"}" href="${safe(item.link)}" target="_blank" rel="noreferrer"><div class="item-meta"><span>${safe(item.type)}</span><time>${date(item.date)}</time></div><h3>${safe(item.title)}</h3><p>${safe(item.summary)}</p>${compact ? "" : `<footer>${safe(item.route)} <i>↗</i></footer>`}</a>`;
}
function renderFeed(id, items) { byId(id).innerHTML = items.length ? items.map((item) => itemCard(item, true)).join("") : '<p class="empty">等待下一条已验证信号</p>'; }
function render(data) {
  byId("event-count").textContent = data.stats.events; byId("company-count").textContent = data.stats.companies; byId("research-count").textContent = data.stats.research;
  byId("updated").textContent = `UPDATED ${new Date(data.generatedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`;
  byId("key-events").innerHTML = data.keyEvents.length ? data.keyEvents.map((item) => itemCard(item)).join("") : '<p class="empty">正在接收验证信号…</p>';
  renderFeed("capital", data.capital); renderFeed("industry", data.industry); renderFeed("research", data.research);
  byId("routes-grid").innerHTML = data.routes.map((route, index) => `<article class="route-card"><span>0${index + 1}</span><h3>${safe(route.name)}</h3><p>${safe(route.focus)}</p><small>${route.companies.map(safe).join(" · ") || "持续扩充中"}</small></article>`).join("");
}
fetch("data/dashboard.json").then((response) => response.ok ? response.json() : fallback).catch(() => fallback).then(render);
