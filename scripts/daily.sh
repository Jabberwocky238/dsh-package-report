#!/usr/bin/env bash
# Daily refresh: update the upstream checkout, build it, collect the report, deploy, and push the data.
# Invoked by cron; see HANDOFF.md.
set -euo pipefail
export PATH="/home/zq/.nvm/versions/node/v25.9.0/bin:$PATH"
SRC="${DSH_SRC:-$HOME/coding/dsh-report-src}"
REPORT="$(cd "$(dirname "$0")/.." && pwd)"
exec 9>"${TMPDIR:-/tmp}/dsh-report.lock"
flock 9

# Deploys build from the working tree; skip while code outside public/data has uncommitted edits.
if [ -n "$(git -C "$REPORT" status --porcelain -- . ':!public/data')" ]; then
  echo "$(date -Is) skipped: uncommitted changes outside public/data" >&2
  exit 0
fi

git -C "$SRC" fetch -q origin master
git -C "$SRC" reset -q --hard origin/master
(cd "$SRC" && pnpm install --frozen-lockfile && pnpm run build)

cd "$REPORT"
node scripts/repos.mjs
node scripts/collect.mjs "$SRC"
bun run deploy
git add -A public/data
if ! git diff --cached --quiet -- public/data; then
  git commit -q -m "data: $(TZ=Asia/Shanghai date +%F) $(git -C "$SRC" rev-parse --short HEAD)"
  git push -q origin main
fi
