import { createHash } from "node:crypto";
import type { CompanyProfile } from "./types.js";

export function canonicalCompanyId(company: CompanyProfile): string {
  if (company.entityId) return company.entityId;
  return `company-${createHash("sha256").update(`${company.name}\n${company.officialUrl}`).digest("hex").slice(0, 12)}`;
}

function normalizedIdentity(value: string | undefined): string {
  return value?.normalize("NFKC").trim().toLowerCase() ?? "";
}

function identities(company: CompanyProfile): string[] {
  return [canonicalCompanyId(company), company.name, company.legalName, ...(company.aliases ?? [])]
    .filter((value): value is string => Boolean(value))
    .map(normalizedIdentity);
}

/** Resolve only canonical IDs and exact, unambiguous profile identities. */
export function canonicalCompanyOwner(companies: readonly CompanyProfile[], identity: string | undefined): string | undefined {
  const normalized = normalizedIdentity(identity);
  if (!normalized) return undefined;
  const matches = companies.filter((company) => identities(company).includes(normalized));
  return matches.length === 1 ? canonicalCompanyId(matches[0]!) : undefined;
}
