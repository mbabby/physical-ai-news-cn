import {
  assertEvidenceIssueSnapshot,
  type EvidenceIssue,
  type EvidenceIssueAcceptedEvidence,
  type EvidenceIssueSnapshot,
} from "./contracts.js";

const API_ROOT = "https://api.github.com";
const TASK_ID_MARKER = /<!-- evidence-task-id:(evidence-task-[a-f0-9]{24}) -->/g;
const TASK_VERSION_MARKER = /<!-- evidence-task-version:([1-9]\d*) -->/g;
const ACCEPTED_CONTRIBUTOR_MARKER = /<!-- accepted-contributor:@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?) -->/g;
const URL_CANDIDATE = /https:\/\/[^\s<>"')\]]+/g;
const STRUCTURED_EVIDENCE_URL = /(?:^|\r?\n)\s*(?:证据链接|evidence url)\s*[：:]\s*(https:\/\/[^\s<>"')\]]+)/gi;
const MAINTAINER_ASSOCIATIONS = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);
const SAFE_LABELS = new Set([
  "accepted-evidence",
  "canonical-promoted",
  "contributor-credited",
  "evidence-task",
  "evidence-task-company-funding",
  "evidence-task-product-deployment",
  "evidence-task-research-metadata",
  "rejected-evidence",
  "source-withdrawn",
  "stale",
  "two-minute-task",
]);

export class CommunityEvidenceRemoteError extends Error {
  override readonly name = "CommunityEvidenceRemoteError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value !== null && typeof value !== "string") throw new Error(`${path} must be a string or null`);
  return value as string | null;
}

function integer(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${path} must be a positive integer`);
  return Number(value);
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function matches(body: string, expression: RegExp): string[][] {
  expression.lastIndex = 0;
  return [...body.matchAll(expression)].map((match) => [...match]);
}

function taskMarker(body: string): { taskId: string; taskVersion: number } | null {
  const idMarkers = matches(body, TASK_ID_MARKER);
  const versionMarkers = matches(body, TASK_VERSION_MARKER);
  const idMentions = body.split("evidence-task-id:").length - 1;
  const versionMentions = body.split("evidence-task-version:").length - 1;
  const mentionsTaskMarker = idMentions > 0 || versionMentions > 0;
  if (!mentionsTaskMarker) return null;
  if (idMentions !== 1 || versionMentions !== 1 || idMarkers.length !== 1 || versionMarkers.length !== 1) {
    throw new Error("Issue has a malformed or duplicate task marker");
  }
  return { taskId: idMarkers[0]![1]!, taskVersion: Number(versionMarkers[0]![1]) };
}

function normalizeUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function evidenceUrls(body: string): string[] {
  return [...new Set((body.match(URL_CANDIDATE) ?? []).map(normalizeUrl).filter((url): url is string => url !== null))]
    .sort();
}

function structuredEvidenceUrls(body: string): string[] {
  return [...new Set(matches(body, STRUCTURED_EVIDENCE_URL)
    .map((match) => normalizeUrl(match[1]!))
    .filter((url): url is string => url !== null))].sort();
}

function labels(value: unknown, path: string): string[] {
  return [...new Set(array(value, path).map((item, index) => {
    const label = object(item, `${path}[${index}]`);
    return string(label.name, `${path}[${index}].name`);
  }).filter((label) => SAFE_LABELS.has(label)))].sort();
}

function association(value: unknown, path: string): EvidenceIssue["authorAssociation"] {
  const parsed = string(value, path) as EvidenceIssue["authorAssociation"];
  const allowed = new Set<EvidenceIssue["authorAssociation"]>([
    "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN", "MEMBER", "NONE", "OWNER",
  ]);
  if (!allowed.has(parsed)) throw new Error(`${path} is invalid`);
  return parsed;
}

function acceptedPairs(items: EvidenceIssueAcceptedEvidence[]): EvidenceIssueAcceptedEvidence[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = `${item.contributor}\n${item.evidenceUrl}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).sort((left, right) => left.contributor < right.contributor ? -1 : left.contributor > right.contributor ? 1
    : left.evidenceUrl < right.evidenceUrl ? -1 : left.evidenceUrl > right.evidenceUrl ? 1 : 0);
}

function parseNextLink(header: string | null, current: string): string | null {
  if (!header) return null;
  const nextParts = header.split(",").map((part) => part.trim()).filter((part) => /;\s*rel="next"\s*$/.test(part));
  if (nextParts.length === 0) return null;
  if (nextParts.length !== 1) throw new Error("GitHub pagination Link header is malformed");
  const match = /^<([^>]+)>;\s*rel="next"\s*$/.exec(nextParts[0]!);
  if (!match) throw new Error("GitHub pagination Link header is malformed");
  const next = new URL(match[1]!);
  const currentUrl = new URL(current);
  if (next.origin !== API_ROOT || next.origin !== currentUrl.origin || next.pathname !== currentUrl.pathname) {
    throw new Error("GitHub pagination points outside the requested endpoint");
  }
  return next.toString();
}

async function fetchPages(fetchImpl: typeof fetch, initialUrl: string, token: string): Promise<unknown[]> {
  const result: unknown[] = [];
  const visited = new Set<string>();
  let next: string | null = initialUrl;
  while (next) {
    if (visited.has(next) || visited.size >= 100) throw new Error("GitHub pagination loop or limit exceeded");
    visited.add(next);
    const response = await fetchImpl(next, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub request failed with HTTP ${response.status}`);
    const page = await response.json() as unknown;
    result.push(...array(page, "GitHub response"));
    next = parseNextLink(response.headers.get("link"), next);
  }
  return result;
}

function parseComment(value: unknown, path: string): { body: string; login: string; association: string } {
  const comment = object(value, path);
  const user = object(comment.user, `${path}.user`);
  const login = string(user.login, `${path}.user.login`);
  string(comment.created_at, `${path}.created_at`);
  string(comment.updated_at, `${path}.updated_at`);
  return {
    body: string(comment.body, `${path}.body`),
    login,
    association: string(comment.author_association, `${path}.author_association`),
  };
}

export async function fetchEvidenceIssueSnapshot(input: {
  repo: string;
  token: string;
  fetchImpl?: typeof fetch;
  now: string;
}): Promise<EvidenceIssueSnapshot> {
  try {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo)) throw new Error("Repository is invalid");
    const fetchImpl = input.fetchImpl ?? fetch;
    const issuesUrl = `${API_ROOT}/repos/${input.repo}/issues?labels=two-minute-task&state=all&per_page=100`;
    const rawIssues = await fetchPages(fetchImpl, issuesUrl, input.token);
    const issues: EvidenceIssue[] = [];

    for (let index = 0; index < rawIssues.length; index += 1) {
      const raw = object(rawIssues[index], `issues[${index}]`);
      if (raw.pull_request !== undefined) continue;
      const body = string(raw.body, `issues[${index}].body`);
      const marker = taskMarker(body);
      if (!marker) continue;
      const number = integer(raw.number, `issues[${index}].number`);
      const issueLabels = labels(raw.labels, `issues[${index}].labels`);
      const user = object(raw.user, `issues[${index}].user`);
      const authorLogin = string(user.login, `issues[${index}].user.login`);
      const bodySubmissions = structuredEvidenceUrls(body);
      const commentUrl = `${API_ROOT}/repos/${input.repo}/issues/${number}/comments?per_page=100`;
      const comments = await fetchPages(fetchImpl, commentUrl, input.token);
      const submittedUrls = new Set(bodySubmissions);
      const authorSubmissions = new Set(bodySubmissions);
      const explicit: EvidenceIssueAcceptedEvidence[] = [];
      for (let commentIndex = 0; commentIndex < comments.length; commentIndex += 1) {
        const comment = parseComment(comments[commentIndex], `comments[${commentIndex}]`);
        const urls = evidenceUrls(comment.body);
        urls.forEach((url) => submittedUrls.add(url));
        if (comment.login === authorLogin) structuredEvidenceUrls(comment.body).forEach((url) => authorSubmissions.add(url));
        if (!MAINTAINER_ASSOCIATIONS.has(comment.association)) continue;
        const contributorMarkers = matches(comment.body, ACCEPTED_CONTRIBUTOR_MARKER);
        if (contributorMarkers.length > 0 && (contributorMarkers.length !== 1 || urls.length !== 1)) {
          throw new Error("A maintainer accepted contributor marker must bind exactly one evidence URL");
        }
        for (const contributorMarker of contributorMarkers) {
          for (const evidenceUrl of urls) explicit.push({ contributor: contributorMarker[1]!, evidenceUrl });
        }
      }
      const isAccepted = issueLabels.includes("accepted-evidence");
      const pairs = isAccepted ? acceptedPairs([
        ...[...authorSubmissions].map((evidenceUrl) => ({ contributor: authorLogin, evidenceUrl })),
        ...explicit,
      ]) : [];
      const state = string(raw.state, `issues[${index}].state`);
      if (state !== "open" && state !== "closed") throw new Error(`issues[${index}].state is invalid`);
      issues.push({
        number,
        ...marker,
        state,
        labels: issueLabels,
        authorLogin,
        authorAssociation: association(raw.author_association, `issues[${index}].author_association`),
        createdAt: string(raw.created_at, `issues[${index}].created_at`),
        updatedAt: string(raw.updated_at, `issues[${index}].updated_at`),
        closedAt: nullableString(raw.closed_at, `issues[${index}].closed_at`),
        evidenceUrls: [...submittedUrls].sort(),
        acceptedContributors: [...new Set(pairs.map((pair) => pair.contributor))].sort(),
        acceptedEvidence: pairs,
      });
    }

    const snapshot: EvidenceIssueSnapshot = {
      schemaVersion: 1,
      fetchedAt: input.now,
      repo: input.repo,
      issues: issues.sort((left, right) => left.number - right.number),
    };
    assertEvidenceIssueSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (error instanceof CommunityEvidenceRemoteError) throw error;
    throw new CommunityEvidenceRemoteError(`Unable to fetch community evidence Issues: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error });
  }
}
