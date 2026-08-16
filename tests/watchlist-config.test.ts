import assert from "node:assert/strict";
import test from "node:test";
import { decodeWatchlistConfig, encodeWatchlistConfig } from "../src/watchlist/config.js";

const catalog = {
  companyIds: ["company-z", "company-a", "company-b", "company-\uD83D\uDE00", "company-\uFFFF"],
  routes: ["data-and-training", "vla-and-embodied-models", "embodiment-and-hardware"],
} as const;

test("encodes a canonical stable query with code-unit sorted unique IDs", () => {
  assert.equal(
    encodeWatchlistConfig({
      companyIds: ["company-z", "company-a", "company-z", "company-\uFFFF", "company-\uD83D\uDE00"],
      routes: ["vla-and-embodied-models", "data-and-training", "vla-and-embodied-models"],
    }),
    "watch=company-a,company-z,company-%F0%9F%98%80,company-%EF%BF%BF&routes=data-and-training,vla-and-embodied-models",
  );
});

test("round trips canonical selections and accepts URLSearchParams-compatible input", () => {
  const encoded = encodeWatchlistConfig({ companyIds: ["company-b", "company-a"], routes: ["vla-and-embodied-models"] });
  assert.deepEqual(decodeWatchlistConfig(encoded, catalog), {
    config: { companyIds: ["company-a", "company-b"], routes: ["vla-and-embodied-models"] },
    warnings: [],
  });
  assert.deepEqual(decodeWatchlistConfig(new URLSearchParams(encoded), catalog).config, {
    companyIds: ["company-a", "company-b"], routes: ["vla-and-embodied-models"],
  });
});

test("ignores unknown and no-longer-current companies with an explicit warning", () => {
  const result = decodeWatchlistConfig("watch=company-a,company-exited,not-a-company", catalog);
  assert.deepEqual(result.config, { companyIds: ["company-a"], routes: [] });
  assert.match(result.warnings.join(" "), /未知|已退出当前观察名单/);
});

test("fails safe for malformed percent encoding, HTML payloads, whitespace and controls", () => {
  for (const query of [
    "watch=company-a%ZZ",
    "wat%ZZch=company-a",
    "watch=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    "watch=%20company-a",
    "watch=company-a%0A",
    "routes=vla-and-embodied-models%00",
  ]) {
    const result = decodeWatchlistConfig(query, catalog);
    assert.deepEqual(result.config, { companyIds: [], routes: [] }, query);
    assert.ok(result.warnings.length > 0, query);
  }
});

test("ignores unknown routes and treats empty values as no configuration", () => {
  assert.deepEqual(decodeWatchlistConfig("watch=&routes=unknown-route", catalog), {
    config: { companyIds: [], routes: [] },
    warnings: ["已忽略未知技术路线：unknown-route"],
  });
});

test("never accepts a route outside the fixed canonical route table", () => {
  const result = decodeWatchlistConfig("routes=unapproved-route", {
    companyIds: [],
    routes: ["unapproved-route"],
  });
  assert.deepEqual(result.config, { companyIds: [], routes: [] });
  assert.match(result.warnings.join(" "), /未知技术路线/);
});

test("caps over-limit values and excessive query input without throwing", () => {
  const companies = Array.from({ length: 31 }, (_, index) => `company-${index}`);
  const overLimit = decodeWatchlistConfig(`watch=${companies.join(",")}`, {
    companyIds: companies,
    routes: ["data-and-training"],
  });
  assert.equal(overLimit.config.companyIds.length, 30);
  assert.deepEqual(overLimit.config.routes, []);
  assert.match(overLimit.warnings.join(" "), /上限/);

  const tooLong = decodeWatchlistConfig(`watch=${"company-a,".repeat(500)}`, catalog);
  assert.deepEqual(tooLong.config, { companyIds: [], routes: [] });
  assert.match(tooLong.warnings.join(" "), /过长/);
});
