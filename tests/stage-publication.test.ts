import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const repositoryRoot = join(dirname(new URL(import.meta.url).pathname), "..");
const script = join(repositoryRoot, "scripts", "stage-generated-publication.sh");

const publicationFixtures: Record<string, string> = {
  "daily/2026-08-18.json": "old daily\n",
  "weekly/2026-W34.md": "old weekly\n",
  "sources/registry.json": "old sources\n",
  "review/run-manifest.json": "old review\n",
  "community/contributions.json": "old contributions\n",
  "resources/radar.json": "old resources\n",
  "events/index.json": "old events\n",
  "research/registry.json": "old research\n",
  "routes/index.json": "old routes\n",
  "metrics/watchlist.json": "old metrics\n",
  "watchlist/current.json": "old watchlist\n",
  "site/data/dashboard.json": "old dashboard\n",
  "site/data/watchlist-changes.json": "old changes\n",
  "site/feeds/manifest.json": "old feed\n",
  "FACTS_POLICY.md": "old policy\n",
  "README.md": "old readme\n",
  "README.en.md": "old english readme\n",
  "posts/update.md": "old post\n",
};

const run = async (command: string, args: string[], cwd: string) => exec(command, args, { cwd });

const createRepository = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "physical-ai-stage-"));
  await run("git", ["init", "-q", "--initial-branch=main"], root);
  await run("git", ["config", "user.name", "test"], root);
  await run("git", ["config", "user.email", "test@example.com"], root);

  for (const [path, content] of Object.entries(publicationFixtures)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await run("git", ["add", "."], root);
  await run("git", ["commit", "-qm", "fixture"], root);
  return root;
};

test("stages every generated publication surface before rebase", async () => {
  const root = await createRepository();
  for (const path of Object.keys(publicationFixtures)) {
    await writeFile(join(root, path), `new ${path}\n`);
  }

  await run("bash", [script, root], root);

  const { stdout: staged } = await run("git", ["diff", "--cached", "--name-only"], root);
  assert.deepEqual(staged.trim().split("\n"), Object.keys(publicationFixtures).sort());
  const { stdout: unstaged } = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], root);
  assert.doesNotMatch(unstaged, /^.[^ ]|^\?\?/m);
});

test("fails with the omitted path when generation modifies a tracked artifact", async () => {
  const root = await createRepository();
  const outside = join(root, "outside-publication.txt");
  await writeFile(outside, "old\n");
  await run("git", ["add", "outside-publication.txt"], root);
  await run("git", ["commit", "-qm", "track outside artifact"], root);
  await writeFile(outside, "new\n");

  await assert.rejects(
    run("bash", [script, root], root),
    (error: unknown) => {
      const failure = error as { code?: number; stderr?: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr ?? "", /outside-publication\.txt/);
      return true;
    },
  );
});

test("fails with the omitted path when generation leaves an untracked artifact", async () => {
  const root = await createRepository();
  await writeFile(join(root, "unexpected-publication.json"), "new\n");

  await assert.rejects(
    run("bash", [script, root], root),
    (error: unknown) => {
      const failure = error as { code?: number; stderr?: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr ?? "", /unexpected-publication\.json/);
      return true;
    },
  );
  assert.equal(await readFile(join(root, "unexpected-publication.json"), "utf8"), "new\n");
});
