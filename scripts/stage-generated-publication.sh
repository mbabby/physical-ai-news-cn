#!/usr/bin/env bash
set -euo pipefail

repository_root="${1:-.}"
cd "$repository_root"

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
