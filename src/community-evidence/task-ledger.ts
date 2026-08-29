import {
  assertEvidenceIssueSnapshot,
  assertEvidenceTaskLedgerArtifact,
  assertEvidenceTaskSeedArtifact,
  type EvidenceIssue,
  type EvidenceIssueSnapshot,
  type EvidenceTaskCategory,
  type EvidenceTaskLedgerArtifact,
  type EvidenceTaskLedgerEntry,
  type EvidenceTaskSeed,
} from "./contracts.js";

export type EvidenceIssueAction =
  | { action: "create"; taskId: string; title: string; body: string; labels: string[] }
  | { action: "mark-stale"; issueNumber: number; taskId: string }
  | { action: "close"; issueNumber: number; taskId: string; reason: "inactive-14-days" | "accepted" | "rejected" | "superseded" };

const CATEGORIES: EvidenceTaskCategory[] = ["company-funding", "product-deployment", "research-metadata"];
const WIP_STATES = new Set(["open", "contributed", "stale"]);
const ACTIVE_STATES = new Set(["ready", ...WIP_STATES]);
const TERMINAL_STATES = new Set(["accepted", "rejected", "closed", "superseded"]);
const DAY = 86_400_000;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateNow(now: string): number {
  const artifact: EvidenceTaskLedgerArtifact = { schemaVersion: 1, generatedAt: now, entries: [] };
  assertEvidenceTaskLedgerArtifact(artifact);
  return Date.parse(now);
}

function taskIdentity(task: Pick<EvidenceTaskSeed, "subject" | "targetField">): string {
  return [task.subject.kind, task.subject.id, task.targetField].join("\n");
}

function issueUrl(snapshot: EvidenceIssueSnapshot, issue: EvidenceIssue): string {
  return `https://github.com/${snapshot.repo}/issues/${issue.number}`;
}

function terminalLabel(issue: EvidenceIssue): "accepted" | "rejected" | undefined {
  if (issue.labels.includes("accepted-evidence")) return "accepted";
  if (issue.labels.includes("rejected-evidence")) return "rejected";
  return undefined;
}

