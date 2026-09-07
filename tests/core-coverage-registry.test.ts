import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CompanyProfile } from "../src/types.js";
import type { CoverageVersion } from "../src/core-coverage/contracts.js";
import { selectCoverageVersion, validateCoverageVersion } from "../src/core-coverage/registry.js";

const companies = JSON.parse(
  await readFile(new URL("../events/companies.json", import.meta.url), "utf8"),
) as CompanyProfile[];
const config = JSON.parse(
  await readFile(new URL("../config/core-coverage.json", import.meta.url), "utf8"),
) as CoverageVersion;

function withMember(index: number, replacement: Record<string, unknown>): unknown {
  return {
    ...config,
    members: config.members.map((member, memberIndex) => memberIndex === index ? replacement : member),
  };
}

test("accepts the approved Core 30 configuration", () => {
  assert.doesNotThrow(() => validateCoverageVersion(config, companies));
  assert.equal(config.members.length, 30);
});

test("rejects a duplicate company ID", () => {
  const duplicate = { ...config, members: [...config.members.slice(0, 29), config.members[0]] };
  assert.throws(() => validateCoverageVersion(duplicate, companies), /重复/);
});

test("rejects an unknown company ID", () => {
  assert.throws(
    () => validateCoverageVersion(withMember(0, { ...config.members[0], companyId: "not-in-company-registry" }), companies),
    /未知/,
  );
});

test("rejects an incorrect region quota", () => {
  assert.throws(
    () => validateCoverageVersion(withMember(0, { ...config.members[0], coverageRegion: "other" }), companies),
    /地区配额/,
  );
});

test("rejects an incorrect tier quota", () => {
  assert.throws(
    () => validateCoverageVersion(withMember(0, { ...config.members[0], tier: "platform" }), companies),
    /层级配额/,
  );
});

test("rejects a member without a Chinese research reason", () => {
  assert.throws(
    () => validateCoverageVersion(withMember(0, { ...config.members[0], reasonZh: "verify evidence" }), companies),
    /中文理由/,
  );
});

test("rejects unknown fields and malformed dates", () => {
  assert.throws(() => validateCoverageVersion({ ...config, extra: true }, companies), /字段/);
  assert.throws(() => validateCoverageVersion({ ...config, effectiveFrom: "2026-9-6" }, companies), /日期/);
  assert.throws(() => validateCoverageVersion({ ...config, effectiveFrom: "2026-02-30" }, companies), /日期/);
});

test("rejects invalid version references", () => {
  assert.throws(() => validateCoverageVersion({ ...config, previousVersion: config.version }, companies), /前序版本/);
  assert.throws(() => validateCoverageVersion({ ...config, previousVersion: "" }, companies), /前序版本/);
});

test("selects the latest effective version rather than a future version", () => {
  const older = { ...config, version: "2026-08-01", effectiveFrom: "2026-08-01", previousVersion: null };
  const current = { ...config, previousVersion: older.version };
  const future = { ...config, version: "2026-10-01", effectiveFrom: "2026-10-01", previousVersion: current.version };

  assert.equal(selectCoverageVersion([future, older, current], new Date("2026-09-06T12:00:00+08:00")).version, current.version);
});

test("reports that coverage is not enabled when every version is in the future", () => {
  const future = { ...config, version: "2026-10-01", effectiveFrom: "2026-10-01" };
  assert.throws(() => selectCoverageVersion([future], new Date("2026-09-06T12:00:00+08:00")), /未启用/);
});

test("selects versions at Shanghai midnight rather than UTC midnight", () => {
  const current = { ...config, effectiveFrom: "2026-09-06" };
  assert.equal(selectCoverageVersion([current], new Date("2026-09-05T16:00:00Z")).version, current.version);
});
