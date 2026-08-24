(function installDecisionProductsContract(global) {
  "use strict";

  const kinds = new Set(["投融资", "产品发布", "公司商业", "部署案例", "开源项目", "研究与数据"]);
  const routes = new Set(["数据与训练", "VLA 与具身模型", "世界模型与空间智能", "本体与硬件", "部署与商业化"]);
  const stages = new Set(["证据不足", "概念 / 研究", "原型与演示", "实机验证", "客户试点", "规模部署 / 商业化"]);
  const grades = new Set(["A", "B", "学术"]);
  const impacts = new Set(["company", "capital", "product-deployment", "research"]);
  const privateKeys = new Set(["rawModelOutput", "internalScore", "rankScore"]);
  const privateText = /(?:internal|selection|momentum|rank)[ _-]?(?:score|rank)\b|内部诊断/i;
  const narrativePrivate = /\b(?:score|rank)\b|分数|排名|内部诊断/i;
  const candidateId = /\bcandidate[-_.:/]+[a-z0-9][a-z0-9_.:/-]*/i;
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const keys = {
    artifact: ["schemaVersion", "generatedAt", "periodStart", "topSignals", "companyCards", "researchPassports", "subscriptions"],
    signal: ["signalId", "eventId", "entityId", "entityName", "titleZh", "factsZh", "kind", "routes", "occurredAt", "verifiedAt", "changedThisWeek", "evidenceState", "evidence", "impact", "whyItMatters", "rankReasons"],
    evidence: ["evidenceId", "url", "source", "grade"],
    company: ["cardId", "companyId", "companyName", "officialUrl", "region", "stage", "routes", "capital", "validationStage", "productDeployment", "recentChanges", "watchlist", "unknownFields", "updatedAt"],
    fact: ["status", "summary", "evidence"], change: ["eventId", "title", "occurredAt", "type"],
    watchlist: ["track", "lifecycle", "whyNow", "nextValidationPoints"], point: ["text", "dueAt"],
    passport: ["passportId", "paperId", "titleZh", "factsZh", "sourceUrl", "task", "embodiment", "methods", "benchmark", "realRobotTrials", "assets", "reproducibilityCost", "authority", "limitations", "gaps", "whyWorthAttention", "rankReasons"],
    benchmark: ["name", "metric", "result", "baseline", "delta", "evidenceUrls"], assets: ["code", "data", "weights"],
    cost: ["level", "rationale"], authority: ["openAlexWorkId", "authors", "labs", "citedByCount", "checkedAt"],
    catalog: ["generatedAt", "entries"], subscription: ["subscriptionId", "label", "description", "cadence", "format", "url", "route"],
  };

  const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const assert = (condition) => { if (!condition) throw new Error("invalid decision product"); };
  const exact = (value, expected) => {
    assert(object(value));
    const actual = Object.keys(value).sort();
    const sorted = [...expected].sort();
    assert(actual.length === sorted.length && actual.every((key, index) => key === sorted[index]));
  };
  const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
  const identifier = (value) => nonEmpty(value) && value === value.trim();
  const uniqueStrings = (value, allowEmpty = true) => Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(nonEmpty) && new Set(value).size === value.length;
  const canonicalTimestamp = (value) => {
    if (typeof value !== "string" || !timestampPattern.test(value)) return false;
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) return false;
    const normalized = new Date(milliseconds).toISOString();
    return normalized === value || normalized === value.replace("Z", ".000Z");
  };
  const canonicalDate = (value) => typeof value === "string" && datePattern.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const absoluteUrl = (value) => {
    if (typeof value !== "string") return false;
    try { const url = new URL(value); return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname) && !url.username && !url.password; }
    catch { return false; }
  };
  const origin = (value) => new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  const chineseSentence = (value) => typeof value === "string" && /[\u3400-\u9fff]/u.test(value) && /[。！？!?]$/u.test(value) && (value.match(/[。！？!?]/gu) || []).length === 1;
  const uniqueBy = (values, key) => assert(Array.isArray(values) && values.every((value) => object(value) && identifier(value[key])) && new Set(values.map((value) => value[key])).size === values.length);

  function utf8(value) {
    const bytes = [];
    for (const character of value) {
      const rawPoint = character.codePointAt(0);
      const point = rawPoint >= 0xd800 && rawPoint <= 0xdfff ? 0xfffd : rawPoint;
      if (point < 0x80) bytes.push(point);
      else if (point < 0x800) bytes.push(0xc0 | point >> 6, 0x80 | point & 63);
      else if (point < 0x10000) bytes.push(0xe0 | point >> 12, 0x80 | point >> 6 & 63, 0x80 | point & 63);
      else bytes.push(0xf0 | point >> 18, 0x80 | point >> 12 & 63, 0x80 | point >> 6 & 63, 0x80 | point & 63);
    }
    return bytes;
  }

  function sha256(value) {
    const bytes = utf8(value);
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let shift = 56; shift >= 0; shift -= 8) bytes.push(Math.floor(bitLength / 2 ** shift) & 255);
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const rotate = (value, bits) => value >>> bits | value << 32 - bits;
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const w = new Array(64);
      for (let index = 0; index < 16; index += 1) w[index] = bytes.slice(offset + index * 4, offset + index * 4 + 4).reduce((sum, byte) => sum << 8 | byte, 0);
      for (let index = 16; index < 64; index += 1) {
        const s0 = rotate(w[index - 15], 7) ^ rotate(w[index - 15], 18) ^ w[index - 15] >>> 3;
        const s1 = rotate(w[index - 2], 17) ^ rotate(w[index - 2], 19) ^ w[index - 2] >>> 10;
        w[index] = (w[index - 16] + s0 + w[index - 7] + s1) | 0;
      }
      let [a,b,c,d,e,f,g,hh] = h;
      for (let index = 0; index < 64; index += 1) {
        const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const choice = e & f ^ ~e & g;
        const t1 = (hh + s1 + choice + k[index] + w[index]) | 0;
        const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const majority = a & b ^ a & c ^ b & c;
        const t2 = (s0 + majority) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a,b,c,d,e,f,g,hh].forEach((value, index) => { h[index] = (h[index] + value) | 0; });
    }
    return h.map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
  }

  const stableId = (namespace, identity) => `decision-${namespace}-${sha256(`${namespace}\n${identity}`).slice(0, 20)}`;

  function scanPrivate(value) {
    if (typeof value === "string") { assert(!candidateId.test(value) && !privateText.test(value)); return; }
    if (Array.isArray(value)) { value.forEach(scanPrivate); return; }
    if (!object(value)) return;
    Object.entries(value).forEach(([key, nested]) => { assert(!privateKeys.has(key)); scanPrivate(nested); });
  }

  function scanNarrative(value) {
    if (typeof value === "string") { assert(!narrativePrivate.test(value)); return; }
    if (Array.isArray(value)) value.forEach(scanNarrative);
    else if (object(value)) Object.values(value).forEach(scanNarrative);
  }

  function evidence(value) {
    exact(value, keys.evidence);
    assert(nonEmpty(value.evidenceId) && absoluteUrl(value.url) && nonEmpty(value.source) && grades.has(value.grade));
  }

  function evidenceList(value, allowEmpty) {
    assert(Array.isArray(value) && (allowEmpty || value.length > 0));
    value.forEach(evidence);
    uniqueBy(value, "evidenceId");
  }

  function signal(value) {
    exact(value, keys.signal);
    assert(identifier(value.signalId) && identifier(value.eventId) && identifier(value.entityId) && value.signalId === stableId("signal", value.eventId));
    assert(nonEmpty(value.entityName) && nonEmpty(value.titleZh) && nonEmpty(value.whyItMatters));
    assert(Array.isArray(value.factsZh) && value.factsZh.length === 2 && value.factsZh.every(chineseSentence));
    assert(kinds.has(value.kind) && uniqueStrings(value.routes, false) && value.routes.every((route) => routes.has(route)));
    assert(canonicalTimestamp(value.occurredAt) && canonicalTimestamp(value.verifiedAt) && typeof value.changedThisWeek === "boolean");
    assert(value.evidenceState === "official" || value.evidenceState === "multi-source");
    evidenceList(value.evidence, false);
    if (value.evidenceState === "official") assert(value.evidence.some((item) => item.grade === "A" || item.grade === "学术"));
    else assert(value.evidence.length >= 2 && value.evidence.every((item) => item.grade === "B") && new Set(value.evidence.map((item) => item.source.trim().toLowerCase())).size >= 2 && new Set(value.evidence.map((item) => origin(item.url))).size >= 2);
    assert(uniqueStrings(value.impact, false) && value.impact.every((item) => impacts.has(item)) && uniqueStrings(value.rankReasons, false));
    scanNarrative([value.whyItMatters, value.rankReasons]);
  }

  function fact(value, unknownSummary) {
    exact(value, keys.fact);
    assert(["verified", "developing", "unknown", "conflicted"].includes(value.status) && nonEmpty(value.summary));
    scanNarrative(value.summary);
    evidenceList(value.evidence, true);
    assert(value.status === "unknown" ? value.evidence.length === 0 && value.summary === unknownSummary : value.evidence.length > 0);
    if (value.status === "verified") assert(value.evidence.some((item) => item.grade === "A" || item.grade === "学术") || value.evidence.filter((item) => item.grade === "B").length >= 2 && new Set(value.evidence.filter((item) => item.grade === "B").map((item) => origin(item.url))).size >= 2);
  }

  function company(value) {
    exact(value, keys.company);
    assert(identifier(value.cardId) && identifier(value.companyId) && value.cardId === stableId("company", value.companyId));
    assert(nonEmpty(value.companyName) && nonEmpty(value.region) && nonEmpty(value.stage) && absoluteUrl(value.officialUrl));
    assert(uniqueStrings(value.routes, false) && value.routes.every((route) => routes.has(route)));
    fact(value.capital, "证据不足（不代表未融资）");
    assert(stages.has(value.validationStage));
    fact(value.productDeployment, "证据不足（不代表没有产品或部署进展）");
    assert(Array.isArray(value.recentChanges) && value.recentChanges.length <= 2);
    value.recentChanges.forEach((change) => { exact(change, keys.change); assert(nonEmpty(change.eventId) && nonEmpty(change.title) && canonicalTimestamp(change.occurredAt) && kinds.has(change.type)); });
    uniqueBy(value.recentChanges, "eventId");
    assert(value.recentChanges.every((change, index) => !index || Date.parse(value.recentChanges[index - 1].occurredAt) > Date.parse(change.occurredAt) || Date.parse(value.recentChanges[index - 1].occurredAt) === Date.parse(change.occurredAt) && value.recentChanges[index - 1].eventId < change.eventId));
    exact(value.watchlist, keys.watchlist);
    assert(["forward-radar", "validated-momentum", "unknown"].includes(value.watchlist.track) && nonEmpty(value.watchlist.lifecycle) && nonEmpty(value.watchlist.whyNow));
    scanNarrative(value.watchlist);
    assert(Array.isArray(value.watchlist.nextValidationPoints));
    value.watchlist.nextValidationPoints.forEach((point) => { exact(point, keys.point); assert(nonEmpty(point.text) && canonicalDate(point.dueAt)); });
    assert(uniqueStrings(value.unknownFields) && canonicalTimestamp(value.updatedAt));
  }

  const unknownOrStrings = (value) => value === "unknown" || uniqueStrings(value, false);

  function passport(value) {
    exact(value, keys.passport);
    assert(identifier(value.passportId) && identifier(value.paperId) && value.passportId === stableId("research", value.paperId));
    assert(nonEmpty(value.titleZh) && /[\u3400-\u9fff]/u.test(value.titleZh) && nonEmpty(value.whyWorthAttention));
    assert(Array.isArray(value.factsZh) && value.factsZh.length === 2 && value.factsZh.every(chineseSentence) && absoluteUrl(value.sourceUrl));
    assert(unknownOrStrings(value.task) && unknownOrStrings(value.embodiment) && unknownOrStrings(value.methods));
    exact(value.benchmark, keys.benchmark);
    const fields = [value.benchmark.name, value.benchmark.metric, value.benchmark.result, value.benchmark.baseline, value.benchmark.delta];
    assert(fields.every((field) => field === "unknown" || nonEmpty(field)) && Array.isArray(value.benchmark.evidenceUrls) && value.benchmark.evidenceUrls.every(absoluteUrl) && new Set(value.benchmark.evidenceUrls).size === value.benchmark.evidenceUrls.length);
    assert(fields.some((field) => field !== "unknown") ? value.benchmark.evidenceUrls.length > 0 : value.benchmark.evidenceUrls.length === 0);
    assert(value.realRobotTrials === "unknown" || Number.isInteger(value.realRobotTrials) && value.realRobotTrials >= 0);
    exact(value.assets, keys.assets); assert([value.assets.code, value.assets.data, value.assets.weights].every((asset) => asset === "unknown" || absoluteUrl(asset)));
    exact(value.reproducibilityCost, keys.cost); assert(["low", "medium", "high", "unknown"].includes(value.reproducibilityCost.level));
    assert(value.reproducibilityCost.level === "unknown" ? value.reproducibilityCost.rationale === "unknown" : nonEmpty(value.reproducibilityCost.rationale) && value.reproducibilityCost.rationale !== "unknown");
    exact(value.authority, keys.authority); assert(typeof value.authority.openAlexWorkId === "string" && /^W[A-Z0-9._-]+$/.test(value.authority.openAlexWorkId));
    assert(uniqueStrings(value.authority.authors) && uniqueStrings(value.authority.labs));
    assert(value.authority.citedByCount === "unknown" || Number.isInteger(value.authority.citedByCount) && value.authority.citedByCount >= 0);
    assert(value.authority.checkedAt === "unknown" || canonicalTimestamp(value.authority.checkedAt));
    assert(value.limitations === "unknown" || uniqueStrings(value.limitations, false));
    assert(uniqueStrings(value.gaps) && uniqueStrings(value.rankReasons, false));
    scanNarrative([value.whyWorthAttention, value.rankReasons]);
  }

  function catalog(value) {
    exact(value, keys.catalog); assert(canonicalTimestamp(value.generatedAt) && Array.isArray(value.entries));
    value.entries.forEach((entry) => {
      exact(entry, keys.subscription);
      assert(identifier(entry.subscriptionId) && nonEmpty(entry.label) && nonEmpty(entry.description));
      assert((entry.cadence === "daily" || entry.cadence === "weekly") && ["github", "rss", "share-link"].includes(entry.format) && absoluteUrl(entry.url));
      assert(entry.route === "all" || entry.route === "watchlist" || routes.has(entry.route));
    });
    uniqueBy(value.entries, "subscriptionId");
  }

  function validate(value) {
    try {
      scanPrivate(value);
      exact(value, keys.artifact);
      assert(value.schemaVersion === 1 && canonicalTimestamp(value.generatedAt) && canonicalDate(value.periodStart));
      assert(Array.isArray(value.topSignals) && Array.isArray(value.companyCards) && Array.isArray(value.researchPassports));
      value.topSignals.forEach(signal); value.companyCards.forEach(company); value.researchPassports.forEach(passport);
      uniqueBy(value.topSignals, "signalId"); uniqueBy(value.topSignals, "eventId");
      uniqueBy(value.companyCards, "cardId"); uniqueBy(value.companyCards, "companyId");
      uniqueBy(value.researchPassports, "passportId"); uniqueBy(value.researchPassports, "paperId");
      catalog(value.subscriptions);
      return true;
    } catch { return false; }
  }

  global.DecisionProductsContract = Object.freeze({ validate });
}(globalThis));
