import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const dailyDir = path.resolve("daily");
const files = (await readdir(dailyDir)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
const discoverySource = /google news|hacker news|^x\s*[·:]/i;
const placeholder = /暂无|暂未|待补|未生成|请阅读原文|HTTP\s+\d{3}/i;
const roundup = /盘点|榜单|评论|观点汇总/i;
const chinese = /[\u3400-\u9fff]/;

for (const file of files) {
  const fullPath = path.join(dailyDir, file);
  const archive = JSON.parse(await readFile(fullPath, "utf8"));
  const candidates = Array.isArray(archive.candidates) ? archive.candidates : [];
  const candidateIds = new Set(candidates.map((item) => item.id));
  const publicArticles = [];

  for (const article of archive.articles ?? []) {
    const hasChineseCopy =
      chinese.test(article.titleZh ?? "") &&
      chinese.test(article.summaryZh ?? "") &&
      !placeholder.test(article.summaryZh ?? "");
    const discoveryOnly = discoverySource.test(article.source ?? "");
    const genericRoundup = roundup.test(article.titleZh ?? article.title ?? "");

    if (hasChineseCopy && !discoveryOnly && !genericRoundup) {
      publicArticles.push(article);
      continue;
    }

    if (!candidateIds.has(article.id)) {
      const reasons = [];
      if (!hasChineseCopy) reasons.push("缺少完整中文事实简介");
      if (discoveryOnly) reasons.push("发现层信源需要二次核验");
      if (genericRoundup) reasons.push("聚合盘点或评论内容不进入公开层");
      candidates.push({
        ...article,
        stage: discoveryOnly ? "待二次核验" : "待中文事实简介",
        holdReasons: reasons,
      });
      candidateIds.add(article.id);
    }
  }

  archive.articles = publicArticles;
  archive.candidates = candidates;
  await writeFile(fullPath, `${JSON.stringify(archive, null, 2)}\n`);
}
