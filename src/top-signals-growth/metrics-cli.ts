import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runGrowthMetrics } from "./metrics.js";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runGrowthMetrics()
    .then((metrics) => {
      const visitors = metrics.uniqueVisitors14d === "unknown" ? "unknown" : String(metrics.uniqueVisitors14d);
      console.log(`Top Signals growth metrics updated: starDelta=${metrics.starDelta}, externalAuthors=${metrics.verifiedExternalAuthors}, uniqueVisitors14d=${visitors}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Top Signals growth metrics collection failed");
      process.exitCode = 1;
    });
}
