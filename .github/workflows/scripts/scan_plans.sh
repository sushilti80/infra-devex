#!/usr/bin/env bash
set -euo pipefail

root=${1:?Usage: scan_plans.sh <plan-output-directory>}
[[ -d "$root" ]] || { echo "Plan output directory not found" >&2; exit 1; }
command -v checkov >/dev/null || { echo "Checkov is required" >&2; exit 1; }

found=0
failed=0
while IFS= read -r -d '' plan; do
  found=1
  if ! checkov --file "$plan" --framework terraform_plan --compact --quiet; then
    failed=1
  fi
done < <(find "$root" -type f -name '*.json' -print0)
if [[ "$found" -eq 0 ]]; then
  echo "No Terraform JSON plans were generated" >&2
  exit 1
fi
exit "$failed"
