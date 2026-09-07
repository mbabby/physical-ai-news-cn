import { upsertEvents } from "../event-center.js";
import { normalizeUrl, publicHoldReasons } from "../filter.js";
import { canonicalCompanyOwner } from "../company-event-ownership.js";
import { shanghaiDailyDate } from "../runtime/daily-date.js";
import type { Article, ArticleKind, CompanyProfile, EventRecord, EventStore } from "../types.js";

type Field = "round" | "amount" | "valuation" | "product" | "customer" | "deployment" | "productionStage";
export interface ReviewedBackfill {
  schemaVersion: 1;
  reviewedAt: string;
  identities: Array<{
    companyId: string;
    evidence: NonNullable<CompanyProfile["profileEvidence"]>;
    domainMigration?: { from: string; to: string; legalName: string; excerpt: string };
  }>;
  events: Array<{
    companyId: string; url: string; source: string; titleZh: string; summaryZh: string;
    type: Exclude<ArticleKind, "研究与数据">;
    kind: NonNullable<EventRecord["kind"]>;
    occurredOn: string; publishedOn: string; occurrenceExcerpt?: string;
    fields: Array<{ field: Field; value: string; excerpt: string; locator: string }>;
    gaps: string[];
  }>;
}

function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Reviewed backfill: ${message}`);
}
function host(value: string): string {
  const url = new URL(value);
  requireThat(url.protocol === "https:" && !url.username && !url.password, "HTTPS source required");
  return url.hostname.toLowerCase().replace(/^www\./, "");
}
function isOfficial(company: CompanyProfile, url: string): boolean {
  const target = host(url);
  return [company.officialUrl, ...(company.officialDomains ?? []).map((domain) => domain.includes("://") ? domain : `https://${domain}`)]
    .some((value) => target === host(value) || target.endsWith(`.${host(value)}`));
}
function day(value: string): string {
  if (value === "unknown") return value;
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value, "invalid source date");
  return value;
}

/** Explicit operator input only. Existing canonical URL dispositions always win,
 * including withdrawals/conflicts: replay never re-adjudicates prior records. */
