import type { ExplainerDraft, ExplainerSource, ProgressExplainersArtifact } from "./contracts.js";
import { narrativeKeys } from "./draft.js";
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join("|")===keys.sort().join("|");
const date=(v:unknown)=>v==="unknown"||(typeof v==="string"&&Number.isFinite(Date.parse(v)));
const zh=(v:string)=>typeof v==="string"&&/[\u3400-\u9fff]/u.test(v)&&!/(TODO|TBD|placeholder|lorem ipsum)/i.test(v);
export function validateDraft(value:unknown,source:ExplainerSource):{ok:true;draft:ExplainerDraft}|{ok:false;kind:"structure"|"evidence"}{
  if(!value||typeof value!=="object"||Array.isArray(value))return {ok:false,kind:"structure"}; const d=value as ExplainerDraft;
  if(!zh(d.titleZh)||!Array.isArray(d.factsZh)||d.factsZh.length!==2||!d.factsZh.every(zh)||!zh(d.changeZh)||!zh(d.meaningZh)||/^(这|它)?(很)?重要[。！]?$/u.test(d.meaningZh)||!Array.isArray(d.limitationsZh)||!d.limitationsZh.length||!d.limitationsZh.every(zh)||!Array.isArray(d.contexts)||!d.contexts.every(zh)||!d.fieldRefs||typeof d.fieldRefs!=="object")return {ok:false,kind:"structure"};
  const ids=new Set(source.facts.map(f=>f.factId)); if(narrativeKeys(d).some(k=>!Array.isArray(d.fieldRefs[k])||!d.fieldRefs[k]!.length||d.fieldRefs[k]!.some(id=>!ids.has(id))))return {ok:false,kind:"evidence"};
  const grounded=source.facts.map(f=>f.text).join(" "); const narrative=[d.titleZh,...d.factsZh,d.changeZh,d.meaningZh,...d.limitationsZh,d.backgroundZh??"",...d.contexts].join(" ");
  for(const n of narrative.match(/\d+(?:\.\d+)?%?/g)??[])if(!grounded.includes(n))return {ok:false,kind:"evidence"};
  const known=new Set(source.entityNames); for(const token of narrative.match(/[A-Za-z][A-Za-z0-9._-]{2,}/g)??[])if(!known.has(token)&&!grounded.includes(token))return {ok:false,kind:"evidence"};
  if(d.comparison&&!source.comparable)return {ok:false,kind:"evidence"}; if(d.comparison&&source.comparable&&(d.comparison.beforeZh!==source.comparable.before||d.comparison.afterZh!==source.comparable.after||d.comparison.task!==source.comparable.task||d.comparison.conditions!==source.comparable.conditions))return {ok:false,kind:"evidence"};
  return {ok:true,draft:d};
}
export function reviewApproved(value:unknown,draft:ExplainerDraft):boolean{if(!value||typeof value!=="object"||Array.isArray(value))return false;const r=value as {approved?:unknown;fields?:Record<string,unknown>};return r.approved===true&&!!r.fields&&narrativeKeys(draft).every(k=>r.fields![k]===true);}
export function validateProgressExplainersArtifact(value:unknown):asserts value is ProgressExplainersArtifact{
  if(!exact(value,["schemaVersion","generatedAt","lastContentUpdatedAt","checkedAt","status","cards"]))throw new Error("explainer artifact schema"); const a=value as ProgressExplainersArtifact;
  if(a.schemaVersion!==1||!date(a.generatedAt)||!date(a.checkedAt)||(a.lastContentUpdatedAt!==null&&!date(a.lastContentUpdatedAt))||!["updated","no-new-content","constrained","unavailable"].includes(a.status)||!Array.isArray(a.cards))throw new Error("explainer artifact schema");
  for(const c of a.cards){const keys=["titleZh","factsZh","changeZh","meaningZh","limitationsZh","contexts","fieldRefs","id","revision","canonicalId","sourceRevision","kind","evidence","eventDate","publishedAt","materiallyChangedAt","checkedAt","historical",...(c.backgroundZh!==undefined?["backgroundZh"]:[]),...(c.comparison!==undefined?["comparison"]:[])];if(!exact(c,keys)||!/^[a-z0-9][a-z0-9:_-]*$/i.test(c.id)||!date(c.eventDate)||!date(c.publishedAt)||!date(c.materiallyChangedAt)||!date(c.checkedAt)||!Array.isArray(c.evidence))throw new Error("explainer card schema/date/id");for(const e of c.evidence){if(!exact(e,["evidenceId","url","source"]))throw new Error("explainer evidence schema");let u:URL;try{u=new URL(e.url)}catch{throw new Error("invalid evidence url")}if(!["http:","https:"].includes(u.protocol))throw new Error("invalid evidence url");}}
}
export function validateExplainerDependencies(artifact:ProgressExplainersArtifact,sources:ExplainerSource[]):void{const map=new Map(sources.map(s=>[s.canonicalId,s.revision]));for(const c of artifact.cards)if(map.get(c.canonicalId)!==c.sourceRevision)throw new Error(`explainer dependency mismatch: ${c.canonicalId}`);}
