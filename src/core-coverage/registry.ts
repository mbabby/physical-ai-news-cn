import type { CompanyProfile } from "../types.js";
import type { CoverageMember, CoverageRegion, CoverageTier, CoverageVersion } from "./contracts.js";

const VERSION_KEYS = ["schemaVersion", "version", "effectiveFrom", "members", "previousVersion", "changeReasonZh"] as const;
const MEMBER_KEYS = ["companyId", "coverageRegion", "tier", "reasonZh", "ownerRole"] as const;
const REGION_QUOTAS: Record<CoverageRegion, number> = { china: 12, "north-america": 12, other: 6 };
const TIER_QUOTAS: Record<CoverageTier, number> = { commercial: 22, platform: 5, strategic: 3 };
const CHINESE_TEXT = /\p{Script=Han}/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function countBy<T extends string>(members: CoverageMember[], key: (member: CoverageMember) => T): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const member of members) counts[key(member)] = (counts[key(member)] ?? 0) + 1;
  return counts;
}

export function validateCoverageVersion(value: unknown, companies: readonly CompanyProfile[]): asserts value is CoverageVersion {
  if (!isRecord(value) || !hasExactKeys(value, VERSION_KEYS)) throw new Error("覆盖版本字段不合法");
  if (value.schemaVersion !== 1 || typeof value.version !== "string" || !value.version.trim()) throw new Error("覆盖版本标识不合法");
  if (!isCanonicalDate(value.effectiveFrom)) throw new Error("覆盖版本日期不合法");
  if (value.previousVersion !== null && (typeof value.previousVersion !== "string" || !value.previousVersion.trim() || value.previousVersion === value.version)) {
    throw new Error("覆盖版本的前序版本引用不合法");
  }
  if (typeof value.changeReasonZh !== "string" || !CHINESE_TEXT.test(value.changeReasonZh)) throw new Error("覆盖版本缺少中文变更理由");
  if (!Array.isArray(value.members) || value.members.length !== 30) throw new Error("覆盖名单必须包含 30 个主体");

  const knownIds = new Set(companies.flatMap((company) => company.entityId ? [company.entityId] : []));
  const seen = new Set<string>();
  for (const candidate of value.members) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, MEMBER_KEYS)) throw new Error("覆盖成员字段不合法");
    const { companyId, coverageRegion, tier, reasonZh, ownerRole } = candidate;
    if (typeof companyId !== "string" || !companyId) throw new Error("覆盖成员公司 ID 不合法");
    if (seen.has(companyId)) throw new Error(`覆盖名单包含重复公司 ID：${companyId}`);
    if (!knownIds.has(companyId)) throw new Error(`覆盖名单包含未知公司 ID：${companyId}`);
    if (coverageRegion !== "china" && coverageRegion !== "north-america" && coverageRegion !== "other") throw new Error("覆盖地区不合法");
    if (tier !== "commercial" && tier !== "platform" && tier !== "strategic") throw new Error("覆盖层级不合法");
    if (typeof reasonZh !== "string" || !CHINESE_TEXT.test(reasonZh)) throw new Error(`公司 ${companyId} 缺少中文理由`);
    if (ownerRole !== "maintainer") throw new Error("覆盖成员责任角色不合法");
    seen.add(companyId);
  }

  const members = value.members as CoverageMember[];
  const regionCounts = countBy(members, (member) => member.coverageRegion);
  if (Object.entries(REGION_QUOTAS).some(([region, quota]) => regionCounts[region as CoverageRegion] !== quota)) throw new Error("覆盖名单地区配额不合法");
  const tierCounts = countBy(members, (member) => member.tier);
  if (Object.entries(TIER_QUOTAS).some(([tier, quota]) => tierCounts[tier as CoverageTier] !== quota)) throw new Error("覆盖名单层级配额不合法");
}

export function selectCoverageVersion(versions: readonly CoverageVersion[], now: Date): CoverageVersion {
  if (Number.isNaN(now.valueOf())) throw new Error("版本选择日期不合法");
  const byVersion = new Map<string, CoverageVersion>();
  for (const version of versions) {
    if (byVersion.has(version.version)) throw new Error(`覆盖版本标识重复：${version.version}`);
    byVersion.set(version.version, version);
  }
  for (const version of versions) {
    if (version.previousVersion !== null && !byVersion.has(version.previousVersion)) throw new Error(`前序版本不存在：${version.previousVersion}`);
    if (version.previousVersion !== null && byVersion.get(version.previousVersion)!.effectiveFrom >= version.effectiveFrom) throw new Error("前序版本生效日期必须更早");
  }
  const today = new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const selected = versions.filter((version) => version.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!selected) throw new Error("Core 30 覆盖版本尚未启用");
  return selected;
}
