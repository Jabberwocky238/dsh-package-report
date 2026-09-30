#!/usr/bin/env bash
# Daily refresh: update the upstream checkout, build it, collect the report, deploy, and push the data.
# Invoked by cron; see README.md.
set -euo pipefail
export PATH="/home/zq/.nvm/versions/node/v25.9.0/bin:/home/zq/.nvm/versions/node/v25.9.0/bin:/home/zq/.nvm/versions/node/v25.9.0/bin:$PATH"
SRC="${DSH_SRC:-$HOME/coding/dsh-report-src}"
REPORT="$(cd "$(dirname "$0")/.." && pwd)"

git -C "$SRC" fetch -q origin master
git -C "$SRC" reset -q --hard origin/master
(cd "$SRC" && pnpm install --frozen-lockfile && pnpm run build)

cd "$REPORT"
node scripts/collect.mjs "$SRC"
bun run deploy
git add -A public/data
if ! git diff --cached --quiet -- public/data; then
  git commit -q -m "data: $(TZ=Asia/Shanghai date +%F) $(git -C "$SRC" rev-parse --short HEAD)"
  git push -q origin main
fi
