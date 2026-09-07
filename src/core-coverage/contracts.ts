export type CoverageRegion = "china" | "north-america" | "other";
export type CoverageTier = "commercial" | "platform" | "strategic";

export interface CoverageMember {
  companyId: string;
  coverageRegion: CoverageRegion;
  tier: CoverageTier;
  reasonZh: string;
  ownerRole: "maintainer";
}

export interface CoverageVersion {
  schemaVersion: 1;
  version: string;
  effectiveFrom: string;
  members: CoverageMember[];
  previousVersion: string | null;
  changeReasonZh: string;
}

export interface AnalysisStatement {
  id: string;
  template: "capital-resources" | "product-validation" | "deployment-validation";
  textZh: string;
  claimIds: string[];
  evidenceIds: string[];
  limitationZh: string;
  nextValidationZh: string;
  status: "valid" | "needs-review";
}

export interface CoverageKnownFact {
  claimId: string;
  companyId: string;
  claimType: CompanyClaimType;
  fields: Partial<Record<keyof CompanyClaimFields, LedgerField<unknown>>>;
  eventIds: string[];
  evidenceIds: string[];
  summaryZh: string;
  occurredOn: string | "unknown";
  publishedOn: string | "unknown";
  date: string | "unknown";
  dateKind: "occurred" | "disclosed" | "unknown";
  materialChangeAt: string | "unknown";
  needsReview: boolean;
}

export interface CoverageBrief {
  companyId: string;
  completeness: "coverage-only" | "complete";
  analyses: AnalysisStatement[];
  knownClaimIds: string[];
  materialEventIds: string[];
  gapsZh: string[];
  lastMaterialChangeAt: string | "unknown";
  positioningZh: string;
  identityEvidence: NonNullable<CompanyProfile["profileEvidence"]>;
  reviewIssues: Array<{ claimId: string; reason: "conflict" | "withdrawn"; fieldPath?: keyof CompanyClaimFields }>;
  knownFacts: CoverageKnownFact[];
  summaryZh: string;
  nextValidationZh: string[];
}

export interface CoverageCorrection {
  changeId: string;
  companyId: string;
  fieldPath: string;
  before: LedgerField<unknown>;
  after: LedgerField<unknown>;
  reason: LedgerCorrectionReason;
  evidenceIds: string[];
  correctedAt: string;
}
import type { CompanyClaimFields, CompanyClaimType } from "../company-claim-ledger.js";
import type { LedgerCorrectionReason, LedgerField } from "../ledger-contracts.js";
import type { CompanyProfile } from "../types.js";
