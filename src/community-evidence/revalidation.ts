import { lookup as lookupDns } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import type { BenchmarkResultLedger } from "../benchmark-result-ledger.js";
import type { CompanyClaim, CompanyClaimFields, CompanyClaimLedger } from "../company-claim-ledger.js";
import type { DecisionProductArtifact } from "../decision-products/contracts.js";
import { derivePublication } from "../facts-contract.js";
import type { LedgerField } from "../ledger-contracts.js";
import type { ResearchDecisionCard } from "../research-decision-card.js";
import { fetchWithRetry, HttpRequestError, mapWithConcurrency } from "../runtime/http.js";
import type { CompanyProfile, EventRecord, ResearchRecord, RuntimeStatus, SourceConfig } from "../types.js";
import {
  assertAcceptedEvidenceArtifact,
  assertCommunityEvidencePrivateBoundary,
  isCanonicalCommunityTimestamp,
  isCommunityEvidenceTaskId,
  isEvidenceTargetField,
  isHumanContributorLogin,
  isNormalizedCommunityHttpsUrl,
  isNormalizedCommunityPublicTargetUrl,
  isPositiveCommunityIssueNumber,
  type AcceptedEvidenceArtifact,
  type AcceptedEvidenceEntry,
  type EvidenceTargetField,
} from "./contracts.js";

export type RevalidationCheck = "pass" | "fail" | "unknown";
export type RevalidationFailureCode =
  | "unsafe-url" | "unsafe-redirect" | "timeout" | "rate-limit" | "auth" | "server" | "client" | "network"
  | "unsupported-content" | "body-too-large" | "deferred";
export type RevalidationSourceTier = "A" | "B" | "discovery" | "unclassified";
export type RevalidationSourceClass =
  | "company-official" | "open-source" | "regulatory" | "academic" | "canonical-first-party"
  | "authoritative-media" | "discovery" | "unclassified";
export type RevalidationCanonicalArtifact =
  | "company-profile" | "company-claim-ledger" | "event-store" | "research-decision-card" | "benchmark-result-ledger";

export interface AcceptedEvidenceCanonicalMatch {
  subjectId: string;
  targetField: EvidenceTargetField;
  evidenceUrl: string;
  publicTargetUrl: string;
  canonicalArtifact: RevalidationCanonicalArtifact;
  canonicalRecordId: string;
  sourceTier: "A" | "B";
  matchedAt: string;
}

export interface AcceptedEvidenceRevalidationResult {
  acceptedEvidenceId: string;
  taskId: string;
  issueNumber: number;
  contributor: string;
  evidenceUrl: string;
  subjectId: string;
  targetField: EvidenceTargetField;
  attemptedAt: string;
  fetch: {
    status: "success" | "failed" | "deferred";
    failureCode: RevalidationFailureCode | null;
    contentType: string | null;
    byteLength: number | null;
  };
  source: { domain: string | null; tier: RevalidationSourceTier; classification: RevalidationSourceClass };
  candidateValue: string | string[] | number | null;
  checks: { entity: RevalidationCheck; sourceTier: RevalidationCheck; fieldConsistency: RevalidationCheck; conflict: RevalidationCheck; date: RevalidationCheck };
  outcome: "matched" | "insufficient" | "unsupported" | "degraded" | "deferred";
  canonicalMatch: AcceptedEvidenceCanonicalMatch | null;
}

export interface AcceptedEvidenceRevalidationArtifact {
  schemaVersion: 1;
  generatedAt: string;
  status: "success" | "degraded";
  results: AcceptedEvidenceRevalidationResult[];
}

export interface AcceptedEvidenceRevalidationInput {
  accepted: AcceptedEvidenceArtifact;
  previous?: AcceptedEvidenceRevalidationArtifact;
  companies: CompanyProfile[];
  events: EventRecord[];
  companyClaimLedger: CompanyClaimLedger;
  researchDecisionCards: ResearchDecisionCard[];
  researchRecords: ResearchRecord[];
  benchmarkResultLedger: BenchmarkResultLedger;
  decisionProducts: DecisionProductArtifact;
  pagesBaseUrl: string;
  sources: SourceConfig[];
  now: Date;
}

export interface AcceptedEvidenceRevalidationOptions {
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  attempts?: number;
  maxBodyBytes?: number;
  concurrency?: number;
  maxTargets?: number;
}

interface FetchedDocument {
  body: string;
  domain: string;
  contentType: string;
  byteLength: number;
}

interface CanonicalSubjectBinding {
  company?: CompanyProfile;
  companyId?: string;
  event?: EventRecord;
  researchCard?: ResearchDecisionCard;
  researchRecord?: ResearchRecord;
}

type Evaluation = Pick<AcceptedEvidenceRevalidationResult, "candidateValue" | "checks" | "outcome" | "canonicalMatch">;

const RESULT_KEYS = ["acceptedEvidenceId", "taskId", "issueNumber", "contributor", "evidenceUrl", "subjectId", "targetField", "attemptedAt", "fetch", "source", "candidateValue", "checks", "outcome", "canonicalMatch"] as const;
const FETCH_KEYS = ["status", "failureCode", "contentType", "byteLength"] as const;
const SOURCE_KEYS = ["domain", "tier", "classification"] as const;
const CHECK_KEYS = ["entity", "sourceTier", "fieldConsistency", "conflict", "date"] as const;
const MATCH_KEYS = ["subjectId", "targetField", "evidenceUrl", "publicTargetUrl", "canonicalArtifact", "canonicalRecordId", "sourceTier", "matchedAt"] as const;
const ARTIFACT_KEYS = ["schemaVersion", "generatedAt", "status", "results"] as const;
const CHECKS = new Set<RevalidationCheck>(["pass", "fail", "unknown"]);
const OUTCOMES = new Set<AcceptedEvidenceRevalidationResult["outcome"]>(["matched", "insufficient", "unsupported", "degraded", "deferred"]);
const TIERS = new Set<RevalidationSourceTier>(["A", "B", "discovery", "unclassified"]);
const CLASSES = new Set<RevalidationSourceClass>(["company-official", "open-source", "regulatory", "academic", "canonical-first-party", "authoritative-media", "discovery", "unclassified"]);
const CANONICAL_ARTIFACTS = new Set<RevalidationCanonicalArtifact>(["company-profile", "company-claim-ledger", "event-store", "research-decision-card", "benchmark-result-ledger"]);
const FAILURE_CODES = new Set<RevalidationFailureCode>(["unsafe-url", "unsafe-redirect", "timeout", "rate-limit", "auth", "server", "client", "network", "unsupported-content", "body-too-large", "deferred"]);
const CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain", "application/json", "application/ld+json"]);
const MAX_BODY_BYTES = 512_000;
const ACCEPTED_ID = /^[a-f0-9]{64}$/;
const CANONICAL_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CONFLICT = /冲突|矛盾|不一致|conflict|contradict/i;
const COMPANY_CLAIM_FIELDS = new Map<EvidenceTargetField, keyof CompanyClaimFields>([
  ["funding.round", "round"], ["funding.amount", "amount"], ["funding.valuation", "valuation"], ["funding.investors", "investors"],
]);

