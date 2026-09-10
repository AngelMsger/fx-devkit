#!/usr/bin/env bash
# The evaluation sandbox: an fx-built workspace under tmp, scoped to the
# repositories the cases need. Idempotent; run again to refresh or to
# rebuild after tmp was cleaned. Nothing here touches the real workspace.
#
#   docs/eval/sandbox.sh            build or refresh
#   docs/eval/sandbox.sh env        print the exports a trial shell needs
#
# Initialization uses a temporary user home as well as FX_HOME: Skill installers
# must not change the person's global agent configuration. Trials and read-only
# doctor checks keep the native home so existing authentication remains usable.

set -euo pipefail

source "$(dirname "$0")/runtime.sh"
MANIFEST=${MANIFEST:-}
NAME=fx-eval
# Selection is supplied by the private case; the default clones no repositories.
REPOS=${EVAL_REPOS-}

if [ "${1:-}" = env ]; then
  printf 'export FX_HOME=%q FX_UPDATE_CHECK=0\n' "$FX_HOME"
  printf 'export PATH=%q:"$PATH"\n' "$EVAL/bin"
  exit 0
fi

prepare_runtime
if [ "${1:-}" = smoke ]; then
  smoke_runtime
  exit 0
fi

: "${MANIFEST:?Set MANIFEST to the manifest source for this trial.}"

mkdir -p "$EVAL/root" "$EVAL/.eval" "$EVAL/user-home" "$FX_HOME/workspaces/$NAME"
# The personal layer goes in before the first sync, so only the scoped
# repositories are ever cloned.
{
  echo 'scope:'
  if [ -z "$REPOS" ]; then echo '  repos: []'; else echo '  repos:'; fi
  for repo in ${REPOS//,/ }; do echo "    - $repo"; done
} > "$FX_HOME/workspaces/$NAME/local.yaml"

(cd "$DEVKIT" && npm run -s build)
env HOME="$EVAL/user-home" fx init "$EVAL/root" --from "$MANIFEST" --name "$NAME" --format json --no-input > "$EVAL/.eval/init.json" 2> "$EVAL/.eval/init.stderr"
smoke_runtime
fx doctor --workspace "$NAME" --format json > "$EVAL/.eval/doctor.json"
node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const off = d.findings.filter((f) => f.level !== "ok");
console.log(`doctor: ok ${d.summary.ok}, warn ${d.summary.warn}, fail ${d.summary.fail}`);
for (const f of off) console.log(`  ${f.level} ${f.group}:${f.id} ${f.message}`);
' "$EVAL/.eval/doctor.json"
node - "$EVAL/.eval/init.json" <<'NODE'
const fs = require('node:fs');
const init = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sync = init.sync;
const failures = [];
if (!init.written || !sync) failures.push('initialization did not finish');
if (sync?.summary.failed) failures.push(`${sync.summary.failed} repository operations failed`);
if (sync?.summary.unreadable) failures.push(`${sync.summary.unreadable} repositories unreadable`);
for (const [stage, counts] of Object.entries(sync?.stages ?? {})) {
  for (const [key, count] of Object.entries(counts)) {
    if (count > 0 && /(^|_)(failed|foreign)$/.test(key)) {
      failures.push(`${stage}.${key}: ${count}`);
    }
  }
}
if (failures.length) {
  console.error(`Sandbox preparation incomplete: ${failures.join(', ')}. Inspect init.json and init.stderr before a trial.`);
  process.exit(1);
}
NODE
echo "sandbox prepared at $EVAL/root (FX_HOME=$FX_HOME); inspect doctor coverage before choosing a trial"
