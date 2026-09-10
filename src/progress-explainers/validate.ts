import type { ExplainerDraft, ExplainerSource, ProgressExplainersArtifact } from "./contracts.js";
import { explainerReasonLabels } from "./contracts.js";
import { narrativeKeys } from "./draft.js";

const ID = /^[a-z0-9][a-z0-9:._-]*$/i;
const STATUS = new Set(["updated", "no-new-content", "constrained", "unavailable"]);
const KIND = new Set(["event", "research"]);
const exact = (value: unknown, keys: readonly string[]): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const operationalDate = (value: unknown): boolean => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const sourceDate = (value: unknown): boolean => value === "unknown" || operationalDate(value) || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)));
const chinese = (value: unknown): value is string => typeof value === "string" && /[\u3400-\u9fff]/u.test(value) && !/(TODO|TBD|placeholder|lorem ipsum)/i.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() === item && item.length > 0);

function exactDraft(draft: ExplainerDraft): boolean {
  const keys = ["titleZh", "factsZh", "changeZh", "meaningZh", "limitationsZh", "contexts", "fieldRefs", ...(draft.backgroundZh !== undefined ? ["backgroundZh"] : []), ...(draft.comparison !== undefined ? ["comparison"] : [])];
  if (!exact(draft, keys)) return false;
  if (draft.comparison && !exact(draft.comparison, ["beforeZh", "afterZh", "task", "conditions"])) return false;
  return true;
}

function validNarrative(draft: ExplainerDraft): boolean {
  if (!chinese(draft.titleZh) || !chinese(draft.changeZh) || !chinese(draft.meaningZh)) return false;
  if (/^(这|它)?(很)?重要[。！]?$/u.test(draft.meaningZh)) return false;
  if (!Array.isArray(draft.factsZh) || draft.factsZh.length !== 2 || !draft.factsZh.every(chinese)) return false;
  if (!Array.isArray(draft.limitationsZh) || !draft.limitationsZh.length || !draft.limitationsZh.every(chinese)) return false;
  if (!Array.isArray(draft.contexts) || !draft.contexts.every(chinese)) return false;
  if (draft.backgroundZh !== undefined && !chinese(draft.backgroundZh)) return false;
  if (draft.comparison && ![draft.comparison.beforeZh, draft.comparison.afterZh, draft.comparison.task, draft.comparison.conditions].every(chinese)) return false;
  return true;
}

function validFieldRefs(draft: ExplainerDraft, allowedFactIds?: Set<string>): boolean {
  if (!draft.fieldRefs || typeof draft.fieldRefs !== "object" || Array.isArray(draft.fieldRefs)) return false;
  const fields = narrativeKeys(draft);
  if (!exact(draft.fieldRefs, fields)) return false;
  return fields.every((field) => strings(draft.fieldRefs[field]) && draft.fieldRefs[field]!.every((id) => ID.test(id) && (!allowedFactIds || allowedFactIds.has(id))));
}

export function validateDraft(value: unknown, source: ExplainerSource): { ok: true; draft: ExplainerDraft } | { ok: false; kind: "structure" | "evidence" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, kind: "structure" };
  const draft = value as ExplainerDraft;
  const factIds = new Set(source.facts.map((fact) => fact.factId));
  if (!exactDraft(draft) || !validNarrative(draft)) return { ok: false, kind: "structure" };
  if (!validFieldRefs(draft)) return { ok: false, kind: "structure" };
  if (!validFieldRefs(draft, factIds)) return { ok: false, kind: "evidence" };
  const grounding = source.facts.map((fact) => fact.text).join(" ");
  const narrative = [draft.titleZh, ...draft.factsZh, draft.changeZh, draft.meaningZh, ...draft.limitationsZh, draft.backgroundZh ?? "", ...draft.contexts].join(" ");
  for (const number of narrative.match(/\d+(?:\.\d+)?%?/g) ?? []) if (!grounding.includes(number)) return { ok: false, kind: "evidence" };
  for (const token of narrative.match(/[A-Za-z][A-Za-z0-9._-]{2,}/g) ?? []) if (!source.entityNames.includes(token) && !grounding.includes(token)) return { ok: false, kind: "evidence" };
  if (draft.contexts.some((context) => !source.contexts.includes(context))) return { ok: false, kind: "evidence" };
  if (draft.comparison && (!source.comparable || draft.comparison.beforeZh !== source.comparable.before || draft.comparison.afterZh !== source.comparable.after || draft.comparison.task !== source.comparable.task || draft.comparison.conditions !== source.comparable.conditions)) return { ok: false, kind: "evidence" };
  return { ok: true, draft };
}