function exactObject(value: unknown, keys: readonly string[], path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid accepted evidence revalidation: ${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`Invalid accepted evidence revalidation: ${path} must have exact keys`);
}

function candidateValue(value: unknown): value is AcceptedEvidenceRevalidationResult["candidateValue"] {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value === "string") return value.trim().length > 0 && value === value.trim();
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0 && item === item.trim())
    && value.every((item, index) => index === 0 || String(value[index - 1]) < String(item));
}

function normalizedCandidateValue(value: unknown): AcceptedEvidenceRevalidationResult["candidateValue"] {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value) && value >= 0)) return value;
  if (Array.isArray(value)) {
    const strings = [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].sort();
    return strings.length ? strings : null;
  }
  return null;
}

function canonicalDomain(value: unknown, evidenceUrl: string): value is string {
  if (typeof value !== "string" || value !== value.toLowerCase() || !CANONICAL_HOSTNAME.test(value)) return false;
  return value === new URL(evidenceUrl).hostname.toLowerCase();
}

function sourcePairIsValid(tier: RevalidationSourceTier, classification: RevalidationSourceClass): boolean {
  if (tier === "A") return ["company-official", "open-source", "regulatory", "academic", "canonical-first-party"].includes(classification);
  if (tier === "B") return classification === "authoritative-media";
  if (tier === "discovery") return classification === "discovery";
  return classification === "unclassified";
}

export function assertAcceptedEvidenceRevalidationArtifact(value: unknown): asserts value is AcceptedEvidenceRevalidationArtifact {
  assertCommunityEvidencePrivateBoundary(value, "acceptedEvidenceRevalidation");
  exactObject(value, ARTIFACT_KEYS, "artifact");
  if (value.schemaVersion !== 1 || !isCanonicalCommunityTimestamp(value.generatedAt)
    || !["success", "degraded"].includes(String(value.status)) || !Array.isArray(value.results)) {
    throw new Error("Invalid accepted evidence revalidation: artifact header is invalid");
  }
  const generatedAt = Date.parse(value.generatedAt as string);
  const identities = new Set<string>();
  (value.results as unknown[]).forEach((item, index) => {
    const path = `artifact.results[${index}]`;
    exactObject(item, RESULT_KEYS, path);
    exactObject(item.fetch, FETCH_KEYS, `${path}.fetch`);
    exactObject(item.source, SOURCE_KEYS, `${path}.source`);
    exactObject(item.checks, CHECK_KEYS, `${path}.checks`);
    const identity = `${String(item.acceptedEvidenceId)}\n${String(item.attemptedAt)}`;
    if (typeof item.acceptedEvidenceId !== "string" || !ACCEPTED_ID.test(item.acceptedEvidenceId) || identities.has(identity)) throw new Error(`Invalid accepted evidence revalidation: ${path} identity is invalid`);
    identities.add(identity);
    if (!isCommunityEvidenceTaskId(item.taskId) || !isPositiveCommunityIssueNumber(item.issueNumber) || !isHumanContributorLogin(item.contributor)
      || !isNormalizedCommunityHttpsUrl(item.evidenceUrl) || typeof item.subjectId !== "string" || !item.subjectId.trim()
      || !isEvidenceTargetField(item.targetField) || !isCanonicalCommunityTimestamp(item.attemptedAt)
      || Date.parse(item.attemptedAt) > generatedAt) throw new Error(`Invalid accepted evidence revalidation: ${path} binding is invalid`);
    if (!candidateValue(item.candidateValue)) throw new Error(`Invalid accepted evidence revalidation: ${path}.candidateValue is invalid`);
    if (!TIERS.has(item.source.tier as RevalidationSourceTier) || !CLASSES.has(item.source.classification as RevalidationSourceClass)
      || !sourcePairIsValid(item.source.tier as RevalidationSourceTier, item.source.classification as RevalidationSourceClass)) throw new Error(`Invalid accepted evidence revalidation: ${path}.source is invalid`);
    const fetchStatus = String(item.fetch.status);
    if (!["success", "failed", "deferred"].includes(fetchStatus)
      || (item.fetch.failureCode !== null && !FAILURE_CODES.has(item.fetch.failureCode as RevalidationFailureCode))) throw new Error(`Invalid accepted evidence revalidation: ${path}.fetch is invalid`);
    if (fetchStatus === "success") {
      if (item.fetch.failureCode !== null || typeof item.fetch.contentType !== "string" || !CONTENT_TYPES.has(item.fetch.contentType)
        || !Number.isInteger(item.fetch.byteLength) || Number(item.fetch.byteLength) < 0 || Number(item.fetch.byteLength) > MAX_BODY_BYTES
        || !canonicalDomain(item.source.domain, item.evidenceUrl as string)) throw new Error(`Invalid accepted evidence revalidation: ${path}.fetch success is invalid`);
    } else if (item.fetch.failureCode === null || item.fetch.contentType !== null || item.fetch.byteLength !== null
      || item.source.domain !== null || item.source.tier !== "unclassified" || item.source.classification !== "unclassified"
      || item.candidateValue !== null || !Object.values(item.checks).every((check) => check === "unknown")) {
      throw new Error(`Invalid accepted evidence revalidation: ${path}.fetch failure is invalid`);
    }
    if (!Object.values(item.checks).every((check) => CHECKS.has(check as RevalidationCheck))
      || !OUTCOMES.has(item.outcome as AcceptedEvidenceRevalidationResult["outcome"])) throw new Error(`Invalid accepted evidence revalidation: ${path} checks are invalid`);
    if ((fetchStatus === "success") !== ["matched", "insufficient", "unsupported"].includes(String(item.outcome))
      || (fetchStatus === "failed") !== (item.outcome === "degraded")
      || (fetchStatus === "deferred") !== (item.outcome === "deferred")) throw new Error(`Invalid accepted evidence revalidation: ${path} outcome disagrees with fetch`);
    if (item.canonicalMatch !== null) {
      exactObject(item.canonicalMatch, MATCH_KEYS, `${path}.canonicalMatch`);
      if (item.outcome !== "matched" || fetchStatus !== "success" || item.candidateValue === null
        || !Object.values(item.checks).every((check) => check === "pass")
        || item.canonicalMatch.subjectId !== item.subjectId || item.canonicalMatch.targetField !== item.targetField
        || item.canonicalMatch.evidenceUrl !== item.evidenceUrl || !isNormalizedCommunityPublicTargetUrl(item.canonicalMatch.publicTargetUrl)
        || !CANONICAL_ARTIFACTS.has(item.canonicalMatch.canonicalArtifact as RevalidationCanonicalArtifact)
        || typeof item.canonicalMatch.canonicalRecordId !== "string" || !item.canonicalMatch.canonicalRecordId.trim()
        || item.canonicalMatch.sourceTier !== item.source.tier || !["A", "B"].includes(String(item.canonicalMatch.sourceTier))
        || item.canonicalMatch.matchedAt !== item.attemptedAt) throw new Error(`Invalid accepted evidence revalidation: ${path}.canonicalMatch is invalid`);
    } else if (item.outcome === "matched") throw new Error(`Invalid accepted evidence revalidation: ${path} matched outcome lacks proof`);
  });
  const results = value.results as unknown as AcceptedEvidenceRevalidationResult[];
  if (results.some((item, index) => index > 0 && (results[index - 1]!.attemptedAt > item.attemptedAt
    || (results[index - 1]!.attemptedAt === item.attemptedAt && results[index - 1]!.acceptedEvidenceId >= item.acceptedEvidenceId)))) throw new Error("Invalid accepted evidence revalidation: results must be sorted");
  const current = results.filter((item) => item.attemptedAt === value.generatedAt);
  const degraded = current.some((item) => item.outcome === "degraded" || item.outcome === "deferred");
  if ((value.status === "success") === degraded) throw new Error("Invalid accepted evidence revalidation: aggregate status disagrees");
}

function privateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224;
}

function privateIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 4) return privateIpv4(normalized);
  if (version !== 6) return true;
  if (normalized.startsWith("::ffff:") || /^(?:0{1,4}:){5}ffff:/.test(normalized)) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return privateIpv4(mapped);
  return normalized === "::" || normalized === "::1" || /^(?:fc|fd|fe[89ab]|ff)/i.test(normalized) || /^2001:db8:/i.test(normalized);
}

function safeRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && Boolean(hostname)
      && hostname !== "localhost" && !hostname.endsWith(".localhost") && !hostname.endsWith(".local")
      && (isIP(hostname) === 0 || !privateIp(hostname));
  } catch { return false; }
}

async function resolvedPublicAddresses(hostname: string, options: AcceptedEvidenceRevalidationOptions): Promise<string[]> {
  if (isIP(hostname)) return privateIp(hostname) ? [] : [hostname];
  const addresses = options.resolveHost
    ? await options.resolveHost(hostname)
    : (await lookupDns(hostname, { all: true, verbatim: true })).map((item) => item.address);
  const unique = [...new Set(addresses.map((item) => item.toLowerCase()))];
  return unique.length && unique.every((address) => isIP(address) > 0 && !privateIp(address)) ? unique : [];
}

function pinnedFetch(expectedUrl: string, address: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requested = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (requested.href !== expectedUrl) throw new Error("unsafe-redirect");
    return new Promise<Response>((resolve, reject) => {
      const lookup: LookupFunction = (hostname, _options, callback) => {
        if (hostname.toLowerCase() !== requested.hostname.toLowerCase()) {
          callback(new Error("unsafe-redirect"), address, isIP(address));
          return;
        }
        callback(null, address, isIP(address));
      };
      const request = httpsRequest(requested, {
        method: init?.method ?? "GET",
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        signal: init?.signal ?? undefined,
        servername: requested.hostname,
        lookup,
      }, (incoming) => {
        const headers = new Headers();
        for (const [key, raw] of Object.entries(incoming.headers)) {
          if (Array.isArray(raw)) raw.forEach((value) => headers.append(key, value));
          else if (raw !== undefined) headers.set(key, String(raw));
        }
        const response = new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
          status: incoming.statusCode ?? 500,
          statusText: incoming.statusMessage,
          headers,
        });
        Object.defineProperty(response, "url", { value: expectedUrl });
        resolve(response);
      });
      request.on("error", reject);
      request.end();
    });
  }) as typeof fetch;
}

async function boundedText(response: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("body-too-large");
  if (!response.body) return { text: "", bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw new Error("body-too-large"); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text, bytes };
}

function failureCode(error: unknown): RevalidationFailureCode {
  if (error instanceof HttpRequestError) {
    const cause = error.cause;
    if (cause instanceof Error && cause.message === "unsafe-redirect") return "unsafe-redirect";
    return error.kind === "rate_limit" ? "rate-limit" : error.kind === "payment_required" ? "client" : error.kind;
  }
  if (error instanceof Error && (["body-too-large", "unsupported-content", "unsafe-redirect"] as string[]).includes(error.message)) return error.message as RevalidationFailureCode;
  return "network";
}

export async function fetchAcceptedEvidenceDocuments(
  entries: AcceptedEvidenceEntry[],
  options: AcceptedEvidenceRevalidationOptions = {},
): Promise<Array<{ document?: FetchedDocument; failureCode?: RevalidationFailureCode }>> {
  const maxBodyBytes = Math.max(1, Math.min(MAX_BODY_BYTES, options.maxBodyBytes ?? MAX_BODY_BYTES));
  return mapWithConcurrency(entries, options.concurrency ?? 4, async (entry) => {
    if (!safeRemoteUrl(entry.evidenceUrl)) return { failureCode: "unsafe-url" as const };
    try {
      const expected = new URL(entry.evidenceUrl);
      const addresses = await resolvedPublicAddresses(expected.hostname, options);
      if (!addresses.length) return { failureCode: "unsafe-url" as const };
      const response = await fetchWithRetry(entry.evidenceUrl, {
        redirect: "error",
        headers: { accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.8", "user-agent": "physical-ai-news-cn-evidence-revalidation" },
      }, {
        fetchImpl: options.fetchImpl ?? pinnedFetch(entry.evidenceUrl, addresses[0]!),
        sleep: options.sleep,
        timeoutMs: options.timeoutMs ?? 10_000,
        attempts: options.attempts ?? 2,
      });
      if (!response.url || new URL(response.url).href !== expected.href || !safeRemoteUrl(response.url)) throw new Error("unsafe-redirect");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!CONTENT_TYPES.has(contentType)) throw new Error("unsupported-content");
      const { text, bytes } = await boundedText(response, maxBodyBytes);
      return { document: { body: text, domain: expected.hostname.toLowerCase(), contentType, byteLength: bytes } };
    } catch (error) {
      return { failureCode: failureCode(error) };
    }
  });
}

