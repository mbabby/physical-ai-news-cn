export type ExplainerKind = "event" | "research";
export interface ExplainerEvidence { evidenceId: string; url: string; source: string }
export interface ExplainerFact { factId: string; text: string; evidenceIds: string[] }
export interface ExplainerComparable { before: string; after: string; task: string; conditions: string; evidenceIds: string[] }
export interface ExplainerSource { canonicalId: string; kind: ExplainerKind; revision: string; entityNames: string[]; eventDate: string; publishedAt: string; materiallyChangedAt: string; facts: ExplainerFact[]; evidence: ExplainerEvidence[]; contexts: string[]; comparable?: ExplainerComparable }
export interface ExplainerDraft { titleZh: string; factsZh: [string,string]; changeZh: string; meaningZh: string; limitationsZh: string[]; backgroundZh?: string; comparison?: { beforeZh:string; afterZh:string; task:string; conditions:string }; contexts:string[]; fieldRefs:Record<string,string[]> }
export interface ProgressExplainerCard extends ExplainerDraft { id:string; revision:string; canonicalId:string; sourceRevision:string; kind:ExplainerKind; evidence:ExplainerEvidence[]; eventDate:string; publishedAt:string; materiallyChangedAt:string; checkedAt:string; historical:boolean }
export interface ProgressExplainersArtifact { schemaVersion:1; generatedAt:string; lastContentUpdatedAt:string|null; checkedAt:string; status:"updated"|"no-new-content"|"constrained"|"unavailable"; cards:ProgressExplainerCard[] }
export interface ExplainerModel { completeJson(system:string,input:unknown):Promise<unknown> }
export interface ExplainerRunReport { requestsSucceeded:number; structureRejected:number; evidenceRejected:number; semanticRejected:number; timedOut:number; failed:number; retained:number; removed:number }
