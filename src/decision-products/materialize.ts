import { join } from "node:path";
import type { BenchmarkResultLedger } from "../benchmark-result-ledger.js";
import type { CompanyClaimLedger } from "../company-claim-ledger.js";
import type { FileTransaction } from "../runtime/storage.js";
import type { ResearchDecisionCard } from "../research-decision-card.js";
import type { CompanyProfile, EventRecord, ResearchRecord } from "../types.js";
import type { WatchlistPublicView } from "../watchlist/public-view.js";
import { buildDecisionCompanyCards } from "./company-card.js";
import { validateDecisionProductArtifact, type DecisionProductArtifact } from "./contracts.js";
import { replaceDecisionProductReadme } from "./markdown.js";
import { buildReproducibilityPassports } from "./repro-passport.js";
import { buildSubscriptionCatalog, stageDecisionFeeds } from "./subscriptions.js";
import { buildDecisionTopSignals } from "./top-signals.js";

const DEFAULT_REPOSITORY_URL = "https://github.com/mbabby/physical-ai-news-cn";
const DEFAULT_PAGES_URL = "https://mbabby.github.io/physical-ai-news-cn";
const DAY_MS = 86_400_000;
const timestamp = (value: unknown): boolean => typeof value === "string" && value !== "unknown" && Number.isFinite(Date.parse(value));

function companyCardInputs(input: BuildDecisionProductInput): { companies: CompanyProfile[]; claimLedger: CompanyClaimLedger } {
  const aliases = new Map<string, string>();
  for (const company of input.companies) for (const name of [company.entityId, company.name, company.legalName, ...(company.aliases ?? [])]) {
    if (name) aliases.set(name.trim().toLowerCase(), company.entityId!);
  }
  const eventCompanyIds = new Set(input.events.flatMap((event) => {
    const companyId = event.primaryEntity && aliases.get(event.primaryEntity.trim().toLowerCase());
    return companyId && [event.lastMaterialChangeAt, event.lastUpdatedAt, event.occurredAt, event.eventDate].some(timestamp) ? [companyId] : [];
  }));
  const ledgerCompanyIds = new Set(input.companyClaimLedger.companies.flatMap((entry) => entry.claims.some((claim) =>
    timestamp(claim.verifiedAt)
      || Object.values(claim.fields).some((field) => timestamp(field.observedAt))
      || claim.corrections.some((correction) => timestamp(correction.correctedAt))) ? [entry.companyId] : []));
  const eligibleIds = new Set(input.companies.flatMap((company) => company.entityId && (timestamp(company.lastVerifiedAt) || eventCompanyIds.has(company.entityId) || ledgerCompanyIds.has(company.entityId)) ? [company.entityId] : []));
  return {
    companies: input.companies.filter((company) => company.entityId && eligibleIds.has(company.entityId)),
    claimLedger: { ...input.companyClaimLedger, companies: input.companyClaimLedger.companies.filter((entry) => eligibleIds.has(entry.companyId)) },
  };
}

export interface BuildDecisionProductInput {
  generatedAt: Date;
  events: EventRecord[];
  companies: CompanyProfile[];
  companyClaimLedger: CompanyClaimLedger;
  researchRecords: ResearchRecord[];
  researchDecisionCards: ResearchDecisionCard[];
  benchmarkResultLedger: BenchmarkResultLedger;
  watchlist: WatchlistPublicView;
}

export function buildDecisionProductArtifact(input: BuildDecisionProductInput): DecisionProductArtifact {
  if (!Number.isFinite(input.generatedAt.getTime())) throw new Error("Decision Product requires a valid fixed clock");
  const generatedAt = input.generatedAt.toISOString();
  if (input.companyClaimLedger.generatedAt !== generatedAt || input.benchmarkResultLedger.generatedAt !== generatedAt) {
    throw new Error("Decision Product 输入账本与生成时钟不一致");
  }
  const companyInputs = companyCardInputs(input);
  const base: DecisionProductArtifact = {
    schemaVersion: 1,
    generatedAt,
    periodStart: new Date(input.generatedAt.getTime() - 6 * DAY_MS).toISOString().slice(0, 10),
    topSignals: buildDecisionTopSignals(input.events, input.companies, input.generatedAt),
    companyCards: buildDecisionCompanyCards({
      companies: companyInputs.companies,
      claimLedger: companyInputs.claimLedger,
      events: input.events,
      watchlist: input.watchlist,
      now: input.generatedAt,
    }),
    researchPassports: buildReproducibilityPassports({
      records: input.researchRecords,
      cards: input.researchDecisionCards,
      benchmarkLedger: input.benchmarkResultLedger,
    }),
    subscriptions: { generatedAt, entries: [] },
  };
  validateDecisionProductArtifact(base);
  const artifact = { ...base, subscriptions: buildSubscriptionCatalog(base, { repositoryUrl: DEFAULT_REPOSITORY_URL, pagesUrl: DEFAULT_PAGES_URL }) };
  validateDecisionProductArtifact(artifact);
  return artifact;
}

export interface StageDecisionProductsInput {
  root: string;
  transaction: Pick<FileTransaction, "stage">;
  artifact: DecisionProductArtifact;
  readme: string;
  repositoryUrl: string;
  pagesUrl: string;
  watchlist: WatchlistPublicView;
}

/** Validate all projections before placing any decision-product bytes in the shared transaction. */
export function stageDecisionProducts(input: StageDecisionProductsInput): string {
  validateDecisionProductArtifact(input.artifact);
  const readme = replaceDecisionProductReadme(input.readme, input.artifact);
  const expectedCatalog = buildSubscriptionCatalog(input.artifact, input);
  if (JSON.stringify(expectedCatalog) !== JSON.stringify(input.artifact.subscriptions)) {
    throw new Error("Decision Product 订阅目录与发布 URL 不一致");
  }
  const bytes = `${JSON.stringify(input.artifact, null, 2)}\n`;
  stageDecisionFeeds({ ...input, transaction: input.transaction });
  input.transaction.stage(join(input.root, "site", "data", "decision-products.json"), bytes);
  return readme;
}
