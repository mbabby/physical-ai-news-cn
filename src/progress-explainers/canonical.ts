import { createHash } from "node:crypto";
import { validateBenchmarkResultLedger, type BenchmarkResultLedger } from "../benchmark-result-ledger.js";
import { canonicalCompanyId, canonicalCompanyOwner } from "../company-event-ownership.js";
import { isDiscoveryEvidence, validateFacts, type EvidenceState } from "../facts-contract.js";
import type { ResearchDecisionCard } from "../research-decision-card.js";
import type { CompanyProfile, EventEvidence, EventRecord, ResearchRecord } from "../types.js";
import type { ExplainerEvidence, ExplainerFact, ExplainerSource } from "./contracts.js";

type EventWithLifecycle = EventRecord & { evidenceState?: EvidenceState };
type EvidenceWithLifecycle = EventEvidence & { withdrawn?: boolean; discovery?: boolean; publicationPolicy?: "可作为一手证据" | "可作为独立报道" | "仅作线索发现"; independentOrigin?: string };
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const evidenceId = (url: string): string => `evidence:${digest(url).slice(0, 16)}`;
const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim();

function contextFor(kind: EventRecord["kind"]): string[] {
  const contexts: Partial<Record<NonNullable<EventRecord["kind"]>, string>> = { demonstration: "演示", pilot: "试点", deployment: "部署", "research-author-report": "作者报告", "independent-replication": "独立复现" };
  return kind && contexts[kind] ? [contexts[kind]!] : [];
}

function supportedFacts(event: EventRecord, evidence: ExplainerEvidence[]): ExplainerFact[] {
  const allowed = new Map(evidence.map((item) => [item.url, item.evidenceId]));
  return event.facts.flatMap((text, index) => {
    const direct = event.evidence.filter((item) => allowed.has(item.link) && normalize(item.supports) === normalize(text)).map((item) => allowed.get(item.link)!);
    const timeline = event.timeline.filter((item) => normalize(item.summary) === normalize(text)).flatMap((item) => item.evidenceLinks.flatMap((url) => allowed.get(url) ?? []));
    const evidenceIds = [...new Set([...direct, ...timeline])].sort();
    return evidenceIds.length ? [{ factId: `${event.id}:fact:${index + 1}`, text, evidenceIds }] : [];
  });
}

function eventSources(events: EventRecord[], companies: CompanyProfile[]): ExplainerSource[] {
  return events.flatMap((event): ExplainerSource[] => {
    const ownerId = canonicalCompanyOwner(companies, event.primaryEntity);
    const owner = ownerId && companies.find((company) => canonicalCompanyId(company) === ownerId);
    const lifecycle = event as EventWithLifecycle;
    const validation = validateFacts({ ...event, public: true, evidenceState: lifecycle.evidenceState, eventDate: event.occurredAt ?? event.eventDate, publishedAt: event.lastEvidenceAt, materiallyChangedAt: event.lastMaterialChangeAt, evidence: lifecycle.evidence as EvidenceWithLifecycle[] });
    if (!owner || !validation.valid || !validation.publicEligible) return [];
    const qualifying = new Set(validation.qualifyingEvidenceIds);
    const evidenceRecords = lifecycle.evidence as EvidenceWithLifecycle[];
    const evidence = evidenceRecords.filter((item) => qualifying.has(item.link) && !item.withdrawn && !isDiscoveryEvidence(item)).map((item) => ({ evidenceId: evidenceId(item.link), url: item.link, source: item.source }));
    const facts = supportedFacts(event, evidence);
    if (!evidence.length || !facts.length) return [];
    const base = { canonicalId: `event:${event.id}`, kind: "event" as const, entityNames: [owner.name], eventDate: validation.times.eventDate, publishedAt: validation.times.publishedAt, materiallyChangedAt: validation.times.materiallyChangedAt, facts, evidence, contexts: contextFor(event.kind) };
    return [{ ...base, revision: digest({ ...base, ownerId }) }];
  });
}

function uniqueCards(cards: ResearchDecisionCard[]): Map<string, ResearchDecisionCard> {
  const result = new Map<string, ResearchDecisionCard>();
  for (const card of cards) {
    const id = card.identity.paperId.value;
    if (id === "unknown") continue;
    if (result.has(id)) throw new Error(`Duplicate research decision card: ${id}`);
    result.set(id, card);
  }
  return result;
}

function currentResearch(records: ResearchRecord[]): ResearchRecord[] {
  const grouped = new Map<string, ResearchRecord[]>();
  for (const record of records) grouped.set(record.id, [...(grouped.get(record.id) ?? []), record]);
  return [...grouped.values()].map((versions) => [...versions].sort((a, b) => (b.arxivVersion ?? 0) - (a.arxivVersion ?? 0) || b.factHash.localeCompare(a.factHash))[0]!);
}

function researchSources(records: ResearchRecord[], cards: ResearchDecisionCard[]): ExplainerSource[] {
  const byPaper = uniqueCards(cards);
  return currentResearch(records).flatMap((record): ExplainerSource[] => {
    const card = byPaper.get(record.id);
    if (!card || record.status === "已撤稿" || record.article.scholar?.isRetracted || card.gates.length || card.factsZh.value === "unknown") return [];
    if (!record.article.link || !card.factsZh.evidenceUrls.includes(record.article.link)) return [];
    const evidence = [{ evidenceId: evidenceId(record.article.link), url: record.article.link, source: record.article.source }];
    const facts = card.factsZh.value.map((text, index) => ({ factId: `${record.id}:fact:${index + 1}`, text, evidenceIds: evidence.map((item) => item.evidenceId) }));
    const publishedAt = Number.isFinite(record.article.publishedAt.getTime()) ? record.article.publishedAt.toISOString() : "unknown";
    const base = { canonicalId: `research:${record.id}`, kind: "research" as const, entityNames: card.lab.value === "unknown" ? [] : card.lab.value, eventDate: publishedAt, publishedAt, materiallyChangedAt: record.changes.at(-1)?.date ?? publishedAt, facts, evidence, contexts: ["作者报告"] };
    return [{ ...base, revision: digest({ ...base, arxivVersion: record.arxivVersion ?? "unknown" }) }];
  });
}

export function buildExplainerSources(input: { events: EventRecord[]; companies: CompanyProfile[]; researchRecords: ResearchRecord[]; researchDecisionCards: ResearchDecisionCard[]; benchmarkResultLedger: BenchmarkResultLedger }): ExplainerSource[] {
  validateBenchmarkResultLedger(input.benchmarkResultLedger);
  return [...eventSources(input.events, input.companies), ...researchSources(input.researchRecords, input.researchDecisionCards)].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
}