export function prepareReviewedBackfill(profiles: CompanyProfile[], previous: EventStore | undefined, input: ReviewedBackfill, now: Date): { companies: CompanyProfile[]; store: EventStore } {
  requireThat(input.schemaVersion === 1 && Array.isArray(input.identities) && Array.isArray(input.events), "invalid receipt");
  requireThat(Number.isFinite(Date.parse(input.reviewedAt)) && Date.parse(input.reviewedAt) <= now.getTime(), "invalid review clock");
  const companies = structuredClone(profiles);
  const profile = (id: string) => {
    const matches = companies.filter((company) => company.entityId === id);
    requireThat(matches.length === 1, `unknown or ambiguous subject ${id}`);
    return matches[0];
  };
  requireThat(new Set(input.identities.map((item) => item.companyId)).size === input.identities.length, "duplicate identity");
  for (const identity of input.identities) {
    const company = profile(identity.companyId);
    if (identity.domainMigration) {
      const migration = identity.domainMigration;
      requireThat([migration.from, migration.to].includes(company.officialUrl) && migration.excerpt.includes(migration.legalName), "unproven official domain migration");
      requireThat(identity.evidence.some((proof) => host(proof.link) === host(migration.from))
        && identity.evidence.some((proof) => host(proof.link) === host(migration.to) && proof.supports.includes(migration.legalName)), "migration requires both official origins and legal continuity");
      company.officialDomains = [...new Set([...(company.officialDomains ?? []), host(migration.from), host(migration.to)])];
      company.officialUrl = migration.to;
      company.legalName = migration.legalName;
    }
    for (const proof of identity.evidence) {
      requireThat(isOfficial(company, proof.link) && proof.source.trim() && proof.supports.trim()
        && Number.isFinite(Date.parse(proof.checkedAt)) && Date.parse(proof.checkedAt) <= now.getTime(), `invalid identity proof ${identity.companyId}`);
      requireThat([company.name, company.legalName, ...(company.aliases ?? [])].some((name) => name && proof.supports.toLowerCase().includes(name.toLowerCase())), "identity excerpt must name its canonical subject");
      company.profileEvidence ??= [];
      if (!company.profileEvidence.some((saved) => normalizeUrl(saved.link) === normalizeUrl(proof.link) && saved.supports === proof.supports)) company.profileEvidence.push(proof);
    }
  }
  let store = structuredClone(previous ?? { updatedAt: now.toISOString(), events: [] });
  const seen = new Set<string>();
  for (const item of input.events) {
    const company = profile(item.companyId);
    const url = normalizeUrl(item.url);
    requireThat(!seen.has(url), "duplicate event URL"); seen.add(url);
    requireThat(isOfficial(company, item.url), `source is not official for ${item.companyId}`);
    requireThat(["投融资", "产品发布", "公司商业", "部署案例", "开源项目"].includes(item.type), "unsupported event lane");
    requireThat(["funding", "product-release", "demonstration", "pilot", "deployment", "mass-production", "commercialisation"].includes(item.kind)
      && (item.kind === "funding") === (item.type === "投融资"), "inconsistent reviewed kind");
    const occurredAt = day(item.occurredOn); const publishedAt = day(item.publishedOn);
    requireThat(occurredAt === "unknown" || Boolean(item.occurrenceExcerpt?.trim()), "occurrence requires explicit source excerpt");
    requireThat([item.occurredOn, item.publishedOn].every((date) => date === "unknown" || date <= shanghaiDailyDate(now)), "future event proof");
    requireThat(item.fields.length > 0 && new Set(item.fields.map((field) => field.field)).size === item.fields.length, "missing/duplicate field bindings");
    for (const field of item.fields) requireThat(["round", "amount", "valuation", "product", "customer", "deployment", "productionStage"].includes(field.field)
      && typeof field.value === "string" && field.value.trim() && field.value !== "unknown" && field.excerpt.trim() && field.locator.trim()
      && (item.type === "投融资" ? ["round", "amount", "valuation"].includes(field.field) : ["product", "customer", "deployment", "productionStage"].includes(field.field))
      && (field.field !== "productionStage" || ({ pilot: "pilot", "mass-production": "production", commercialisation: "commercialization" } as Record<string, string>)[item.kind] === field.value), "invalid direct field binding");
    // Inspect the original store, not an automatically filtered/migrated copy.
    // Even an archived or non-public URL must not be restored by stale input.
    if (store.events.some((event) => event.evidence.some((proof) => normalizeUrl(proof.link) === url))) continue;
    const article: Article = {
      id: url, link: item.url, title: item.titleZh, titleZh: item.titleZh, summaryZh: item.summaryZh,
      source: item.source, sourceTier: "官方公司与实验室", sourceWeight: 10, kind: item.type,
      excerpt: item.fields.map((field) => field.excerpt).join("\n"), tags: [], fetchedAt: new Date(input.reviewedAt),
      // Article is a temporary ownership/ID carrier. Unknown publication is
      // restored below before any canonical state is staged or projected.
      publishedAt: new Date(publishedAt === "unknown" ? input.reviewedAt : publishedAt),
    };
    requireThat(publicHoldReasons(article, true).length === 0, `public article gate rejected ${item.companyId}`);
    const priorIds = new Set(store.events.map((event) => event.id));
    const next = upsertEvents(store, [article], now, companies);
    const record = next.events.find((event) => event.evidence.some((proof) => normalizeUrl(proof.link) === url));
    requireThat(record && !priorIds.has(record.id) && canonicalCompanyOwner(companies, record.primaryEntity) === item.companyId, `canonical ownership/deduplication requires separate review: ${item.companyId}`);
    const value = (field: Field) => item.fields.find((binding) => binding.field === field)?.value;
    record.kind = item.kind;
    record.funding = item.type === "投融资" ? { entityStatus: "已确认", investors: [], round: value("round"), amount: value("amount"), valuation: value("valuation") } : undefined;
    record.productDeployment = item.type === "投融资" ? undefined : { product: value("product"), customers: value("customer") ? [value("customer")!] : [], deployment: value("deployment") };
    record.occurredAt = occurredAt; record.eventDate = item.occurredOn;
    record.dateSource = occurredAt === "unknown" ? "inferred" : "explicit";
    record.dateConfidence = occurredAt === "unknown" ? "low" : "high";
    // The explicit receipt documents observation at review time, even if the
    // operator first imports it on a later day. Import is not a fresh review.
    record.firstSeenAt = new Date(input.reviewedAt).toISOString(); record.lastVerifiedAt = new Date(input.reviewedAt).toISOString();
    record.lastEvidenceAt = publishedAt;
    // Initial ingestion is not a newly observed change to a prior canonical
    // fact. Neither a source date nor this run's clock establishes that clock.
    record.lastMaterialChangeAt = "unknown";
    record.lastUpdatedAt = record.lastMaterialChangeAt;
    record.openQuestions = item.gaps;
    record.evidence = [{ link: item.url, source: item.source, grade: "A", publishedAt,
      supports: [...item.fields.map((field) => `${field.field}: ${field.value} ; 定位 ${field.locator} ; 原文/审阅释义 ${field.excerpt}`),
        ...(occurredAt === "unknown" ? [] : [`event date: ${item.occurredOn} ; 原文 ${item.occurrenceExcerpt}`])].join("\n") }];
    record.timeline = [{ date: now.toISOString(), summary: item.summaryZh, evidenceLinks: [item.url] }];
    store = next;
  }
  return { companies, store };
}
