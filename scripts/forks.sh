#!/usr/bin/env bash
# Nightly fork scan: list every fork and branch again, compare new branch heads, read added manifests, then write
# public/data/forks.json and forks/. The next hourly.sh run collects and deploys it; daily.sh commits it.
# Invoked by cron; see HANDOFF.md §6.9.
set -euo pipefail
export PATH="/home/zq/.nvm/versions/node/v25.9.0/bin:$PATH"
SRC="${DSH_SRC:-$HOME/coding/dsh-report-src}"
REPORT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPORT"

# Talking to GitHub takes an hour or more; only the final write into public/data takes the shared lock.
node scripts/forks.mjs "$SRC" --stage list --fresh --batch 1000000
node scripts/forks.mjs "$SRC" --stage compare --batch 1000000
node scripts/forks.mjs "$SRC" --stage extract --batch 1000000
exec 9>"${TMPDIR:-/tmp}/dsh-report.lock"
flock 9
node scripts/forks.mjs "$SRC" --stage report