export function reviewApproved(value: unknown, draft: ExplainerDraft): boolean {
  if (!exact(value, ["approved", "fields"])) return false;
  const review = value as { approved: unknown; fields: Record<string, unknown> };
  const fields = narrativeKeys(draft);
  return review.approved === true && exact(review.fields, fields) && fields.every((field) => review.fields[field] === true);
}

export function validateProgressExplainersArtifact(value: unknown): asserts value is ProgressExplainersArtifact {
  const hasReason = value !== null && typeof value === "object" && Object.hasOwn(value, "reason");
  if (!exact(value, ["schemaVersion", "generatedAt", "lastContentUpdatedAt", "checkedAt", "status", "cards", ...(hasReason ? ["reason"] : [])])) throw new Error("explainer artifact schema");
  const artifact = value as ProgressExplainersArtifact;
  if (hasReason && (typeof artifact.reason !== "string" || !Object.hasOwn(explainerReasonLabels, artifact.reason))) throw new Error("explainer reason schema");
  if (artifact.schemaVersion !== 1 || !operationalDate(artifact.generatedAt) || !operationalDate(artifact.checkedAt) || (artifact.lastContentUpdatedAt !== null && !operationalDate(artifact.lastContentUpdatedAt)) || !STATUS.has(artifact.status) || !Array.isArray(artifact.cards) || artifact.cards.length > 3) throw new Error("explainer artifact schema");
  const ids = new Set<string>();
  const canonicalIds = new Set<string>();
  for (const card of artifact.cards) {
    const draftKeys = ["titleZh", "factsZh", "changeZh", "meaningZh", "limitationsZh", "contexts", "fieldRefs", ...(card.backgroundZh !== undefined ? ["backgroundZh"] : []), ...(card.comparison !== undefined ? ["comparison"] : [])];
    const keys = [...draftKeys, "id", "revision", "canonicalId", "sourceRevision", "kind", "evidence", "eventDate", "publishedAt", "materiallyChangedAt", "checkedAt", "historical"];
    const validIdentity = ID.test(card.id) && card.canonicalId.trim().length > 0 && !/[\s\u0000-\u001f]/u.test(card.canonicalId) && /^[a-f0-9]{64}$/.test(card.revision) && (/^[a-f0-9]{64}$|^[A-Za-z0-9._:-]+$/).test(card.sourceRevision);
    const validDates = sourceDate(card.eventDate) && sourceDate(card.publishedAt) && sourceDate(card.materiallyChangedAt) && operationalDate(card.checkedAt);
    if (!exact(card, keys) || (card.comparison !== undefined && !exact(card.comparison, ["beforeZh", "afterZh", "task", "conditions"])) || !validNarrative(card) || !validFieldRefs(card) || !validIdentity || !KIND.has(card.kind) || !validDates || typeof card.historical !== "boolean") throw new Error("explainer card schema/date/id");
    if (ids.has(card.id) || canonicalIds.has(card.canonicalId)) throw new Error("duplicate explainer card identity");
    ids.add(card.id); canonicalIds.add(card.canonicalId);
    if (!Array.isArray(card.evidence) || !card.evidence.length) throw new Error("explainer evidence schema");
    const evidenceIds = new Set<string>();
    for (const evidence of card.evidence) {
      if (!exact(evidence, ["evidenceId", "url", "source"]) || !ID.test(evidence.evidenceId) || !evidence.source.trim() || evidenceIds.has(evidence.evidenceId)) throw new Error("explainer evidence schema");
      evidenceIds.add(evidence.evidenceId);
      let url: URL;
      try { url = new URL(evidence.url); } catch { throw new Error("invalid evidence url"); }
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("invalid evidence url");
    }
  }
}

export function validateExplainerDependencies(artifact: ProgressExplainersArtifact, sources: ExplainerSource[]): void {
  const revisions = new Map(sources.map((source) => [source.canonicalId, source.revision]));
  for (const card of artifact.cards) if (revisions.get(card.canonicalId) !== card.sourceRevision) throw new Error(`explainer dependency mismatch: ${card.canonicalId}`);
}
