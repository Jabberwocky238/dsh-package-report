#!/usr/bin/env bash
# Hourly refresh: re-fetch yesterday's and today's topic repositories, re-collect from the already built
# upstream checkout, and deploy. Does not rebuild upstream or commit; scripts/daily.sh does both once a day.
# Invoked by cron; see HANDOFF.md.
set -euo pipefail
export PATH="/home/zq/.nvm/versions/node/v25.9.0/bin:$PATH"
SRC="${DSH_SRC:-$HOME/coding/dsh-report-src}"
REPORT="$(cd "$(dirname "$0")/.." && pwd)"
exec 9>"${TMPDIR:-/tmp}/dsh-report.lock"
flock 9

cd "$REPORT"
node scripts/repos.mjs
node scripts/collect.mjs "$SRC"
bun run deploy
