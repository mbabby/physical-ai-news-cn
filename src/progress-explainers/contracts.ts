export type ExplainerKind = "event" | "research";
export interface ExplainerEvidence { evidenceId: string; url: string; source: string }
export interface ExplainerFact { factId: string; text: string; evidenceIds: string[] }
export interface ExplainerComparable { before: string; after: string; task: string; conditions: string; evidenceIds: string[] }
export interface ExplainerSource { canonicalId: string; kind: ExplainerKind; revision: string; entityNames: string[]; eventDate: string; publishedAt: string; materiallyChangedAt: string; facts: ExplainerFact[]; evidence: ExplainerEvidence[]; contexts: string[]; comparable?: ExplainerComparable }
export interface ExplainerDraft { titleZh: string; factsZh: [string,string]; changeZh: string; meaningZh: string; limitationsZh: string[]; backgroundZh?: string; comparison?: { beforeZh:string; afterZh:string; task:string; conditions:string }; contexts:string[]; fieldRefs:Record<string,string[]> }
export interface ProgressExplainerCard extends ExplainerDraft { id:string; revision:string; canonicalId:string; sourceRevision:string; kind:ExplainerKind; evidence:ExplainerEvidence[]; eventDate:string; publishedAt:string; materiallyChangedAt:string; checkedAt:string; historical:boolean }
export type ExplainerReason = "timeout" | "auth" | "quota" | "provider" | "validation" | "no-recent-sources" | "model-not-configured" | "upstream";
export const explainerReasonLabels: Record<ExplainerReason, string> = { timeout: "生成请求超时", auth: "生成服务鉴权失败", quota: "生成服务配额受限", provider: "生成服务请求失败", validation: "草稿未通过内容校验", "no-recent-sources": "没有符合时间范围的可用材料", "model-not-configured": "解读生成服务未配置", upstream: "上游服务或证据受限" };
export interface ProgressExplainersArtifact { schemaVersion:1; generatedAt:string; lastContentUpdatedAt:string|null; checkedAt:string; status:"updated"|"no-new-content"|"constrained"|"unavailable"; reason?:ExplainerReason; cards:ProgressExplainerCard[] }
export interface ExplainerModel { completeJson(system:string,input:unknown):Promise<unknown> }
export interface ExplainerRunReport { requestsSucceeded:number; structureRejected:number; evidenceRejected:number; semanticRejected:number; timedOut:number; failed:number; retained:number; removed:number }