function latest(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function entryFromSeed(seed: EvidenceTaskSeed, now: string, version = seed.version, supersedesTaskId = seed.supersedesTaskId): EvidenceTaskLedgerEntry {
  return {
    taskId: seed.id,
    taskVersion: version,
    category: seed.category,
    subject: seed.subject,
    targetField: seed.targetField,
    materialVersion: seed.materialVersion,
    supersedesTaskId,
    issueNumber: null,
    issueUrl: null,
    state: "ready",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    closedAt: null,
  };
}

function issueBody(seed: EvidenceTaskSeed, taskVersion: number): string {
  return [
    `<!-- evidence-task-id:${seed.id} -->`,
    `<!-- evidence-task-version:${taskVersion} -->`,
    "",
    `## 预计 2 分钟：补充 ${seed.subject.name} 的一项证据`,
    "",
    `- 任务类别：${seed.category}`,
    `- 待补字段：\`${seed.targetField}\``,
    `- 公开主体：[${seed.subject.name}](${seed.subject.url})`,
    `- 生成周次：${seed.generatedWeek}`,
    "",
    seed.contextZh,
    "",
    "### 已有公开参考",
    ...seed.referenceUrls.map((url) => `- ${url}`),
    "",
    "### 建议查找位置",
    ...seed.suggestedLocations.map((location) => `- ${location}`),
    "",
    "### 合格证据",
    ...seed.qualifiedEvidenceZh.map((example) => `- ${example}`),
    "",
    "### 不合格证据",
    ...seed.disqualifiedEvidenceZh.map((example) => `- ${example}`),
    "",
    "### 回复模板",
    seed.replyTemplateZh,
    "",
    "> 被标记为 accepted-evidence 只表示进入后续复核，不会自动修改公开事实。",
  ].join("\n");
}

function createAction(seed: EvidenceTaskSeed, taskVersion: number): EvidenceIssueAction {
  const categoryTitle: Record<EvidenceTaskCategory, string> = {
    "company-funding": "公司/融资",
    "product-deployment": "产品/部署",
    "research-metadata": "研究元数据",
  };
  return {
    action: "create",
    taskId: seed.id,
    title: `[两分钟补证][${categoryTitle[seed.category]}] ${seed.subject.name} · ${seed.targetField}`,
    body: issueBody(seed, taskVersion),
    labels: ["evidence-task", `evidence-task-${seed.category}`, "two-minute-task"],
  };
}

function reconcileIssue(input: {
  issue: EvidenceIssue;
  snapshot: EvidenceIssueSnapshot;
  prior: EvidenceTaskLedgerEntry;
  seed: EvidenceTaskSeed | undefined;
  now: string;
  nowMs: number;
  actions: EvidenceIssueAction[];
}): EvidenceTaskLedgerEntry {
  const { issue, snapshot, prior, seed, now, nowMs, actions } = input;
  const current = seed ? { ...prior, category: seed.category, subject: seed.subject, targetField: seed.targetField, materialVersion: seed.materialVersion } : prior;
  const remoteTerminal = terminalLabel(issue);
  const latestSubmissionAt = issue.submittedEvidence.reduce(
    (activityAt, submission) => latest(activityAt, submission.submittedAt),
    current.lastActivityAt,
  );
  const newEvidenceActivity = Date.parse(latestSubmissionAt) > Date.parse(current.lastActivityAt);
  const staleLabelWithoutNewEvidence = issue.labels.includes("stale") && !newEvidenceActivity;
  const preserveStaleActivity = staleLabelWithoutNewEvidence;
  const remoteStale = staleLabelWithoutNewEvidence && current.state !== "contributed";
  const activityAt = newEvidenceActivity ? latestSubmissionAt : preserveStaleActivity ? current.lastActivityAt : issue.updatedAt;
  let state = current.state;
  let updatedAt = latest(current.updatedAt, issue.updatedAt);
  let closedAt = current.closedAt;

  if (TERMINAL_STATES.has(current.state) && issue.state === "open") {
    if (current.state === "accepted" || current.state === "rejected") {
      actions.push({ action: "close", issueNumber: issue.number, taskId: issue.taskId, reason: current.state });
    } else if (current.state === "superseded") {
      actions.push({ action: "close", issueNumber: issue.number, taskId: issue.taskId, reason: "superseded" });
    } else if (current.state === "closed") {
      actions.push({ action: "close", issueNumber: issue.number, taskId: issue.taskId, reason: "inactive-14-days" });
    }
  }
  if (!TERMINAL_STATES.has(current.state)) {
    if (remoteTerminal) {
      state = remoteTerminal;
      closedAt = issue.closedAt ?? now;
      updatedAt = issue.state === "open" ? now : latest(updatedAt, issue.closedAt!);
      if (issue.state === "open") actions.push({ action: "close", issueNumber: issue.number, taskId: issue.taskId, reason: remoteTerminal });
    } else if (issue.state === "closed") {
      state = "closed";
      closedAt = issue.closedAt;
    } else {
      const inactiveDays = (nowMs - Date.parse(activityAt)) / DAY;
      if (inactiveDays >= 14) {
        state = "closed";
        closedAt = now;
        updatedAt = now;
        actions.push({ action: "close", issueNumber: issue.number, taskId: issue.taskId, reason: "inactive-14-days" });
      } else if (newEvidenceActivity) {
        state = "contributed";
      } else if (inactiveDays >= 7 || remoteStale || current.state === "stale") {
        state = "stale";
        if (!issue.labels.includes("stale")) {
          updatedAt = now;
          actions.push({ action: "mark-stale", issueNumber: issue.number, taskId: issue.taskId });
        }
      } else {
        state = issue.evidenceUrls.length ? "contributed" : "open";
      }
    }
  }

  return {
    ...current,
    taskVersion: issue.taskVersion,
    issueNumber: issue.number,
    issueUrl: issueUrl(snapshot, issue),
    state,
    createdAt: Date.parse(current.createdAt) <= Date.parse(issue.createdAt) ? current.createdAt : issue.createdAt,
    updatedAt,
    lastActivityAt: latest(current.lastActivityAt, activityAt),
    closedAt,
  };
}

export function planEvidenceIssueActions(input: {
  seeds: import("./contracts.js").EvidenceTaskSeedArtifact;
  issues: EvidenceIssueSnapshot;
  previousLedger: EvidenceTaskLedgerArtifact;
  now: string;
  wipLimit?: number;
}): { actions: EvidenceIssueAction[]; ledger: EvidenceTaskLedgerArtifact } {
  assertEvidenceTaskSeedArtifact(input.seeds);
  assertEvidenceIssueSnapshot(input.issues);
  assertEvidenceTaskLedgerArtifact(input.previousLedger);
  const nowMs = validateNow(input.now);
  if (Date.parse(input.seeds.generatedAt) > nowMs || Date.parse(input.issues.fetchedAt) > nowMs || Date.parse(input.previousLedger.generatedAt) > nowMs) {
    throw new Error("Evidence lifecycle inputs cannot be newer than now");
  }
  const requestedLimit = input.wipLimit ?? 5;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 0) throw new Error("wipLimit must be a non-negative integer");
  const wipLimit = Math.min(requestedLimit, 5);
  const actions: EvidenceIssueAction[] = [];
  const seedById = new Map(input.seeds.seeds.map((seed) => [seed.id, seed]));
  const entries = new Map(input.previousLedger.entries.map((entry) => [entry.taskId, { ...entry }]));

  for (const issue of input.issues.issues) {
    const prior = entries.get(issue.taskId);
    const matchingSeed = seedById.get(issue.taskId);
    if (!prior && !matchingSeed) continue;
    const base = prior ?? entryFromSeed(matchingSeed!, issue.createdAt, issue.taskVersion);
    entries.set(issue.taskId, reconcileIssue({ issue, snapshot: input.issues, prior: base, seed: matchingSeed, now: input.now, nowMs, actions }));
  }

  const latestByIdentity = new Map<string, EvidenceTaskLedgerEntry>();
  const activeByIdentity = new Map<string, EvidenceTaskLedgerEntry>();
  for (const item of entries.values()) {
    const key = taskIdentity(item);
    const current = latestByIdentity.get(key);
    if (!current || item.taskVersion > current.taskVersion || (item.taskVersion === current.taskVersion && compareStrings(item.taskId, current.taskId) > 0)) {
      latestByIdentity.set(key, item);
    }
    if (ACTIVE_STATES.has(item.state)) {
      if (activeByIdentity.has(key)) throw new Error(`Evidence lifecycle history contains multiple active variants for ${key}`);
      activeByIdentity.set(key, item);
    }
  }

  const candidates: Array<{ seed: EvidenceTaskSeed; version: number; supersedesTaskId: string | null; previous?: EvidenceTaskLedgerEntry; persisted?: EvidenceTaskLedgerEntry }> = [];
  for (const seed of input.seeds.seeds) {
    const persisted = entries.get(seed.id);
    if (persisted || input.issues.issues.some((issue) => issue.taskId === seed.id)) {
      if (persisted?.state === "ready" && persisted.issueNumber === null) {
        candidates.push({ seed, version: persisted.taskVersion, supersedesTaskId: persisted.supersedesTaskId, persisted });
      }
      continue;
    }
    const identity = taskIdentity(seed);
    const previous = latestByIdentity.get(identity);
    const activePrevious = activeByIdentity.get(identity);
    let version = seed.version;
    let supersedesTaskId = seed.supersedesTaskId;
    if (previous) {
      if (previous.materialVersion === seed.materialVersion) continue;
      version = previous.taskVersion + 1;
      supersedesTaskId = previous.taskId;
    }
    candidates.push({ seed, version, supersedesTaskId, previous: activePrevious });
  }

  const snapshotWipIds = new Set(input.issues.issues.filter((issue) => issue.state === "open" && !terminalLabel(issue)).map((issue) => issue.taskId));
  for (const item of entries.values()) {
    if (WIP_STATES.has(item.state)) snapshotWipIds.add(item.taskId);
    else snapshotWipIds.delete(item.taskId);
  }
  if (snapshotWipIds.size > 5) throw new Error(`Evidence lifecycle input exceeds the WIP hard cap of 5: ${snapshotWipIds.size}`);
  let available = Math.max(0, wipLimit - snapshotWipIds.size);
  const covered = new Set([...entries.values()].filter((entry) => WIP_STATES.has(entry.state)).map((entry) => entry.category));
  const selected: typeof candidates = [];
  const selectedIds = new Set<string>();
  const selectedIdentities = new Set<string>();
  const selectedSupersededIds = new Set<string>();
  const slotCost = (candidate: typeof candidates[number]): number => candidate.previous && WIP_STATES.has(candidate.previous.state) ? 0 : 1;
  const canSelect = (candidate: typeof candidates[number]): boolean => wipLimit > 0
    && snapshotWipIds.size <= wipLimit
    && slotCost(candidate) <= available
    && !selectedIdentities.has(taskIdentity(candidate.seed))
    && (!candidate.supersedesTaskId || !selectedSupersededIds.has(candidate.supersedesTaskId));
  const select = (candidate: typeof candidates[number]): void => {
    selected.push(candidate);
    selectedIds.add(candidate.seed.id);
    selectedIdentities.add(taskIdentity(candidate.seed));
    if (candidate.supersedesTaskId) selectedSupersededIds.add(candidate.supersedesTaskId);
    available -= slotCost(candidate);
  };

  for (const category of CATEGORIES) {
    if (covered.has(category)) continue;
    const candidate = candidates.find((item) => item.seed.category === category && !selectedIds.has(item.seed.id) && canSelect(item));
    if (!candidate) continue;
    select(candidate);
    covered.add(category);
  }
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.seed.id) || !canSelect(candidate)) continue;
    select(candidate);
  }

  for (const candidate of selected) {
    const previous = candidate.previous;
    if (!previous || TERMINAL_STATES.has(previous.state)) continue;
    if (previous.issueNumber !== null) actions.push({ action: "close", issueNumber: previous.issueNumber, taskId: previous.taskId, reason: "superseded" });
    entries.set(previous.taskId, { ...previous, state: "superseded", updatedAt: input.now, closedAt: input.now });
  }
  for (const candidate of selected) {
    actions.push(createAction(candidate.seed, candidate.version));
    entries.set(candidate.seed.id, candidate.persisted ?? entryFromSeed(candidate.seed, input.now, candidate.version, candidate.supersedesTaskId));
  }

  const ledger: EvidenceTaskLedgerArtifact = {
    schemaVersion: 1,
    generatedAt: input.now,
    entries: [...entries.values()].sort((left, right) => compareStrings(left.taskId, right.taskId)),
  };
  assertEvidenceTaskLedgerArtifact(ledger);
  return { actions, ledger };
}
