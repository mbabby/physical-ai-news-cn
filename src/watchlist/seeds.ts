import { createHash } from "node:crypto";
import { derivePublication } from "../facts-contract.js";
import type { EvidenceState } from "../facts-contract.js";
import type { CompanyBoards } from "../company-boards.js";
import type { CompanyClaim, CompanyClaimLedger } from "../company-claim-ledger.js";
import type { CompanyProfile, EventEvidence, EventRecord, TechnicalRoute } from "../types.js";
import type { WatchlistTrack } from "./contracts.js";

const SENSITIVE_FIELDS = ["amount", "valuation", "customer", "revenue", "order"] as const;
const TERMINAL_STATES = new Set<EvidenceState>(["rejected", "conflicted", "withdrawn"]);
const CONFLICT_PATTERN = /冲突|矛盾|主体待识别|主体不明|归属不明|金额待核验|轮次待核验|撤回|撤销|withdrawn|conflict/i;
const DISCOVERY_PATTERN = /google news|hacker news|news\.google\.com|^x\s*[··]|twitter/i;

export interface ThesisSeed {
  companyId: string;
  companyName: string;
  track: WatchlistTrack;
  routes: TechnicalRoute[];
  factReferenceIds: string[];
  evidenceGrade: "A" | "B+B" | "B";
  verifiedSensitiveFields: string[];
  unknownSensitiveFields: string[];
  evidenceSummary: string[];
}

export interface ThesisSeedInput {
  companies: CompanyProfile[];
  events: EventRecord[];
  boards: CompanyBoards;
  claimLedger?: CompanyClaimLedger;
  /** Retained in the boundary contract for reproducible callers; seeds are timeless facts. */
  generatedAt: string | Date;
}

type EventWithLifecycle = EventRecord & { evidenceState?: EvidenceState };
type EvidenceWithLifecycle = EventEvidence & { withdrawn?: boolean };

function stableCompanyId(company: CompanyProfile): string {
  return company.entityId ?? `company-${createHash("sha256").update(`${company.name}\n${company.officialUrl}`).digest("hex").slice(0, 12)}`;
}

function evidenceOrigin(evidence: EventEvidence): string {
  try { return new URL(evidence.link).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return evidence.source.trim().toLowerCase(); }
}

function qualifyingEvidence(event: EventRecord): EventEvidence[] {
  return event.evidence.filter((item) => (item.grade === "A" || item.grade === "B")
    && !(item as EvidenceWithLifecycle).withdrawn
    && !DISCOVERY_PATTERN.test(`${item.source} ${item.link}`));
}

function eventEvidenceGrade(event: EventRecord): "A" | "B+B" | undefined {
  const evidence = qualifyingEvidence(event);
  if (evidence.some((item) => item.grade === "A")) return "A";
  return new Set(evidence.filter((item) => item.grade === "B").map(evidenceOrigin)).size >= 2 ? "B+B" : undefined;
}

function isCanonicalIndependentBEvent(event: EventRecord): boolean {
  const lifecycle = event as EventWithLifecycle;
  if (event.status === "已归档" || event.status === "待复核" || event.openQuestions.some((item) => CONFLICT_PATTERN.test(item))) return false;
  if (event.type === "投融资" && event.funding?.entityStatus !== "已确认") return false;
  if (lifecycle.evidenceState && TERMINAL_STATES.has(lifecycle.evidenceState)) return false;
  if (TERMINAL_STATES.has(derivePublication({ evidence: event.evidence, evidenceState: lifecycle.evidenceState }).evidenceState)) return false;
  return eventEvidenceGrade(event) === "B+B";
}

function claimMatchesEvent(claim: CompanyClaim, eventId: string): boolean {
  return claim.evidenceIds.some((id) => id.replace(/:evidence:\d+$/, "") === eventId);
}

function verifiedSensitiveFields(companyId: string, events: EventRecord[], ledger?: CompanyClaimLedger): string[] {
  const claims = ledger?.companies.find((entry) => entry.companyId === companyId)?.claims ?? [];
  const verified = new Set<string>();
  for (const event of events) {
    const freshClaims = claims.filter((claim) => claim.evidenceState === "verified" && claim.freshness.state === "fresh" && claimMatchesEvent(claim, event.id));
    if (!freshClaims.length) continue;
    if (event.funding?.amount && freshClaims.some((claim) => claim.claimType === "funding")) verified.add("amount");
    if (event.funding?.valuation && freshClaims.some((claim) => claim.claimType === "funding")) verified.add("valuation");
    if (event.productDeployment?.customers.length && freshClaims.some((claim) => ["pilot", "deployment", "commercialization"].includes(claim.claimType))) verified.add("customer");
  }
  return SENSITIVE_FIELDS.filter((field) => verified.has(field));
}

function seedFor(
  companyId: string,
  companyName: string,
  track: WatchlistTrack,
  routes: TechnicalRoute[],
  events: EventRecord[],
  ledger?: CompanyClaimLedger,
): ThesisSeed | undefined {
  const factEvents = [...events].sort((left, right) => left.id.localeCompare(right.id));
  if (!factEvents.length) return undefined;
  const grades = factEvents.map(eventEvidenceGrade);
  const evidenceGrade = grades.includes("A") ? "A" : grades.includes("B+B") ? "B+B" : "B";
  const verified = verifiedSensitiveFields(companyId, factEvents, ledger);
  return {
    companyId, companyName, track, routes: [...new Set(routes)].sort(),
    factReferenceIds: factEvents.map((event) => event.id), evidenceGrade,
    verifiedSensitiveFields: verified,
    unknownSensitiveFields: SENSITIVE_FIELDS.filter((field) => !verified.includes(field)),
    evidenceSummary: factEvents.map((event) => event.title),
  };
}

/**
 * Convert only canonical company-board facts into internal seed records.
 * Candidate records are intentionally absent from this input boundary.
 */
export function buildThesisSeeds(input: ThesisSeedInput): ThesisSeed[] {
  const companyById = new Map(input.companies.map((company) => [stableCompanyId(company), company]));
  const eventsById = new Map(input.events.map((event) => [event.id, event]));
  const momentum = input.boards.momentum.entries.flatMap((entry) => {
    if (!companyById.has(entry.companyId)) return [];
    const events = entry.qualifyingEvents.map((reference) => eventsById.get(reference.eventId)).filter((event): event is EventRecord => Boolean(event));
    const seed = seedFor(entry.companyId, entry.companyName, "validated-momentum", entry.routes, events, input.claimLedger);
    return seed ? [seed] : [];
  });
  const momentumIds = new Set(momentum.map((seed) => seed.companyId));
  const strategic = input.boards.strategic.entries.flatMap((entry) => {
    if (momentumIds.has(entry.companyId)) return [];
    const company = companyById.get(entry.companyId);
    if (!company) return [];
    const events = input.events.filter((event) => event.primaryEntity === company.name && isCanonicalIndependentBEvent(event));
    const seed = seedFor(entry.companyId, entry.companyName, "forward-radar", entry.routes, events, input.claimLedger);
    return seed ? [seed] : [];
  });
  const uniqueSeeds = new Map<string, ThesisSeed>();
  for (const seed of [...momentum, ...strategic]) {
    if (!uniqueSeeds.has(seed.companyId)) uniqueSeeds.set(seed.companyId, seed);
  }
  return [...uniqueSeeds.values()].sort((left, right) => left.track.localeCompare(right.track) || left.companyId.localeCompare(right.companyId));
}
