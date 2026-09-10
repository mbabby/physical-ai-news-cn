#!/usr/bin/env bash
set -euo pipefail

repository_root="${1:-.}"
cd "$repository_root"

# A new homepage cannot be staged without its complete explainer group.
# Legacy archived layouts remain supported; exact content is checked by validate:release.
if [[ -e site/data/progress-explainers.json || -e review/progress-explainers-run.json ]] || grep -qE 'PROGRESS_EXPLAINERS:|物理 AI 进展解读|Physical AI Explained' README.md || node -e '
  try {
    const manifest = JSON.parse(require("node:fs").readFileSync("review/run-manifest.json", "utf8"));
    process.exit(Array.isArray(manifest.services) && manifest.services.some(service => service.component === "ProgressExplainers") ? 0 : 1);
  } catch { process.exit(1); }
'; then
  if [[ ! -f site/data/progress-explainers.json || ! -f review/progress-explainers-run.json ]] || ! grep -q '<!-- PROGRESS_EXPLAINERS:START -->' README.md || ! grep -q '<!-- PROGRESS_EXPLAINERS:END -->' README.md; then
    echo '::error::Incomplete progress explainer publication group.' >&2
    exit 1
  fi
fi

publication_paths=(
  daily
  weekly
  sources
  review
  community
  resources
  events
  research
  routes
  metrics
  watchlist
  site/data
  site/feeds
  FACTS_POLICY.md
  README.md
  README.en.md
  posts
)

existing_paths=()
for path in "${publication_paths[@]}"; do
  if [[ -e "$path" ]]; then
    existing_paths+=("$path")
  fi
done

git add -- "${existing_paths[@]}"

# A rebase refuses both tracked unstaged changes and untracked generated
# files. Fail here with the exact paths so a newly introduced publication
# surface cannot silently strand an otherwise valid daily release.
unstaged="$(git status --porcelain=v1 --untracked-files=all | awk 'substr($0, 2, 1) != " " { print }')"
if [[ -n "$unstaged" ]]; then
  echo "::error::生成后仍有未暂存文件；请将其加入 scripts/stage-generated-publication.sh 的发布边界。" >&2
  printf '%s\n' "$unstaged" >&2
  exit 1
fi
