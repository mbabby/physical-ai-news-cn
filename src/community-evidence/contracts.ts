import { createHash } from "node:crypto";

export type EvidenceTaskCategory = "company-funding" | "product-deployment" | "research-metadata";

export type EvidenceTargetField =
  | "company.officialName" | "company.officialUrl"
  | "funding.round" | "funding.amount" | "funding.valuation" | "funding.investors" | "funding.regulatoryFiling"
  | "product.officialUrl" | "product.releaseDate" | "deployment.customer" | "deployment.location" | "deployment.scale"
  | "research.codeUrl" | "research.datasetUrl" | "research.weightsUrl" | "research.realRobotEvidence" | "research.institutions";

export interface EvidenceSubject {
  kind: "company" | "event" | "research";
  id: string;
  name: string;
  url: string;
}

export interface EvidenceTaskSeed {
  id: string;
  version: number;
  category: EvidenceTaskCategory;
  subject: EvidenceSubject;
  targetField: EvidenceTargetField;
  contextZh: string;
  referenceUrls: string[];
  suggestedLocations: string[];
  qualifiedEvidenceZh: string[];
  disqualifiedEvidenceZh: string[];
  replyTemplateZh: string;
  estimatedMinutes: 2;
  generatedWeek: string;
  materialVersion: string;
  supersedesTaskId: string | null;
}

export interface EvidenceTaskSeedArtifact {
  schemaVersion: 1;
  generatedAt: string;
  generatedWeek: string;
  seeds: EvidenceTaskSeed[];
}

export interface EvidenceIssue {
  number: number;
  taskId: string;
  taskVersion: number;
  state: "open" | "closed";
  labels: string[];
  authorLogin: string;
  authorAssociation: "COLLABORATOR" | "CONTRIBUTOR" | "FIRST_TIMER" | "FIRST_TIME_CONTRIBUTOR" | "MANNEQUIN" | "MEMBER" | "NONE" | "OWNER";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  evidenceUrls: string[];
  submittedEvidence: EvidenceIssueSubmittedEvidence[];
  acceptedContributors: string[];
  acceptedEvidence: EvidenceIssueAcceptedEvidence[];
}

export interface EvidenceIssueSubmittedEvidence {
  contributor: string;
  evidenceUrl: string;
  submittedAt: string;
}

export interface EvidenceIssueAcceptedEvidence {
  contributor: string;
  evidenceUrl: string;
}

export interface EvidenceIssueSnapshot {
  schemaVersion: 1;
  fetchedAt: string;
  repo: string;
  issues: EvidenceIssue[];
}

export type EvidenceTaskState = "ready" | "open" | "contributed" | "accepted" | "rejected" | "stale" | "closed" | "superseded";

export interface EvidenceTaskLedgerEntry {
  taskId: string;
  taskVersion: number;
  category: EvidenceTaskCategory;
  subject: EvidenceSubject;
  targetField: EvidenceTargetField;
  materialVersion: string;
  supersedesTaskId: string | null;
  issueNumber: number | null;
  issueUrl: string | null;
  state: EvidenceTaskState;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  closedAt: string | null;
}

export interface EvidenceTaskLedgerArtifact {
  schemaVersion: 1;
  generatedAt: string;
  entries: EvidenceTaskLedgerEntry[];
}

export interface AcceptedEvidenceEntry {
  id: string;
  taskId: string;
  issueNumber: number;
  category: EvidenceTaskCategory;
  subject: EvidenceSubject;
  targetField: EvidenceTargetField;
  contributor: string;
  evidenceUrl: string;
  acceptedAt: string;
}

export interface AcceptedEvidenceArtifact {
  schemaVersion: 1;
  generatedAt: string;
  entries: AcceptedEvidenceEntry[];
}

export type ContributionState = "submitted" | "accepted" | "promoted" | "corrected" | "withdrawn";

export interface ContributionStateEvent {
  id: string;
  taskId: string;
  issueNumber: number;
  contributor: string;
  evidenceUrl: string;
  category: EvidenceTaskCategory;
  subject: EvidenceSubject;
  targetField: EvidenceTargetField;
  state: ContributionState;
  occurredAt: string;
  sourceUrl: string;
  publicTargetUrl: string | null;
}

export interface ContributionLedgerArtifact {
  schemaVersion: 1;
  generatedAt: string;
  events: ContributionStateEvent[];
}

export interface CommunityTaskPublicView {
  id: string;
  version: number;
  category: EvidenceTaskCategory;
  subject: EvidenceSubject;
  targetField: EvidenceTargetField;
  contextZh: string;
  issueNumber: number;
  issueUrl: string;
  estimatedMinutes: 2;
  generatedWeek: string;
  state: "open" | "contributed";
}

export interface CommunityTaskPublicArtifact {
  schemaVersion: 1;
  generatedAt: string;
  tasks: CommunityTaskPublicView[];
}

