#!/usr/bin/env bash
set -euo pipefail

[[ "${STACK_DIRECTORY:-}" =~ ^(infrastructure|recycle-bin)/[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || exit 1
[[ -d "$STACK_DIRECTORY" ]] || exit 1
repository=$PWD
case "${OPERATION:-}" in
  plan)
    arguments=(plan -input=false -lock-timeout=5m -no-color)
    [[ "${STACK_RETIRED:-false}" != true ]] || arguments+=(-destroy)
    ;;
  apply)
    arguments=(apply -auto-approve -input=false -lock-timeout=5m)
    [[ "${STACK_RETIRED:-false}" != true ]] || arguments=(destroy -auto-approve -input=false -lock-timeout=5m)
    ;;
  destroy) arguments=(destroy -auto-approve -input=false -lock-timeout=5m) ;;
  *) echo "Unsupported operation" >&2; exit 1 ;;
esac
queue_arguments=(run --all --non-interactive --parallelism 1)
if [[ "$OPERATION" == plan && -n "${PLAN_OUTPUT_ROOT:-}" ]]; then
  queue_arguments+=(--out-dir "$PLAN_OUTPUT_ROOT/current" --json-out-dir "$PLAN_OUTPUT_ROOT/current-json")
fi
(cd "$STACK_DIRECTORY" && terragrunt "${queue_arguments[@]}" -- "${arguments[@]}")

requests=$(mktemp)
trap 'rm -f "$requests"' EXIT
node - "$requests" <<'NODE'
const fs = require('node:fs');
const requests = JSON.parse(process.env.REMOVAL_REQUESTS || '[]');
if (!Array.isArray(requests) || !requests.every(value => typeof value === 'string' && !/[\r\n]/.test(value))) throw new Error('Invalid removal list');
fs.writeFileSync(process.argv[2], requests.join('\n') + (requests.length ? '\n' : ''));
NODE
if [[ -s "$requests" ]]; then
  operation=destroy
  [[ "$OPERATION" != plan ]] || operation=plan
  bash "$repository/.github/workflows/scripts/destroy_removed_modules.sh" "$requests" "$repository" "$operation"
fi