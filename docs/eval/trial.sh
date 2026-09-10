#!/usr/bin/env bash
# Drives one trial in two steps, because an agent's first start in a fresh
# directory stops at its own folder-trust dialog, which only a person (or a
# key press) answers:
#
#   docs/eval/trial.sh <case> <label> start <kind> [agent args...]
#       a tab at the sandbox root with FX_TRACE pointed at the trial's
#       directory, and the agent in it; answer any dialog in the pane
#   docs/eval/trial.sh <case> <label> prompt
#       the evidence of what actually started, then the case prompt
#
#   docs/eval/trial.sh R1 gpt55-a start codex -m gpt-5.5
#   docs/eval/trial.sh R1 gpt55-a prompt
#
# It returns as soon as the prompt is submitted; the run is read back later
# from the report and the trace.

set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo 'usage: trial.sh <case> <label> <start|prompt> [kind args...]' >&2
  exit 2
fi
CASE=$1 LABEL=$2 STEP=$3
shift 3
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/runtime.sh"
PROMPT=${EVAL_PROMPT_FILE:-$HERE/prompts/$CASE.md}
if [[ ! "$CASE" =~ ^[A-Z][0-9]+$ || ! "$LABEL" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo 'invalid case or label' >&2
  exit 2
fi
DIR=$EVAL/root/.eval/$CASE/$LABEL
NAME=$(echo "eval-$CASE-$LABEL" | tr '[:upper:]' '[:lower:]')

case $STEP in
start)
  test "${HERDR_ENV:-}" = 1
  test -f "$PROMPT"
  test -d "$EVAL/root"
  KIND=$1
  shift
  if [ -e "$DIR" ]; then
    echo 'trial directory already exists; use a new label to preserve evidence' >&2
    exit 2
  fi
  prepare_runtime
  smoke_runtime
  mkdir -p "$DIR"
  sed -e "s|<trial-label>|$LABEL|g" -e "s|<你的名字>|$LABEL|g" "$PROMPT" > "$DIR/prompt.md"
  TAB=$(herdr tab create --workspace "${HERDR_WORKSPACE_ID:?}" --cwd "$EVAL/root" \
    --env "FX_HOME=$EVAL/home" --env FX_UPDATE_CHECK=0 \
    --env "npm_config_cache=$DIR/npm-cache" \
    --env "PATH=$PATH" \
    --env "FX_TRACE=$DIR/trace.jsonl" \
    --label "eval $CASE $LABEL" --no-focus)
  printf '%s\n' "$TAB" > "$DIR/tab.json"
  PANE=$(node -e 'console.log(JSON.parse(process.argv[1]).result.root_pane.pane_id)' "$TAB")
  echo "$NAME in pane $PANE"
  herdr agent start "$NAME" --kind "$KIND" --pane "$PANE" --timeout 30000 -- "$@" > "$DIR/start.json" 2> "$DIR/start.stderr" || {
    echo "agent not ready: inspect $DIR/start.stderr and pane $PANE before prompting" >&2
    exit 1
  }
  ;;
prompt)
  test "${HERDR_ENV:-}" = 1
  test -d "$DIR"
  if [ -e "$DIR/prompt-result.json" ]; then
    echo 'prompt already submitted or attempted; inspect the existing run before retrying' >&2
    exit 2
  fi
  herdr agent get "$NAME" > "$DIR/agent.json"
  # The prompt names the report's directory after the label, so two agents
  # on one case never write over each other.
  test -f "$DIR/prompt.md"
  herdr agent prompt "$NAME" "$(cat "$DIR/prompt.md")" > "$DIR/prompt-result.json" 2> "$DIR/prompt.stderr"
  echo "$NAME prompted; report expected at $DIR/report.md"
  ;;
*)
  echo "step must be start or prompt" >&2
  exit 2
  ;;
esac