const CATEGORIES = new Set<EvidenceTaskCategory>(["company-funding", "product-deployment", "research-metadata"]);
const TARGET_FIELDS = new Set<EvidenceTargetField>([
  "company.officialName", "company.officialUrl",
  "funding.round", "funding.amount", "funding.valuation", "funding.investors", "funding.regulatoryFiling",
  "product.officialUrl", "product.releaseDate", "deployment.customer", "deployment.location", "deployment.scale",
  "research.codeUrl", "research.datasetUrl", "research.weightsUrl", "research.realRobotEvidence", "research.institutions",
]);
const ISSUE_ASSOCIATIONS = new Set<EvidenceIssue["authorAssociation"]>([
  "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN", "MEMBER", "NONE", "OWNER",
]);
const TASK_STATES = new Set<EvidenceTaskState>(["ready", "open", "contributed", "accepted", "rejected", "stale", "closed", "superseded"]);
const CONTRIBUTION_STATES = new Set<ContributionState>(["submitted", "accepted", "promoted", "corrected", "withdrawn"]);
const PUBLIC_TASK_STATES = new Set<CommunityTaskPublicView["state"]>(["open", "contributed"]);
const SUBJECT_KINDS = new Set<EvidenceSubject["kind"]>(["company", "event", "research"]);
const PRIVATE_KEY_MARKERS = ["candidateid", "seedid", "score", "rank", "rawmodeloutput", "prompt", "apikey", "token", "secret"];
const PRIVATE_COMPOUND_MARKER = /(?:candidate|seed)[_ -]?id|raw[_ -]?model[_ -]?output|api[_ -]?key/i;
const PRIVATE_BOUNDARY_MARKER = /(?:^|[^A-Za-z])(?:[Ss][Cc][Oo][Rr][Ee]|[Rr][Aa][Nn][Kk]|[Pp][Rr][Oo][Mm][Pp][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt])(?:$|[^a-z])/;
const INTERNAL_REVIEW_URL = /https:\/\/[^\s"']*(?:\/|%2f|=)review(?:\/|%2f|[?#&]|$)/i;
const TASK_ID = /^evidence-task-[a-f0-9]{24}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ISO_WEEK = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HUMAN_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_BOT_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?\[bot\]$/;

const SUBJECT_KEYS = ["kind", "id", "name", "url"] as const;
const SEED_KEYS = ["id", "version", "category", "subject", "targetField", "contextZh", "referenceUrls", "suggestedLocations", "qualifiedEvidenceZh", "disqualifiedEvidenceZh", "replyTemplateZh", "estimatedMinutes", "generatedWeek", "materialVersion", "supersedesTaskId"] as const;
const SEED_ARTIFACT_KEYS = ["schemaVersion", "generatedAt", "generatedWeek", "seeds"] as const;
const ISSUE_KEYS = ["number", "taskId", "taskVersion", "state", "labels", "authorLogin", "authorAssociation", "createdAt", "updatedAt", "closedAt", "evidenceUrls", "submittedEvidence", "acceptedContributors", "acceptedEvidence"] as const;
const LEGACY_ISSUE_KEYS = ISSUE_KEYS.filter((key) => key !== "submittedEvidence");
const ISSUE_SUBMITTED_EVIDENCE_KEYS = ["contributor", "evidenceUrl", "submittedAt"] as const;
const ISSUE_ACCEPTED_EVIDENCE_KEYS = ["contributor", "evidenceUrl"] as const;
const ISSUE_SNAPSHOT_KEYS = ["schemaVersion", "fetchedAt", "repo", "issues"] as const;
const TASK_LEDGER_ENTRY_KEYS = ["taskId", "taskVersion", "category", "subject", "targetField", "materialVersion", "supersedesTaskId", "issueNumber", "issueUrl", "state", "createdAt", "updatedAt", "lastActivityAt", "closedAt"] as const;
const TASK_LEDGER_KEYS = ["schemaVersion", "generatedAt", "entries"] as const;
const ACCEPTED_ENTRY_KEYS = ["id", "taskId", "issueNumber", "category", "subject", "targetField", "contributor", "evidenceUrl", "acceptedAt"] as const;
const ACCEPTED_ARTIFACT_KEYS = ["schemaVersion", "generatedAt", "entries"] as const;
const CONTRIBUTION_EVENT_KEYS = ["id", "taskId", "issueNumber", "contributor", "evidenceUrl", "category", "subject", "targetField", "state", "occurredAt", "sourceUrl", "publicTargetUrl"] as const;
const CONTRIBUTION_ARTIFACT_KEYS = ["schemaVersion", "generatedAt", "events"] as const;
const PUBLIC_TASK_KEYS = ["id", "version", "category", "subject", "targetField", "contextZh", "issueNumber", "issueUrl", "estimatedMinutes", "generatedWeek", "state"] as const;
const PUBLIC_ARTIFACT_KEYS = ["schemaVersion", "generatedAt", "tasks"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid community evidence contract: ${message}`);
}

function exactKeys(value: unknown, expected: readonly string[], path: string): asserts value is Record<string, unknown> {
  ensure(isObject(value), `${path} must be an object with exact keys`);
  const actual = Object.keys(value).sort(compareStrings);
  const sortedExpected = [...expected].sort(compareStrings);
  ensure(actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]), `${path} must have exact keys`);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scanPrivateBoundary(value: unknown, path = "artifact"): void {
  if (typeof value === "string") {
    const decoded = decodeRepeatedly(value);
    ensure(!PRIVATE_COMPOUND_MARKER.test(decoded)
      && !PRIVATE_BOUNDARY_MARKER.test(decoded)
      && !INTERNAL_REVIEW_URL.test(decoded), `${path} violates the private boundary`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPrivateBoundary(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    ensure(!PRIVATE_KEY_MARKERS.some((marker) => normalizedKey.includes(marker)), `${path}.${key} violates the private boundary`);
    scanPrivateBoundary(nested, `${path}.${key}`);
  }
}

function decodeRepeatedly(value: string): string {
  let decoded = value;
  for (;;) {
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_match, octet: string) => String.fromCharCode(Number.parseInt(octet, 16)));
    if (next === decoded) return decoded;
    decoded = next;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function isPositiveCommunityIssueNumber(value: unknown): value is number {
  return positiveInteger(value);
}

function githubActorLogin(value: unknown): value is string {
  return typeof value === "string" && (HUMAN_LOGIN.test(value) || GITHUB_BOT_LOGIN.test(value));
}

function humanLogin(value: unknown): value is string {
  return typeof value === "string" && HUMAN_LOGIN.test(value);
}

export function isHumanContributorLogin(value: unknown): value is string {
  return humanLogin(value);
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const canonical = new Date(parsed).toISOString();
  return value === canonical || value === canonical.replace(".000Z", "Z");
}

function canonicalWeek(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_WEEK.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFirst = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const hasWeek53 = januaryFirst === 4 || (januaryFirst === 3 && leapYear);
  return week <= (hasWeek53 ? 53 : 52);
}

function normalizedHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.hash
      && url.toString() === value;
  } catch {
    return false;
  }
}

export function isNormalizedCommunityHttpsUrl(value: unknown): value is string {
  return normalizedHttpsUrl(value);
}

export function isNormalizedCommunityPublicTargetUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && url.toString() === value;
  } catch {
    return false;
  }
}

export function isCanonicalCommunityTimestamp(value: unknown): value is string {
  return canonicalTimestamp(value);
}

export function isCommunityEvidenceTaskId(value: unknown): value is string {
  return typeof value === "string" && TASK_ID.test(value);
}

export function isEvidenceTargetField(value: unknown): value is EvidenceTargetField {
  return TARGET_FIELDS.has(value as EvidenceTargetField);
}

export function assertCommunityEvidencePrivateBoundary(value: unknown, path = "artifact"): void {
  scanPrivateBoundary(value, path);
}

function sortedUniqueStrings(value: unknown, path: string, options: { min?: number; max?: number; https?: boolean } = {}): asserts value is string[] {
  const min = options.min ?? 0;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  ensure(Array.isArray(value) && value.length >= min && value.length <= max, `${path} has invalid length`);
  ensure(value.every((item) => options.https ? normalizedHttpsUrl(item) : nonEmptyString(item)), `${path} contains an invalid value`);
  ensure(value.every((item, index) => index === 0 || compareStrings(value[index - 1] as string, item as string) < 0), `${path} must be sorted and deduplicated`);
}

function uniqueBy<T>(items: T[], identity: (item: T) => string | number, path: string): void {
  const identities = items.map(identity);
  ensure(new Set(identities).size === identities.length, `${path} contains duplicate identities`);
}

function assertSchemaVersion(value: unknown, path: string): asserts value is 1 {
  ensure(value === 1, `${path} must be 1`);
}

function assertCategory(value: unknown, path: string): asserts value is EvidenceTaskCategory {
  ensure(CATEGORIES.has(value as EvidenceTaskCategory), `${path} is invalid`);
}

function assertTargetField(value: unknown, path: string): asserts value is EvidenceTargetField {
  ensure(TARGET_FIELDS.has(value as EvidenceTargetField), `${path} is invalid`);
}

function assertTaskIdentity(value: unknown, path: string): asserts value is string {
  ensure(typeof value === "string" && TASK_ID.test(value), `${path} is invalid`);
}

function assertOptionalTimestamp(value: unknown, path: string): asserts value is string | null {
  ensure(value === null || canonicalTimestamp(value), `${path} must be null or a canonical ISO timestamp`);
}

function assertCategoryTarget(category: EvidenceTaskCategory, targetField: EvidenceTargetField, path: string): void {
  const valid = category === "company-funding"
    ? targetField.startsWith("company.") || targetField.startsWith("funding.")
    : category === "product-deployment"
      ? targetField.startsWith("product.") || targetField.startsWith("deployment.")
      : targetField.startsWith("research.");
  ensure(valid, `${path} category and target field disagree`);
}

function assertCategorySubject(category: EvidenceTaskCategory, subject: EvidenceSubject, path: string): void {
  const valid = category === "company-funding"
    ? subject.kind === "company"
    : category === "product-deployment"
      ? subject.kind === "company" || subject.kind === "event"
      : subject.kind === "research";
  ensure(valid, `${path} category and subject kind disagree`);
}

export function assertEvidenceSubject(value: unknown, path = "subject"): asserts value is EvidenceSubject {
  exactKeys(value, SUBJECT_KEYS, path);
  ensure(SUBJECT_KINDS.has(value.kind as EvidenceSubject["kind"]), `${path}.kind is invalid`);
  ensure(nonEmptyString(value.id) && nonEmptyString(value.name), `${path} identity is invalid`);
  ensure(normalizedHttpsUrl(value.url), `${path}.url must be normalized HTTPS`);
}

export function buildEvidenceTaskId(subject: EvidenceSubject, targetField: EvidenceTargetField, materialVersion: string): string {
  scanPrivateBoundary(subject, "subject");
  assertEvidenceSubject(subject);
  assertTargetField(targetField, "targetField");
  ensure(nonEmptyString(materialVersion), "materialVersion must be canonical");
  const identity = [subject.kind, subject.id, targetField, materialVersion].join("\n");
  return `evidence-task-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function buildContributionEventId(input: {
  taskId: string;
  issueNumber: number;
  contributor: string;
  evidenceUrl: string;
  state: ContributionState;
  occurredAt: string;
}): string {
  return createHash("sha256")
    .update(`${input.taskId}${input.issueNumber}${input.contributor}${input.evidenceUrl}${input.state}${input.occurredAt}`)
    .digest("hex");
}

export function assertEvidenceTaskSeed(value: unknown, path = "seed"): asserts value is EvidenceTaskSeed {
  scanPrivateBoundary(value, path);
  exactKeys(value, SEED_KEYS, path);
  assertTaskIdentity(value.id, `${path}.id`);
  ensure(positiveInteger(value.version), `${path}.version must be a positive integer`);
  assertCategory(value.category, `${path}.category`);
  assertEvidenceSubject(value.subject, `${path}.subject`);
  assertTargetField(value.targetField, `${path}.targetField`);
  assertCategoryTarget(value.category, value.targetField, path);
  assertCategorySubject(value.category, value.subject, path);
  for (const key of ["contextZh", "replyTemplateZh"] as const) {
    ensure(nonEmptyString(value[key]), `${path}.${key} must be non-empty and trimmed`);
  }
  const materialVersion = value.materialVersion;
  ensure(nonEmptyString(materialVersion), `${path}.materialVersion must be non-empty and trimmed`);
  sortedUniqueStrings(value.referenceUrls, `${path}.referenceUrls`, { min: 1, max: 3, https: true });
  sortedUniqueStrings(value.suggestedLocations, `${path}.suggestedLocations`, { min: 1 });
  sortedUniqueStrings(value.qualifiedEvidenceZh, `${path}.qualifiedEvidenceZh`, { min: 1 });
  sortedUniqueStrings(value.disqualifiedEvidenceZh, `${path}.disqualifiedEvidenceZh`, { min: 1 });
  ensure(value.estimatedMinutes === 2, `${path}.estimatedMinutes must be exactly 2`);
  ensure(canonicalWeek(value.generatedWeek), `${path}.generatedWeek must be an ISO week`);
  ensure(value.supersedesTaskId === null || (typeof value.supersedesTaskId === "string" && TASK_ID.test(value.supersedesTaskId)), `${path}.supersedesTaskId is invalid`);
  ensure(value.id === buildEvidenceTaskId(value.subject, value.targetField, materialVersion), `${path}.id is not bound to subject, targetField, and materialVersion`);
  ensure(value.supersedesTaskId !== value.id, `${path} cannot supersede itself`);
}

export function assertEvidenceTaskSeedArtifact(value: unknown): asserts value is EvidenceTaskSeedArtifact {
  scanPrivateBoundary(value);
  exactKeys(value, SEED_ARTIFACT_KEYS, "artifact");
  assertSchemaVersion(value.schemaVersion, "artifact.schemaVersion");
  ensure(canonicalTimestamp(value.generatedAt), "artifact.generatedAt must be a canonical ISO timestamp");
  ensure(canonicalWeek(value.generatedWeek), "artifact.generatedWeek must be an ISO week");
  ensure(Array.isArray(value.seeds), "artifact.seeds must be an array");
  value.seeds.forEach((seed, index) => {
    assertEvidenceTaskSeed(seed, `artifact.seeds[${index}]`);
    ensure(seed.generatedWeek === value.generatedWeek, `artifact.seeds[${index}].generatedWeek must match artifact.generatedWeek`);
  });
  const seeds = value.seeds as EvidenceTaskSeed[];
  uniqueBy(seeds, (seed) => seed.id, "artifact.seeds");
  ensure(seeds.every((seed, index) => index === 0 || compareSeed(seeds[index - 1]!, seed) < 0), "artifact.seeds must be sorted and deduplicated");
}

function compareSeed(left: EvidenceTaskSeed, right: EvidenceTaskSeed): number {
  return compareStrings(left.category, right.category)
    || compareStrings(left.subject.name, right.subject.name)
    || compareStrings(left.targetField, right.targetField)
    || compareStrings(left.id, right.id);
}

export function assertEvidenceIssue(value: unknown, path = "issue"): asserts value is EvidenceIssue {
  scanPrivateBoundary(value, path);
  exactKeys(value, ISSUE_KEYS, path);
  ensure(positiveInteger(value.number), `${path}.number must be a positive integer`);
  assertTaskIdentity(value.taskId, `${path}.taskId`);
  ensure(positiveInteger(value.taskVersion), `${path}.taskVersion must be a positive integer`);
  ensure(value.state === "open" || value.state === "closed", `${path}.state is invalid`);
  sortedUniqueStrings(value.labels, `${path}.labels`);
  ensure(githubActorLogin(value.authorLogin), `${path}.authorLogin is invalid`);
  ensure(ISSUE_ASSOCIATIONS.has(value.authorAssociation as EvidenceIssue["authorAssociation"]), `${path}.authorAssociation is invalid`);
  ensure(canonicalTimestamp(value.createdAt) && canonicalTimestamp(value.updatedAt), `${path} timestamps must be canonical ISO timestamps`);
  assertOptionalTimestamp(value.closedAt, `${path}.closedAt`);
  ensure(value.state === "open" ? value.closedAt === null : value.closedAt !== null, `${path}.state and closedAt disagree`);
  ensure(Date.parse(value.createdAt) <= Date.parse(value.updatedAt)
    && (value.closedAt === null || (Date.parse(value.createdAt) <= Date.parse(value.closedAt) && Date.parse(value.closedAt) <= Date.parse(value.updatedAt))), `${path} has invalid clock order`);
  sortedUniqueStrings(value.evidenceUrls, `${path}.evidenceUrls`, { https: true });
  sortedUniqueStrings(value.acceptedContributors, `${path}.acceptedContributors`);
  const evidenceUrls = value.evidenceUrls as string[];
  const acceptedContributors = value.acceptedContributors as string[];
  ensure(Array.isArray(value.submittedEvidence), `${path}.submittedEvidence must be an array`);
  value.submittedEvidence.forEach((item, index) => {
    exactKeys(item, ISSUE_SUBMITTED_EVIDENCE_KEYS, `${path}.submittedEvidence[${index}]`);
    ensure(humanLogin(item.contributor), `${path}.submittedEvidence[${index}].contributor is invalid`);
    ensure(normalizedHttpsUrl(item.evidenceUrl), `${path}.submittedEvidence[${index}].evidenceUrl must be normalized HTTPS`);
    ensure(canonicalTimestamp(item.submittedAt), `${path}.submittedEvidence[${index}].submittedAt must be a canonical ISO timestamp`);
    ensure(Date.parse(item.submittedAt as string) >= Date.parse(value.createdAt as string)
      && Date.parse(item.submittedAt as string) <= Date.parse(value.updatedAt as string), `${path}.submittedEvidence[${index}] has invalid clock order`);
  });
  const submittedEvidence = value.submittedEvidence as unknown as EvidenceIssueSubmittedEvidence[];
  ensure(submittedEvidence.every((item, index) => index === 0 || compareIssueSubmittedEvidence(submittedEvidence[index - 1]!, item) < 0), `${path}.submittedEvidence must be sorted and deduplicated`);
  ensure(submittedEvidence.every((item) => evidenceUrls.includes(item.evidenceUrl)), `${path}.submittedEvidence must reference evidenceUrls`);
  ensure(acceptedContributors.every((login) => HUMAN_LOGIN.test(login)), `${path}.acceptedContributors contains an invalid login`);
  ensure(Array.isArray(value.acceptedEvidence), `${path}.acceptedEvidence must be an array`);
  value.acceptedEvidence.forEach((item, index) => {
    exactKeys(item, ISSUE_ACCEPTED_EVIDENCE_KEYS, `${path}.acceptedEvidence[${index}]`);
    ensure(HUMAN_LOGIN.test(String(item.contributor)), `${path}.acceptedEvidence[${index}].contributor is invalid`);
    ensure(normalizedHttpsUrl(item.evidenceUrl), `${path}.acceptedEvidence[${index}].evidenceUrl must be normalized HTTPS`);
  });
  const acceptedEvidence = value.acceptedEvidence as unknown as EvidenceIssueAcceptedEvidence[];
  ensure(acceptedEvidence.every((item, index) => index === 0 || compareIssueAcceptedEvidence(acceptedEvidence[index - 1]!, item) < 0), `${path}.acceptedEvidence must be sorted and deduplicated`);
  ensure(acceptedEvidence.every((item) => evidenceUrls.includes(item.evidenceUrl)), `${path}.acceptedEvidence must reference evidenceUrls`);
  const submittedPairs = new Set(submittedEvidence.map((item) => `${item.contributor}\n${item.evidenceUrl}`));
  ensure(acceptedEvidence.every((item) => submittedPairs.has(`${item.contributor}\n${item.evidenceUrl}`)), `${path}.acceptedEvidence must reference submittedEvidence`);
  const acceptedLogins = [...new Set(acceptedEvidence.map((item) => item.contributor))].sort(compareStrings);
  ensure(acceptedLogins.length === acceptedContributors.length
    && acceptedLogins.every((login, index) => login === acceptedContributors[index]), `${path}.acceptedEvidence must exactly bind acceptedContributors`);
}

function compareIssueSubmittedEvidence(left: EvidenceIssueSubmittedEvidence, right: EvidenceIssueSubmittedEvidence): number {
  return compareStrings(left.contributor, right.contributor)
    || compareStrings(left.evidenceUrl, right.evidenceUrl)
    || compareStrings(left.submittedAt, right.submittedAt);
}

function compareIssueAcceptedEvidence(left: EvidenceIssueAcceptedEvidence, right: EvidenceIssueAcceptedEvidence): number {
  return compareStrings(left.contributor, right.contributor) || compareStrings(left.evidenceUrl, right.evidenceUrl);
}

export function assertEvidenceIssueSnapshot(value: unknown): asserts value is EvidenceIssueSnapshot {
  scanPrivateBoundary(value);
  exactKeys(value, ISSUE_SNAPSHOT_KEYS, "artifact");
  assertSchemaVersion(value.schemaVersion, "artifact.schemaVersion");
  ensure(canonicalTimestamp(value.fetchedAt), "artifact.fetchedAt must be a canonical ISO timestamp");
  ensure(typeof value.repo === "string" && REPO.test(value.repo), "artifact.repo is invalid");
  ensure(Array.isArray(value.issues), "artifact.issues must be an array");
  value.issues.forEach((issue, index) => assertEvidenceIssue(issue, `artifact.issues[${index}]`));
  const issues = value.issues as EvidenceIssue[];
  ensure(issues.every((issue) => Date.parse(issue.updatedAt) <= Date.parse(value.fetchedAt as string)), "artifact issues must not be newer than fetchedAt");
  uniqueBy(issues, (issue) => issue.number, "artifact.issues");
  uniqueBy(issues, (issue) => issue.taskId, "artifact.issues");
  ensure(issues.every((issue, index) => index === 0 || issues[index - 1]!.number < issue.number), "artifact.issues must be sorted by issue number");
}

/** One-time, fail-closed reader for pre-attribution schemaVersion 1 snapshots.
 * Accepted pairs receive the only causally safe legacy clock available; other
 * unbound URLs remain unattributed rather than guessing a contributor. */
export function migrateLegacyEvidenceIssueSnapshot(value: unknown): EvidenceIssueSnapshot {
  exactKeys(value, ISSUE_SNAPSHOT_KEYS, "legacy artifact");
  ensure(Array.isArray(value.issues), "legacy artifact.issues must be an array");
  const migratedIssues = value.issues.map((item, index) => {
    if (isObject(item) && Object.hasOwn(item, "submittedEvidence")) return item;
    exactKeys(item, LEGACY_ISSUE_KEYS, `legacy artifact.issues[${index}]`);
    ensure(Array.isArray(item.acceptedEvidence), `legacy artifact.issues[${index}].acceptedEvidence must be an array`);
    const submittedEvidence = item.acceptedEvidence.map((accepted) => {
      exactKeys(accepted, ISSUE_ACCEPTED_EVIDENCE_KEYS, `legacy artifact.issues[${index}].acceptedEvidence`);
      return { contributor: accepted.contributor, evidenceUrl: accepted.evidenceUrl, submittedAt: item.updatedAt };
    });
    return { ...item, submittedEvidence };
  });
  const migrated = { ...value, issues: migratedIssues };
  assertEvidenceIssueSnapshot(migrated);
  return migrated;
}

export function assertEvidenceTaskLedgerEntry(value: unknown, path = "entry"): asserts value is EvidenceTaskLedgerEntry {
  scanPrivateBoundary(value, path);
  exactKeys(value, TASK_LEDGER_ENTRY_KEYS, path);
  assertTaskIdentity(value.taskId, `${path}.taskId`);
  ensure(positiveInteger(value.taskVersion), `${path}.taskVersion must be a positive integer`);
  assertCategory(value.category, `${path}.category`);
  assertEvidenceSubject(value.subject, `${path}.subject`);
  assertTargetField(value.targetField, `${path}.targetField`);
  assertCategoryTarget(value.category, value.targetField, path);
  assertCategorySubject(value.category, value.subject, path);
  ensure(nonEmptyString(value.materialVersion), `${path}.materialVersion must be canonical`);
  ensure(value.taskId === buildEvidenceTaskId(value.subject, value.targetField, value.materialVersion), `${path}.taskId is not bound to its material identity`);
  ensure(value.supersedesTaskId === null || (typeof value.supersedesTaskId === "string" && TASK_ID.test(value.supersedesTaskId)), `${path}.supersedesTaskId is invalid`);
  ensure(value.supersedesTaskId !== value.taskId, `${path} cannot supersede itself`);
  ensure(value.issueNumber === null || positiveInteger(value.issueNumber), `${path}.issueNumber is invalid`);
  ensure(value.issueUrl === null || normalizedHttpsUrl(value.issueUrl), `${path}.issueUrl must be null or normalized HTTPS`);
  ensure((value.issueNumber === null) === (value.issueUrl === null), `${path}.issueNumber and issueUrl must both be present or absent`);
  ensure(TASK_STATES.has(value.state as EvidenceTaskState), `${path}.state is invalid`);
  const { createdAt, updatedAt, lastActivityAt } = value;
  ensure(canonicalTimestamp(createdAt), `${path}.createdAt must be a canonical ISO timestamp`);
  ensure(canonicalTimestamp(updatedAt), `${path}.updatedAt must be a canonical ISO timestamp`);
  ensure(canonicalTimestamp(lastActivityAt), `${path}.lastActivityAt must be a canonical ISO timestamp`);
  assertOptionalTimestamp(value.closedAt, `${path}.closedAt`);
  ensure(["accepted", "rejected", "closed", "superseded"].includes(String(value.state)) ? value.closedAt !== null : value.closedAt === null, `${path}.state and closedAt disagree`);
  ensure(Date.parse(createdAt) <= Date.parse(lastActivityAt)
    && Date.parse(lastActivityAt) <= Date.parse(updatedAt)
    && (value.closedAt === null || (Date.parse(createdAt) <= Date.parse(value.closedAt) && Date.parse(value.closedAt) <= Date.parse(updatedAt))), `${path} has invalid clock order`);
}

export function assertEvidenceTaskLedgerArtifact(value: unknown): asserts value is EvidenceTaskLedgerArtifact {
  scanPrivateBoundary(value);
  exactKeys(value, TASK_LEDGER_KEYS, "artifact");
  assertSchemaVersion(value.schemaVersion, "artifact.schemaVersion");
  ensure(canonicalTimestamp(value.generatedAt), "artifact.generatedAt must be a canonical ISO timestamp");
  ensure(Array.isArray(value.entries), "artifact.entries must be an array");
  value.entries.forEach((entry, index) => assertEvidenceTaskLedgerEntry(entry, `artifact.entries[${index}]`));
  const entries = value.entries as EvidenceTaskLedgerEntry[];
  ensure(entries.every((entry) => Date.parse(entry.updatedAt) <= Date.parse(value.generatedAt as string)), "artifact entries must not be newer than generatedAt");
  uniqueBy(entries, (entry) => entry.taskId, "artifact.entries");
  ensure(entries.every((entry, index) => index === 0 || compareStrings(entries[index - 1]!.taskId, entry.taskId) < 0), "artifact.entries must be sorted by taskId");
}

export function assertAcceptedEvidenceEntry(value: unknown, path = "entry"): asserts value is AcceptedEvidenceEntry {
  scanPrivateBoundary(value, path);
  exactKeys(value, ACCEPTED_ENTRY_KEYS, path);
  ensure(nonEmptyString(value.id), `${path}.id is invalid`);
  assertTaskIdentity(value.taskId, `${path}.taskId`);
  ensure(positiveInteger(value.issueNumber), `${path}.issueNumber must be a positive integer`);
  assertCategory(value.category, `${path}.category`);
  assertEvidenceSubject(value.subject, `${path}.subject`);
  assertTargetField(value.targetField, `${path}.targetField`);
  assertCategoryTarget(value.category, value.targetField, path);
  assertCategorySubject(value.category, value.subject, path);
  ensure(humanLogin(value.contributor), `${path}.contributor is invalid`);
  ensure(normalizedHttpsUrl(value.evidenceUrl), `${path}.evidenceUrl must be normalized HTTPS`);
  ensure(canonicalTimestamp(value.acceptedAt), `${path}.acceptedAt must be a canonical ISO timestamp`);
  const entry = value as unknown as AcceptedEvidenceEntry;
  ensure(entry.id === buildContributionEventId({
    taskId: entry.taskId,
    issueNumber: entry.issueNumber,
    contributor: entry.contributor,
    evidenceUrl: entry.evidenceUrl,
    state: "accepted",
    occurredAt: entry.acceptedAt,
  }), `${path}.id is not the stable accepted contribution identity`);
}

export function assertAcceptedEvidenceArtifact(value: unknown): asserts value is AcceptedEvidenceArtifact {
  scanPrivateBoundary(value);
  exactKeys(value, ACCEPTED_ARTIFACT_KEYS, "artifact");
  assertSchemaVersion(value.schemaVersion, "artifact.schemaVersion");
  ensure(canonicalTimestamp(value.generatedAt), "artifact.generatedAt must be a canonical ISO timestamp");
  ensure(Array.isArray(value.entries), "artifact.entries must be an array");
  value.entries.forEach((entry, index) => assertAcceptedEvidenceEntry(entry, `artifact.entries[${index}]`));
  const entries = value.entries as AcceptedEvidenceEntry[];
  ensure(entries.every((entry) => Date.parse(entry.acceptedAt) <= Date.parse(value.generatedAt as string)), "artifact entries must not be newer than generatedAt");
  uniqueBy(entries, (entry) => entry.id, "artifact.entries");
  ensure(entries.every((entry, index) => index === 0 || compareStrings(entries[index - 1]!.id, entry.id) < 0), "artifact.entries must be sorted by id");
}

export function assertContributionStateEvent(value: unknown, path = "event"): asserts value is ContributionStateEvent {
  scanPrivateBoundary(value, path);
  exactKeys(value, CONTRIBUTION_EVENT_KEYS, path);
  ensure(nonEmptyString(value.id), `${path}.id is invalid`);
  assertTaskIdentity(value.taskId, `${path}.taskId`);
  ensure(positiveInteger(value.issueNumber), `${path}.issueNumber must be a positive integer`);
  ensure(humanLogin(value.contributor), `${path}.contributor is invalid`);
  ensure(normalizedHttpsUrl(value.evidenceUrl), `${path}.evidenceUrl must be normalized HTTPS`);
  assertCategory(value.category, `${path}.category`);
  assertEvidenceSubject(value.subject, `${path}.subject`);
  assertTargetField(value.targetField, `${path}.targetField`);
  assertCategoryTarget(value.category, value.targetField, path);
  assertCategorySubject(value.category, value.subject, path);
  ensure(CONTRIBUTION_STATES.has(value.state as ContributionState), `${path}.state is invalid`);
  ensure(canonicalTimestamp(value.occurredAt), `${path}.occurredAt must be a canonical ISO timestamp`);
  ensure(normalizedHttpsUrl(value.sourceUrl), `${path}.sourceUrl must be normalized HTTPS`);
  ensure(value.publicTargetUrl === null || isNormalizedCommunityPublicTargetUrl(value.publicTargetUrl), `${path}.publicTargetUrl must be null or normalized HTTPS`);
  ensure(value.state === "promoted" ? value.publicTargetUrl !== null : value.publicTargetUrl === null, `${path}.state and publicTargetUrl disagree`);
  const event = value as unknown as ContributionStateEvent;
  ensure(event.id === buildContributionEventId(event), `${path}.id is not the stable contribution identity`);
}

export function assertContributionLedgerArtifact(value: unknown): asserts value is ContributionLedgerArtifact {
  scanPrivateBoundary(value);
  exactKeys(value, CONTRIBUTION_ARTIFACT_KEYS, "artifact");
  assertSchemaVersion(value.schemaVersion, "artifact.schemaVersion");
  ensure(canonicalTimestamp(value.generatedAt), "artifact.generatedAt must be a canonical ISO timestamp");
  ensure(Array.isArray(value.events), "artifact.events must be an array");
  value.events.forEach((event, index) => assertContributionStateEvent(event, `artifact.events[${index}]`));
  const events = value.events as ContributionStateEvent[];
  ensure(events.every((event) => Date.parse(event.occurredAt) <= Date.parse(value.generatedAt as string)), "artifact events must not be newer than generatedAt");
  uniqueBy(events, (event) => event.id, "artifact.events");
  ensure(events.every((event, index) => index === 0 || compareContributionEvent(events[index - 1]!, event) < 0), "artifact.events must be sorted by occurredAt then id");
}

function compareContributionEvent(left: ContributionStateEvent, right: ContributionStateEvent): number {
  const samePair = left.taskId === right.taskId
    && left.issueNumber === right.issueNumber
    && left.contributor === right.contributor
    && left.evidenceUrl === right.evidenceUrl;
  const submittedOrder = samePair && left.occurredAt === right.occurredAt
    ? left.state === "submitted" && right.state !== "submitted" ? -1
      : right.state === "submitted" && left.state !== "submitted" ? 1 : 0
    : 0;
  const acceptedPromotionOrder = samePair && left.occurredAt === right.occurredAt
    ? left.state === "accepted" && right.state === "promoted" ? -1
      : left.state === "promoted" && right.state === "accepted" ? 1 : 0
    : 0;
  return compareStrings(left.occurredAt, right.occurredAt) || submittedOrder || acceptedPromotionOrder || compareStrings(left.id, right.id);
}

export function assertCommunityTaskPublicView(value: unknown, path = "task"): asserts value is CommunityTaskPublicView {
  scanPrivateBoundary(value, path);
  exactKeys(value, PUBLIC_TASK_KEYS, path);
  assertTaskIdentity(value.id, `${path}.id`);
  ensure(positiveInteger(value.version), `${path}.version must be a positive integer`);
  assertCategory(value.category, `${path}.category`);
  assertEvidenceSubject(value.subject, `${path}.subject`);
  assertTargetField(value.targetField, `${path}.targetField`);
  assertCategoryTarget(value.category, value.targetField, path);
  assertCategorySubject(value.category, value.subject, path);
  ensure(nonEmptyString(value.contextZh), `${path}.contextZh must be non-empty and trimmed`);
  ensure(positiveInteger(value.issueNumber), `${path}.issueNumber must be a positive integer`);
  ensure(normalizedHttpsUrl(value.issueUrl), `${path}.issueUrl must be normalized HTTPS`);
  ensure(value.estimatedMinutes === 2, `${path}.estimatedMinutes must be exactly 2`);
  ensure(canonicalWeek(value.generatedWeek), `${path}.generatedWeek must be an ISO week`);
  ensure(PUBLIC_TASK_STATES.has(value.state as CommunityTaskPublicView["state"]), `${path}.state is invalid`);
}

export function assertCommunityTaskPublicArtifact(value: unknown): asserts value is CommunityTaskPublicArtifact {
  scanPrivateBoundary(value);
  exactKeys(value, PUBLIC_ARTIFACT_KEYS, "artifact");
  assertSchemaVersion(value.schemaVersion, "artifact.schemaVersion");
  ensure(canonicalTimestamp(value.generatedAt), "artifact.generatedAt must be a canonical ISO timestamp");
  ensure(Array.isArray(value.tasks), "artifact.tasks must be an array");
  value.tasks.forEach((task, index) => assertCommunityTaskPublicView(task, `artifact.tasks[${index}]`));
  const tasks = value.tasks as CommunityTaskPublicView[];
  uniqueBy(tasks, (task) => task.id, "artifact.tasks");
  ensure(tasks.every((task, index) => index === 0 || comparePublicTask(tasks[index - 1]!, task) < 0), "artifact.tasks must be sorted and deduplicated");
}

function comparePublicTask(left: CommunityTaskPublicView, right: CommunityTaskPublicView): number {
  return compareStrings(left.category, right.category)
    || compareStrings(left.subject.name, right.subject.name)
    || compareStrings(left.targetField, right.targetField)
    || compareStrings(left.id, right.id);
}
