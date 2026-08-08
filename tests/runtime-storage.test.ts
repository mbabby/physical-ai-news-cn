import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTransaction, readJsonStrict } from "../src/runtime/storage.js";

test("readJsonStrict distinguishes missing optional state from corruption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "physical-ai-json-"));
  assert.equal(await readJsonStrict(join(directory, "missing.json"), { optional: true }), undefined);
  const corrupt = join(directory, "corrupt.json");
  await writeFile(corrupt, "{broken", "utf8");
  await assert.rejects(() => readJsonStrict(corrupt, { optional: true }), /已损坏.*保留上一版/);
});

test("FileTransaction publishes all staged files together", async () => {
  const directory = await mkdtemp(join(tmpdir(), "physical-ai-transaction-"));
  const first = join(directory, "first.txt"); const second = join(directory, "nested", "second.txt");
  const transaction = new FileTransaction("success");
  transaction.stage(first, "one"); transaction.stage(second, "two");
  await transaction.commit();
  assert.equal(await readFile(first, "utf8"), "one");
  assert.equal(await readFile(second, "utf8"), "two");
});

test("FileTransaction restores the last known good files after a swap failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "physical-ai-rollback-"));
  const first = join(directory, "first.txt"); const second = join(directory, "second.txt");
  await writeFile(first, "old-one", "utf8"); await writeFile(second, "old-two", "utf8");
  const transaction = new FileTransaction("rollback", { failAfterSwaps: 1 });
  transaction.stage(first, "new-one"); transaction.stage(second, "new-two");
  await assert.rejects(() => transaction.commit(), /已回滚/);
  assert.equal(await readFile(first, "utf8"), "old-one");
  assert.equal(await readFile(second, "utf8"), "old-two");
});