function compact(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function sameName(left: string | undefined, right: string): boolean {
  return Boolean(left && compact(left) === compact(right));
}

function host(value: string | undefined): string | undefined {
  try { return value ? new URL(value).hostname.toLowerCase() : undefined; }
  catch { return undefined; }
}

function resolveCompany(entry: Pick<AcceptedEvidenceEntry, "subject">, companies: CompanyProfile[]): CompanyProfile | undefined {
  if (entry.subject.kind !== "company") return undefined;
  const byId = companies.filter((company) => company.entityId === entry.subject.id);
  if (byId.length === 1) return byId[0];
  const subjectHost = host(entry.subject.url);
  const matches = companies.filter((company) => {
    const names = [company.name, company.legalName, ...(company.aliases ?? [])];
    if (!names.some((name) => sameName(name, entry.subject.name))) return false;
    const official = new Set([host(company.officialUrl), ...(company.officialDomains ?? []).map((item) => item.toLowerCase())].filter((item): item is string => Boolean(item)));
    return !subjectHost || official.size === 0 || [...official].some((domain) => subjectHost === domain || subjectHost.endsWith(`.${domain}`));
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function companyForEvent(event: EventRecord | undefined, companies: CompanyProfile[]): CompanyProfile | undefined {
  if (!event?.primaryEntity) return undefined;
  const matches = companies.filter((company) => [company.name, company.legalName, ...(company.aliases ?? [])].some((name) => sameName(name, event.primaryEntity!)));
  return matches.length === 1 ? matches[0] : undefined;
}

function subjectBinding(
  entry: Pick<AcceptedEvidenceEntry, "subject">,
  input: Pick<AcceptedEvidenceRevalidationInput, "companies" | "events" | "researchDecisionCards" | "researchRecords">,
): CanonicalSubjectBinding {
  if (entry.subject.kind === "company") {
    const company = resolveCompany(entry, input.companies);
    return { company, companyId: company?.entityId };
  }
  if (entry.subject.kind === "event") {
    const event = input.events.find((item) => item.id === entry.subject.id);
    const company = companyForEvent(event, input.companies);
    return { event, company, companyId: company?.entityId };
  }
  return {
    researchCard: input.researchDecisionCards.find((item) => item.identity.paperId.value === entry.subject.id),
    researchRecord: input.researchRecords.find((item) => item.id === entry.subject.id),
  };
}

function sourceMatchesUrl(source: SourceConfig, evidenceUrl: string): boolean {
  if (source.status === "已暂停") return false;
  const url = new URL(evidenceUrl);
  if (source.type === "github-releases") {
    if (url.hostname.toLowerCase() !== "github.com") return false;
    const path = url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
    const repo = source.repo.replace(/^\/+|\/+$/g, "").toLowerCase();
    return path === repo || path.startsWith(`${repo}/`);
  }
  if (source.type !== "rss" && source.type !== "webpage" && source.type !== "sitemap") return false;
  const sourceHost = host(source.url);
  return Boolean(sourceHost && (url.hostname.toLowerCase() === sourceHost || url.hostname.toLowerCase().endsWith(`.${sourceHost}`)));
}

function sourceClass(source: SourceConfig): Omit<AcceptedEvidenceRevalidationResult["source"], "domain"> {
  if (source.tier === "线索发现层" || source.publicationPolicy === "仅作线索发现" || source.role === "线索发现") return { tier: "discovery", classification: "discovery" };
  if (source.tier === "权威产业媒体" || source.publicationPolicy === "可作为独立报道" || source.role === "产业媒体") return { tier: "B", classification: "authoritative-media" };
  if (source.tier === "开源发布" || source.role === "代码发布") return { tier: "A", classification: "open-source" };
  if (source.role === "监管披露") return { tier: "A", classification: "regulatory" };
  if (source.role === "学术索引") return { tier: "A", classification: "academic" };
  return { tier: "A", classification: "company-official" };
}

function claimEvent(claim: CompanyClaim, entry: Pick<AcceptedEvidenceEntry, "evidenceUrl">, events: EventRecord[]): EventRecord | undefined {
  return events.find((event) => claim.eventIds.includes(event.id) && event.evidence.some((evidence) => evidence.link === entry.evidenceUrl));
}

function exactEventEvidence(
  entry: Pick<AcceptedEvidenceEntry, "evidenceUrl">,
  binding: CanonicalSubjectBinding,
  input: Pick<AcceptedEvidenceRevalidationInput, "companyClaimLedger" | "events">,
) {
  if (binding.event) return binding.event.evidence.find((item) => item.link === entry.evidenceUrl);
  if (!binding.companyId) return undefined;
  const ledger = input.companyClaimLedger.companies.find((item) => item.companyId === binding.companyId);
  const eventIds = new Set((ledger?.claims ?? []).filter((claim) => claim.evidenceUrls.includes(entry.evidenceUrl)).flatMap((claim) => claim.eventIds));
  return input.events.find((event) => eventIds.has(event.id))?.evidence.find((item) => item.link === entry.evidenceUrl);
}

function classifySource(
  evidenceUrl: string,
  entry: AcceptedEvidenceEntry,
  binding: CanonicalSubjectBinding,
  input: AcceptedEvidenceRevalidationInput,
): AcceptedEvidenceRevalidationResult["source"] {
  const domain = new URL(evidenceUrl).hostname.toLowerCase();
  const matching = input.sources.filter((source) => sourceMatchesUrl(source, evidenceUrl)
    && (!source.entityIds?.length || Boolean(binding.companyId && source.entityIds.includes(binding.companyId))));
  if (matching.length) {
    const classes = matching.map(sourceClass);
    const unique = new Map(classes.map((item) => [`${item.tier}\n${item.classification}`, item]));
    if (unique.size === 1) return { domain, ...unique.values().next().value! };
    return { domain, tier: "unclassified", classification: "unclassified" };
  }
  const officialDomains = binding.company
    ? [host(binding.company.officialUrl), ...(binding.company.officialDomains ?? []).map((item) => item.toLowerCase())].filter((item): item is string => Boolean(item))
    : [];
  if (officialDomains.some((official) => domain === official || domain.endsWith(`.${official}`))) return { domain, tier: "A", classification: "company-official" };
  const exactEvidence = exactEventEvidence(entry, binding, input);
  if (exactEvidence?.grade === "B") return { domain, tier: "B", classification: "authoritative-media" };
  if (exactEvidence?.grade === "A") {
    if (domain === "github.com" || domain === "huggingface.co") return { domain, tier: "A", classification: "open-source" };
    return { domain, tier: "A", classification: "canonical-first-party" };
  }
  if (entry.subject.kind === "research") {
    if (domain === "github.com" || domain === "huggingface.co") return { domain, tier: "A", classification: "open-source" };
    if (domain === "arxiv.org" || domain === "openalex.org" || domain.endsWith(".edu")) return { domain, tier: "A", classification: "academic" };
  }
  return { domain, tier: "unclassified", classification: "unclassified" };
}

function bodyContainsValue(body: string, value: unknown): boolean {
  const values = Array.isArray(value) ? value : [value];
  const normalized = compact(body);
  return values.length > 0 && values.every((item) => item !== "unknown" && normalized.includes(compact(String(item))));
}

function fieldMatchesBody(entry: Pick<AcceptedEvidenceEntry, "targetField" | "evidenceUrl">, body: string, value: unknown): boolean {
  if ((entry.targetField.endsWith("Url") || entry.targetField === "funding.regulatoryFiling")
    && typeof value === "string" && value === entry.evidenceUrl) return true;
  return bodyContainsValue(body, value);
}

function entityMatches(body: string, entry: Pick<AcceptedEvidenceEntry, "subject">, binding: CanonicalSubjectBinding): boolean {
  const identities = [entry.subject.name, entry.subject.id];
  if (binding.company) identities.push(binding.company.name, binding.company.legalName ?? "", ...(binding.company.aliases ?? []));
  if (binding.event) identities.push(binding.event.title, binding.event.primaryEntity ?? "", ...binding.event.entities);
  if (binding.researchRecord) identities.push(binding.researchRecord.article.title, binding.researchRecord.article.titleZh ?? "");
  return identities.some((identity) => identity.length >= 3 && compact(body).includes(compact(identity)));
}

function canonicalEventProof(
  entry: Pick<AcceptedEvidenceEntry, "evidenceUrl">,
  event: EventRecord | undefined,
  now: Date,
): { source: RevalidationCheck; date: RevalidationCheck; grade?: "A" | "B" } {
  const evidence = event?.evidence.find((item) => item.link === entry.evidenceUrl);
  if (!event || !evidence) return { source: "unknown", date: "unknown" };
  const publication = derivePublication({ evidence: event.evidence });
  const publishedAt = Date.parse(evidence.publishedAt);
  return {
    source: publication.publicEligible && publication.qualifyingEvidenceIds.includes(entry.evidenceUrl) ? "pass" : "fail",
    date: Number.isFinite(publishedAt) && publishedAt <= now.getTime() ? "pass" : "fail",
    grade: evidence.grade === "A" || evidence.grade === "B" ? evidence.grade : undefined,
  };
}

function researchField(card: ResearchDecisionCard | undefined, targetField: EvidenceTargetField): { value: unknown; evidenceUrls: string[] } | undefined {
  if (!card) return undefined;
  return new Map<EvidenceTargetField, { value: unknown; evidenceUrls: string[] }>([
    ["research.codeUrl", card.artifacts.code], ["research.datasetUrl", card.artifacts.data],
    ["research.weightsUrl", card.artifacts.weights], ["research.realRobotEvidence", card.realRobotTrials],
    ["research.institutions", card.lab],
  ]).get(targetField);
}

function eventField(event: EventRecord | undefined, targetField: EvidenceTargetField): unknown {
  if (!event) return undefined;
  if (targetField === "product.officialUrl") return event.productDeployment?.product && /^https:\/\//.test(event.productDeployment.product) ? event.productDeployment.product : undefined;
  if (targetField === "product.releaseDate") return event.eventDate ?? event.occurredAt;
  if (targetField === "deployment.customer") return event.productDeployment?.customers;
  if (targetField === "deployment.location" || targetField === "deployment.scale") return event.productDeployment?.deployment;
  return undefined;
}

function normalizedBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return undefined;
    return url.href.replace(/\/$/, "");
  } catch { return undefined; }
}

function companyPublicTarget(
  entry: Pick<AcceptedEvidenceEntry, "targetField" | "evidenceUrl">,
  companyId: string,
  products: DecisionProductArtifact,
  pagesBaseUrl: string,
): string | undefined {
  const card = products.companyCards.find((item) => item.companyId === companyId);
  if (!card) return undefined;
  const evidence = entry.targetField.startsWith("funding.") ? card.capital.evidence : [];
  const publicField = (entry.targetField === "company.officialUrl" && card.officialUrl === entry.evidenceUrl)
    || (entry.targetField === "company.officialName" && card.companyName.trim().length > 0)
    || evidence.some((item) => item.url === entry.evidenceUrl);
  return publicField ? `${pagesBaseUrl}/companies.html#${card.cardId}` : undefined;
}

function eventPublicTarget(
  entry: Pick<AcceptedEvidenceEntry, "evidenceUrl">,
  eventId: string,
  products: DecisionProductArtifact,
  pagesBaseUrl: string,
): string | undefined {
  const signal = products.topSignals.find((item) => item.eventId === eventId && item.evidence.some((evidence) => evidence.url === entry.evidenceUrl));
  return signal ? `${pagesBaseUrl}/?signal=${encodeURIComponent(signal.signalId)}` : undefined;
}

function researchPublicTarget(
  entry: Pick<AcceptedEvidenceEntry, "targetField" | "evidenceUrl">,
  paperId: string,
  products: DecisionProductArtifact,
  pagesBaseUrl: string,
): string | undefined {
  const passport = products.researchPassports.find((item) => item.paperId === paperId);
  if (!passport) return undefined;
  const present = entry.targetField === "research.codeUrl" ? passport.assets.code === entry.evidenceUrl
    : entry.targetField === "research.datasetUrl" ? passport.assets.data === entry.evidenceUrl
      : entry.targetField === "research.weightsUrl" ? passport.assets.weights === entry.evidenceUrl
        : entry.targetField === "research.realRobotEvidence" ? passport.realRobotTrials !== "unknown"
          && (passport.sourceUrl === entry.evidenceUrl || passport.benchmark.evidenceUrls.includes(entry.evidenceUrl))
          : entry.targetField === "research.institutions" ? passport.authority.labs.length > 0
            && (passport.sourceUrl === entry.evidenceUrl || `https://openalex.org/${passport.authority.openAlexWorkId}` === entry.evidenceUrl)
            : false;
  return present ? `${pagesBaseUrl}/research.html#${passport.passportId}` : undefined;
}

function expectedPublicTarget(
  entry: Pick<AcceptedEvidenceEntry, "subject" | "targetField" | "evidenceUrl">,
  match: Pick<AcceptedEvidenceCanonicalMatch, "canonicalArtifact" | "canonicalRecordId">,
  binding: CanonicalSubjectBinding,
  input: Pick<AcceptedEvidenceRevalidationInput, "decisionProducts" | "pagesBaseUrl">,
): string | undefined {
  const base = normalizedBaseUrl(input.pagesBaseUrl);
  if (!base) return undefined;
  if ((match.canonicalArtifact === "company-profile" || match.canonicalArtifact === "company-claim-ledger") && binding.companyId) {
    return companyPublicTarget(entry, binding.companyId, input.decisionProducts, base);
  }
  if (match.canonicalArtifact === "event-store" && binding.event) return eventPublicTarget(entry, binding.event.id, input.decisionProducts, base);
  if ((match.canonicalArtifact === "research-decision-card" || match.canonicalArtifact === "benchmark-result-ledger") && binding.researchCard) {
    return researchPublicTarget(entry, String(binding.researchCard.identity.paperId.value), input.decisionProducts, base);
  }
  return undefined;
}

export type CanonicalMatchValidationInput = Omit<AcceptedEvidenceRevalidationInput, "accepted" | "previous" | "sources">;

export function canonicalMatchMatchesArtifacts(
  entry: Pick<AcceptedEvidenceEntry, "subject" | "targetField" | "evidenceUrl">,
  match: AcceptedEvidenceCanonicalMatch,
  input: CanonicalMatchValidationInput,
): boolean {
  if (match.subjectId !== entry.subject.id || match.targetField !== entry.targetField || match.evidenceUrl !== entry.evidenceUrl) return false;
  const binding = subjectBinding(entry, input);
  const target = expectedPublicTarget(entry, match, binding, input);
  if (!target || target !== match.publicTargetUrl) return false;
  if (match.canonicalArtifact === "company-profile") {
    if (!binding.company || !binding.companyId || match.canonicalRecordId !== binding.companyId || match.sourceTier !== "A") return false;
    if (entry.targetField === "company.officialUrl") return binding.company.officialUrl === entry.evidenceUrl;
    if (entry.targetField === "company.officialName") return Boolean(binding.company.profileEvidence?.some((item) => item.link === entry.evidenceUrl));
    return false;
  }
  if (match.canonicalArtifact === "company-claim-ledger") {
    const ledger = input.companyClaimLedger.companies.find((item) => item.companyId === binding.companyId);
    const claim = ledger?.claims.find((item) => item.claimId === match.canonicalRecordId);
    if (!claim) return false;
    const event = claimEvent(claim, entry, input.events);
    const proof = canonicalEventProof(entry, event, input.now);
    if (entry.targetField === "funding.regulatoryFiling") return proof.source === "pass" && proof.date === "pass" && proof.grade === match.sourceTier;
    const fieldKey = COMPANY_CLAIM_FIELDS.get(entry.targetField);
    const field = fieldKey ? claim.fields[fieldKey] as LedgerField<unknown> : undefined;
    return Boolean(field && field.status === "verified" && field.evidenceUrls.includes(entry.evidenceUrl)
      && proof.source === "pass" && proof.date === "pass" && proof.grade === match.sourceTier);
  }
  if (match.canonicalArtifact === "event-store") {
    const value = eventField(binding.event, entry.targetField);
    const proof = canonicalEventProof(entry, binding.event, input.now);
    return match.canonicalRecordId === binding.event?.id && value !== undefined && value !== "unknown"
      && proof.source === "pass" && proof.date === "pass" && proof.grade === match.sourceTier;
  }
  if (match.canonicalArtifact === "research-decision-card") {
    const field = researchField(binding.researchCard, entry.targetField);
    const publishedAt = binding.researchRecord?.article.publishedAt instanceof Date
      ? binding.researchRecord.article.publishedAt.getTime() : Date.parse(String(binding.researchRecord?.article.publishedAt));
    return match.sourceTier === "A" && match.canonicalRecordId === entry.subject.id && Boolean(binding.researchCard && binding.researchRecord
      && binding.researchCard.eligibleForTopResearch && binding.researchCard.gates.length === 0
      && binding.researchCard.openAlex.retraction.value !== true && binding.researchCard.openAlex.freshness.value !== "stale"
      && field && field.value !== "unknown" && field.evidenceUrls.includes(entry.evidenceUrl)
      && Number.isFinite(publishedAt) && publishedAt <= input.now.getTime());
  }
  if (match.canonicalArtifact === "benchmark-result-ledger") {
    const benchmark = input.benchmarkResultLedger.entries.find((item) => item.entryId === match.canonicalRecordId
      && item.paperId === entry.subject.id && item.gateCodes.length === 0);
    return Boolean(benchmark && Object.values(benchmark.fields).some((field) => field.status === "verified" && field.evidenceUrls.includes(entry.evidenceUrl)));
  }
  return false;
}

function canonicalMatch(
  entry: AcceptedEvidenceEntry,
  source: AcceptedEvidenceRevalidationResult["source"],
  canonicalArtifact: RevalidationCanonicalArtifact,
  canonicalRecordId: string,
  binding: CanonicalSubjectBinding,
  input: AcceptedEvidenceRevalidationInput,
): AcceptedEvidenceCanonicalMatch | null {
  if (source.tier !== "A" && source.tier !== "B") return null;
  const publicTargetUrl = expectedPublicTarget(entry, { canonicalArtifact, canonicalRecordId }, binding, input);
  if (!publicTargetUrl) return null;
  const match: AcceptedEvidenceCanonicalMatch = {
    subjectId: entry.subject.id,
    targetField: entry.targetField,
    evidenceUrl: entry.evidenceUrl,
    publicTargetUrl,
    canonicalArtifact,
    canonicalRecordId,
    sourceTier: source.tier,
    matchedAt: input.now.toISOString(),
  };
  return canonicalMatchMatchesArtifacts(entry, match, input) ? match : null;
}

function companyEvaluation(
  entry: AcceptedEvidenceEntry,
  body: string,
  source: AcceptedEvidenceRevalidationResult["source"],
  input: AcceptedEvidenceRevalidationInput,
  binding: CanonicalSubjectBinding,
): Evaluation {
  const entityCheck = binding.company && entityMatches(body, entry, binding) ? "pass" as const : "fail" as const;
  if (!binding.company || !binding.companyId) return {
    candidateValue: null,
    checks: { entity: entityCheck, sourceTier: source.tier === "A" || source.tier === "B" ? "pass" : "fail", fieldConsistency: "unknown", conflict: "unknown", date: "unknown" },
    outcome: "insufficient",
    canonicalMatch: null,
  };
  if (entry.targetField === "company.officialUrl" || entry.targetField === "company.officialName") {
    const value = entry.targetField === "company.officialUrl" ? binding.company.officialUrl : binding.company.legalName ?? binding.company.name;
    const evidence = binding.company.profileEvidence?.find((item) => item.link === entry.evidenceUrl);
    const exactUrl = entry.targetField === "company.officialUrl" && binding.company.officialUrl === entry.evidenceUrl;
    const dateValue = evidence?.checkedAt ?? binding.company.lastVerifiedAt;
    const checks = {
      entity: entityCheck,
      sourceTier: source.tier === "A" ? "pass" as const : "fail" as const,
      fieldConsistency: (exactUrl || Boolean(evidence)) && fieldMatchesBody(entry, body, value) ? "pass" as const : "fail" as const,
      conflict: "pass" as const,
      date: dateValue && Number.isFinite(Date.parse(dateValue)) && Date.parse(dateValue) <= input.now.getTime() ? "pass" as const : "fail" as const,
    };
    const match = Object.values(checks).every((item) => item === "pass")
      ? canonicalMatch(entry, source, "company-profile", binding.companyId, binding, input) : null;
    return { candidateValue: normalizedCandidateValue(value), checks, outcome: match ? "matched" : "insufficient", canonicalMatch: match };
  }
  const ledger = input.companyClaimLedger.companies.find((item) => item.companyId === binding.companyId);
  const fieldKey = COMPANY_CLAIM_FIELDS.get(entry.targetField);
  const candidates: Array<{ claim: CompanyClaim; field?: LedgerField<unknown> }> = [];
  for (const claim of ledger?.claims ?? []) {
    if (entry.targetField === "funding.regulatoryFiling") {
      if (claim.evidenceUrls.includes(entry.evidenceUrl)) candidates.push({ claim });
      continue;
    }
    const field = fieldKey ? claim.fields[fieldKey] as LedgerField<unknown> : undefined;
    if (field?.evidenceUrls.includes(entry.evidenceUrl)) candidates.push({ claim, field });
  }
  const chosen = candidates.find((item) => !item.field || item.field.status === "verified") ?? candidates[0];
  if (!fieldKey && entry.targetField !== "funding.regulatoryFiling") return {
    candidateValue: null,
    checks: { entity: entityCheck, sourceTier: source.tier === "A" || source.tier === "B" ? "pass" : "fail", fieldConsistency: "unknown", conflict: "unknown", date: "unknown" },
    outcome: "unsupported",
    canonicalMatch: null,
  };
  const event = chosen ? claimEvent(chosen.claim, entry, input.events) : undefined;
  const proof = canonicalEventProof(entry, event, input.now);
  const value = entry.targetField === "funding.regulatoryFiling" ? entry.evidenceUrl : chosen?.field?.value;
  const checks = {
    entity: entityCheck,
    sourceTier: source.tier === proof.grade && proof.source === "pass" ? "pass" as const : "fail" as const,
    fieldConsistency: value !== undefined && value !== "unknown" && (!chosen?.field || chosen.field.status === "verified") && fieldMatchesBody(entry, body, value) ? "pass" as const : "fail" as const,
    conflict: chosen ? chosen.field?.status === "conflicted" || chosen.claim.unresolvedQuestions.some((item) => CONFLICT.test(item)) ? "fail" as const : "pass" as const : "unknown" as const,
    date: proof.date,
  };
  const match = chosen && Object.values(checks).every((item) => item === "pass")
    ? canonicalMatch(entry, source, "company-claim-ledger", chosen.claim.claimId, binding, input) : null;
  return { candidateValue: normalizedCandidateValue(value), checks, outcome: match ? "matched" : "insufficient", canonicalMatch: match };
}

function eventEvaluation(
  entry: AcceptedEvidenceEntry,
  body: string,
  source: AcceptedEvidenceRevalidationResult["source"],
  input: AcceptedEvidenceRevalidationInput,
  binding: CanonicalSubjectBinding,
): Evaluation {
  const value = eventField(binding.event, entry.targetField);
  if (!["product.officialUrl", "product.releaseDate", "deployment.customer", "deployment.location", "deployment.scale"].includes(entry.targetField)) {
    return {
      candidateValue: null,
      checks: { entity: "unknown", sourceTier: "unknown", fieldConsistency: "unknown", conflict: "unknown", date: "unknown" },
      outcome: "unsupported",
      canonicalMatch: null,
    };
  }
  const proof = canonicalEventProof(entry, binding.event, input.now);
  const checks = {
    entity: binding.event && entityMatches(body, entry, binding) ? "pass" as const : "fail" as const,
    sourceTier: source.tier === proof.grade && proof.source === "pass" ? "pass" as const : "fail" as const,
    fieldConsistency: value !== undefined && value !== "unknown" && fieldMatchesBody(entry, body, value) ? "pass" as const : "fail" as const,
    conflict: binding.event ? binding.event.openQuestions.some((item) => CONFLICT.test(item)) ? "fail" as const : "pass" as const : "unknown" as const,
    date: proof.date,
  };
  const match = binding.event && Object.values(checks).every((item) => item === "pass")
    ? canonicalMatch(entry, source, "event-store", binding.event.id, binding, input) : null;
  return { candidateValue: normalizedCandidateValue(value), checks, outcome: match ? "matched" : "insufficient", canonicalMatch: match };
}

function researchEvaluation(
  entry: AcceptedEvidenceEntry,
  body: string,
  source: AcceptedEvidenceRevalidationResult["source"],
  input: AcceptedEvidenceRevalidationInput,
  binding: CanonicalSubjectBinding,
): Evaluation {
  const field = researchField(binding.researchCard, entry.targetField);
  if (!field) return {
    candidateValue: null,
    checks: { entity: "fail", sourceTier: source.tier === "A" ? "pass" : "fail", fieldConsistency: "unknown", conflict: "unknown", date: "unknown" },
    outcome: "unsupported",
    canonicalMatch: null,
  };
  const publishedAt = binding.researchRecord?.article.publishedAt instanceof Date
    ? binding.researchRecord.article.publishedAt.getTime() : Date.parse(String(binding.researchRecord?.article.publishedAt));
  const checks = {
    entity: binding.researchCard && binding.researchRecord && entityMatches(body, entry, binding) ? "pass" as const : "fail" as const,
    sourceTier: source.tier === "A" ? "pass" as const : "fail" as const,
    fieldConsistency: field.value !== "unknown" && field.evidenceUrls.includes(entry.evidenceUrl) && fieldMatchesBody(entry, body, field.value) ? "pass" as const : "fail" as const,
    conflict: binding.researchCard ? binding.researchCard.gates.length || binding.researchCard.openAlex.retraction.value === true ? "fail" as const : "pass" as const : "unknown" as const,
    date: Number.isFinite(publishedAt) && publishedAt <= input.now.getTime() && binding.researchCard?.openAlex.freshness.value !== "stale" ? "pass" as const : "fail" as const,
  };
  const match = binding.researchCard && Object.values(checks).every((item) => item === "pass")
    ? canonicalMatch(entry, source, "research-decision-card", entry.subject.id, binding, input) : null;
  return { candidateValue: normalizedCandidateValue(field.value), checks, outcome: match ? "matched" : "insufficient", canonicalMatch: match };
}

function failedResult(entry: AcceptedEvidenceEntry, now: string, code: RevalidationFailureCode, deferred = false): AcceptedEvidenceRevalidationResult {
  return {
    acceptedEvidenceId: entry.id,
    taskId: entry.taskId,
    issueNumber: entry.issueNumber,
    contributor: entry.contributor,
    evidenceUrl: entry.evidenceUrl,
    subjectId: entry.subject.id,
    targetField: entry.targetField,
    attemptedAt: now,
    fetch: { status: deferred ? "deferred" : "failed", failureCode: code, contentType: null, byteLength: null },
    source: { domain: null, tier: "unclassified", classification: "unclassified" },
    candidateValue: null,
    checks: { entity: "unknown", sourceTier: "unknown", fieldConsistency: "unknown", conflict: "unknown", date: "unknown" },
    outcome: deferred ? "deferred" : "degraded",
    canonicalMatch: null,
  };
}

function lastCompletedAttempt(entry: AcceptedEvidenceEntry, previous: AcceptedEvidenceRevalidationArtifact | undefined): number {
  const attempts = (previous?.results ?? []).filter((item) => item.acceptedEvidenceId === entry.id && item.fetch.status !== "deferred")
    .map((item) => Date.parse(item.attemptedAt)).filter(Number.isFinite);
  return attempts.length ? Math.max(...attempts) : Number.NEGATIVE_INFINITY;
}

export async function revalidateAcceptedEvidence(
  input: AcceptedEvidenceRevalidationInput,
  options: AcceptedEvidenceRevalidationOptions = {},
): Promise<{ artifact: AcceptedEvidenceRevalidationArtifact; status: RuntimeStatus }> {
  assertAcceptedEvidenceArtifact(input.accepted);
  if (input.previous) assertAcceptedEvidenceRevalidationArtifact(input.previous);
  if (!Number.isFinite(input.now.getTime()) || input.accepted.entries.some((entry) => Date.parse(entry.acceptedAt) > input.now.getTime())) {
    throw new Error("Accepted evidence revalidation clock is invalid");
  }
  const now = input.now.toISOString();
  const ordered = [...input.accepted.entries].sort((left, right) => lastCompletedAttempt(left, input.previous) - lastCompletedAttempt(right, input.previous)
    || left.id.localeCompare(right.id));
  const maxTargets = Math.max(0, options.maxTargets ?? 20);
  const attempted = ordered.slice(0, maxTargets);
  const fetched = await fetchAcceptedEvidenceDocuments(attempted, options);
  const currentResults = attempted.map((entry, index): AcceptedEvidenceRevalidationResult => {
    const observation = fetched[index]!;
    if (!observation.document) return failedResult(entry, now, observation.failureCode ?? "network");
    const binding = subjectBinding(entry, input);
    const source = classifySource(entry.evidenceUrl, entry, binding, input);
    const evaluation = entry.subject.kind === "company" ? companyEvaluation(entry, observation.document.body, source, input, binding)
      : entry.subject.kind === "event" ? eventEvaluation(entry, observation.document.body, source, input, binding)
        : researchEvaluation(entry, observation.document.body, source, input, binding);
    return {
      acceptedEvidenceId: entry.id,
      taskId: entry.taskId,
      issueNumber: entry.issueNumber,
      contributor: entry.contributor,
      evidenceUrl: entry.evidenceUrl,
      subjectId: entry.subject.id,
      targetField: entry.targetField,
      attemptedAt: now,
      fetch: { status: "success", failureCode: null, contentType: observation.document.contentType, byteLength: observation.document.byteLength },
      source,
      ...evaluation,
    };
  });
  currentResults.push(...ordered.slice(maxTargets).map((entry) => failedResult(entry, now, "deferred", true)));
  const currentKeys = new Set(currentResults.map((item) => `${item.acceptedEvidenceId}\n${item.attemptedAt}`));
  const results = [...(input.previous?.results ?? []).filter((item) => !currentKeys.has(`${item.acceptedEvidenceId}\n${item.attemptedAt}`)), ...currentResults]
    .sort((left, right) => left.attemptedAt.localeCompare(right.attemptedAt) || left.acceptedEvidenceId.localeCompare(right.acceptedEvidenceId));
  const currentAttempts = results.filter((item) => item.attemptedAt === now);
  const failed = currentAttempts.filter((item) => item.outcome === "degraded" || item.outcome === "deferred").length;
  const artifact: AcceptedEvidenceRevalidationArtifact = {
    schemaVersion: 1,
    generatedAt: now,
    status: failed ? "degraded" : "success",
    results,
  };
  assertAcceptedEvidenceRevalidationArtifact(artifact);
  const status: RuntimeStatus = {
    component: "EvidenceRevalidation",
    status: failed ? "部分降级" : "成功",
    attempted: currentAttempts.length,
    succeeded: currentAttempts.length - failed,
    failed,
    detail: failed
      ? "部分已采纳证据复核无法完成；所有未完成项均保持候选状态，未授权规范晋升。"
      : "已采纳证据已完成受限复核；只有当前五项检查全部通过且匹配规范公开字段的记录可晋升。",
  };
  return { artifact, status };
}
