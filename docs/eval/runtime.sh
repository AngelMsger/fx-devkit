#!/usr/bin/env bash
# Shared trial environment. A real executable survives child shells, unlike
# an alias; the wrapper pins both Node and the checkout used for evaluation.

EVAL=${EVAL:-/tmp/fx-eval}
DEVKIT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
export FX_HOME=$EVAL/home FX_UPDATE_CHECK=0

prepare_runtime() {
  mkdir -p "$EVAL/bin"
  {
    printf '#!/usr/bin/env bash\nexec '
    printf '%q ' "$(command -v node)" "$DEVKIT/bin/fx.js"
    printf '"$@"\n'
  } > "$EVAL/bin/fx"
  chmod +x "$EVAL/bin/fx"
  export PATH="$EVAL/bin:$PATH"
}

smoke_runtime() {
  local smoke_dir
  smoke_dir=$(mktemp -d "$EVAL/smoke.XXXXXX")
  FX_TRACE="$smoke_dir/trace.jsonl" bash -c 'fx config list --format json' > "$smoke_dir/result.json"
  node - "$smoke_dir/trace.jsonl" <<'NODE'
const fs = require('node:fs');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
if (records.length !== 1 || records[0].exit !== 0) process.exit(1);
NODE
  printf 'runtime smoke passed: %s\n' "$smoke_dir"
}
