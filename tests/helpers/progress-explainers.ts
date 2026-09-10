import type { ExplainerDraft, ExplainerModel, ExplainerSource, ProgressExplainersArtifact } from "../../src/progress-explainers/contracts.js";

export const source = (overrides: Partial<ExplainerSource> = {}): ExplainerSource => ({
  canonicalId: "event:gripper-trial", kind: "event", revision: "source-r1", entityNames: ["DexLab"],
  eventDate: "2026-09-08", publishedAt: "2026-09-08T08:00:00Z", materiallyChangedAt: "2026-09-08T08:00:00Z",
  facts: [
    { factId: "fact:trial", text: "DexLab reported a gripper trial on 12 objects.", evidenceIds: ["ev:paper"] },
    { factId: "fact:result", text: "The gripper completed 9 of 12 object trials.", evidenceIds: ["ev:paper"] },
  ], evidence: [{ evidenceId: "ev:paper", url: "https://lab.example/gripper", source: "DexLab" }], contexts: ["真实机器人"], ...overrides,
});

export const draft = (overrides: Partial<ExplainerDraft> = {}): ExplainerDraft => ({
  titleZh: "DexLab 机械手抓取试验", factsZh: ["DexLab 报告了覆盖 12 个物体的机械手试验。", "机械手完成了其中 9 个物体的试验。"],
  changeZh: "这次披露补充了真实机器人试验结果。", meaningZh: "这为判断机械手在指定任务中的表现提供了可核对证据。",
  limitationsZh: ["披露未说明其他物体或环境中的表现。"], contexts: ["真实机器人"],
  fieldRefs: { titleZh: ["fact:trial"], "factsZh.0": ["fact:trial"], "factsZh.1": ["fact:result"], changeZh: ["fact:trial"], meaningZh: ["fact:result"], "limitationsZh.0": ["fact:trial"], "contexts.0": ["fact:trial"] }, ...overrides,
});

export const approvedReview = { approved: true, fields: { titleZh: true, "factsZh.0": true, "factsZh.1": true, changeZh: true, meaningZh: true, "limitationsZh.0": true, "contexts.0": true } };

export function model(outputs: unknown[]): ExplainerModel { let index = 0; return { async completeJson() { if (index >= outputs.length) throw new Error("provider unavailable"); return outputs[index++]; } }; }

export function previousArtifact(): ProgressExplainersArtifact {
  return { schemaVersion: 1, generatedAt: "2026-09-09T00:00:00.000Z", lastContentUpdatedAt: "2026-09-09T00:00:00.000Z", checkedAt: "2026-09-09T00:00:00.000Z", status: "updated", cards: [{
    ...draft(), id: "explainer-event-gripper-trial", revision: "card-r1", canonicalId: "event:gripper-trial", sourceRevision: "source-r1", kind: "event", evidence: source().evidence,
    eventDate: "2026-09-08", publishedAt: "2026-09-08T08:00:00Z", materiallyChangedAt: "2026-09-08T08:00:00Z", checkedAt: "2026-09-09T00:00:00.000Z", historical: false,
  }] };
}
