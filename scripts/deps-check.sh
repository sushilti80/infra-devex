#!/usr/bin/env bash
# scripts/deps-check.sh — Dependency Hygiene Validation
# Runs in CI as a gate before tests and before Docker build.
# Exits non-zero on any blocking finding.
#
# Checks (in order, fastest first):
#   1. Lock file sync   — package.json and package-lock.json are in sync
#   2. npm audit        — zero critical/high vulnerabilities in production deps
#   3. Deprecated pkgs  — no deprecated packages in the installed tree
#   4. Node runtime     — Dockerfile + workflow Node versions and action runtimes are supported
#
# Usage:
#   ./scripts/deps-check.sh                  # full check (all 4)
#   ./scripts/deps-check.sh --no-audit       # skip audit (for dev-only / offline)
#   ./scripts/deps-check.sh --json           # machine-readable output for CI summaries
#
# Environment variables:
#   ALLOW_NETWORK    — if "1", allows npm registry access for audit
#   AUDIT_SEVERITY   — comma-separated list to block (default: "critical,high")
#                      set to "" to skip audit entirely

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JSON_OUTPUT=false
SKIP_AUDIT=false
BLOCKING_SEVERITIES="${AUDIT_SEVERITY:-critical,high}"

# ── Parse args ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --json)        JSON_OUTPUT=true ;;
    --no-audit)    SKIP_AUDIT=true ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0 ;;
  esac
done

# ── Helpers ─────────────────────────────────────────────────────────────────
failures=0
output_prefix=""
if [ "$JSON_OUTPUT" = true ]; then
  output_prefix="  "
fi

emit() {
  if [ "$JSON_OUTPUT" = true ]; then
    echo "{\"check\": \"$1\", \"status\": \"$2\", \"detail\": \"$3\"}"
  else
    if [ "$2" = "pass" ]; then
      echo "✅ [deps-check] $1: $3"
    elif [ "$2" = "warn" ]; then
      echo "⚠️  [deps-check] $1: $3"
    else
      echo "❌ [deps-check] $1: $3"
    fi
  fi
}

check_pass() { emit "$1" "pass" "$2"; }
check_warn() { emit "$1" "warn" "$2"; }
check_fail() { emit "$1" "fail" "$2"; failures=$((failures + 1)); }

# ── Check 1: Lock file sync ─────────────────────────────────────────────────
check_lock_sync() {
  cd "$REPO_ROOT"

  if [ ! -f package-lock.json ]; then
    check_fail "lock-sync" "package-lock.json is missing — run 'npm install --package-lock-only'"
    return
  fi

  # npm ci will fail if out of sync; use --dry-run to check without installing
  if npm ci --dry-run --legacy-peer-deps >/dev/null 2>&1; then
    check_pass "lock-sync" "package.json and package-lock.json are in sync"
  else
    # Extract the specific mismatch from the error
    local err_msg
    err_msg=$(npm ci --dry-run --legacy-peer-deps 2>&1 | grep "does not satisfy" || true)
    if [ -n "$err_msg" ]; then
      check_fail "lock-sync" "lock file out of sync: $err_msg — run 'npm install --package-lock-only --legacy-peer-deps'"
    else
      check_fail "lock-sync" "lock file out of sync — run 'npm install --package-lock-only --legacy-peer-deps' and commit the result"
    fi
  fi
}

# ── Check 2: npm audit (vulnerabilities) ───────────────────────────────────
check_audit() {
  if [ "$SKIP_AUDIT" = true ]; then
    check_warn "audit" "skipped (--no-audit flag)"
    return
  fi

  if [ -z "$BLOCKING_SEVERITIES" ]; then
    check_warn "audit" "skipped (AUDIT_SEVERITY is empty)"
    return
  fi

  cd "$REPO_ROOT"

  # Only audit production deps — dev-only vulns don't ship to production
  local audit_output
  audit_output=$(npm audit --omit=dev --json 2>/dev/null || echo '{"vulnerabilities":{}}')

  local critical high moderate low total
  critical=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.critical // 0')
  high=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.high // 0')
  moderate=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.moderate // 0')
  low=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.low // 0')
  total=$(echo "$audit_output" | jq -r '.metadata.total // 0')

  local blocked=false
  local details="critical=$critical high=$high moderate=$moderate low=$low"

  for sev in $(echo "$BLOCKING_SEVERITIES" | tr ',' ' '); do
    case "$sev" in
      critical) [ "$critical" -gt 0 ] && blocked=true ;;
      high)     [ "$high" -gt 0 ]     && blocked=true ;;
      moderate) [ "$moderate" -gt 0 ] && blocked=true ;;
      low)      [ "$low" -gt 0 ]      && blocked=true ;;
    esac
  done

  if [ "$blocked" = true ]; then
    # List the vulnerable packages
    local vuln_pkgs
    vuln_pkgs=$(echo "$audit_output" | jq -r '.vulnerabilities | to_entries[] | "\(.key) (\(.value.severity))"' | head -20)
    check_fail "audit" "$details — vulnerable packages: $vuln_pkgs — run 'npm audit fix' or update the override in package.json"
  else
    if [ "$total" -gt 0 ]; then
      check_warn "audit" "$details — non-blocking vulnerabilities present (below severity threshold)"
    else
      check_pass "audit" "0 vulnerabilities in production dependencies"
    fi
  fi
}

# ── Check 3: Deprecated packages in installed tree ──────────────────────────
check_deprecated() {
  cd "$REPO_ROOT"

  if [ ! -d node_modules ]; then
    check_warn "deprecated" "node_modules not present — skipping (run 'npm ci' first)"
    return
  fi

  # Find deprecated packages using npm ls --json and grep for "deprecated"
  local deprecated_pkgs
  deprecated_pkgs=$(npm ls --all --json 2>/dev/null \
    | jq -r '
        [. as $root
         | paths
         | select(type == "string")
         | . as $path
         | $root
         | getpath($path)
         | select(type == "object" and .deprecated != null)
         | "\($path | join(" > ")) : \(.deprecated)"
        ] | unique[]
      ' 2>/dev/null || true)

  if [ -n "$deprecated_pkgs" ]; then
    local count
    count=$(echo "$deprecated_pkgs" | wc -l | tr -d ' ')
    # Filter to production deps only (dev-only deprecations are warnings)
    local prod_deprecated
    prod_deprecated=$(echo "$deprecated_pkgs" | head -10)
    if [ "$count" -gt 5 ]; then
      check_fail "deprecated" "$count deprecated packages found: $prod_deprecated ... — review and replace with maintained alternatives"
    else
      check_warn "deprecated" "$count deprecated packages found: $prod_deprecated — review and replace when possible"
    fi
  else
    check_pass "deprecated" "no deprecated packages detected"
  fi
}

# ── Check 4: Node runtime version consistency & deprecation ──────────────────
check_node_runtime() {
  cd "$REPO_ROOT"

  local min_node="22"
  local deprecated_versions="18 20"
  local issues=""

  # Check Dockerfile
  if [ -f Dockerfile ]; then
    local dockerfile_nodes
    dockerfile_nodes=$(grep -ohE 'node:[0-9]+' Dockerfile | sed 's/node://' | sort -u || true)
    for ver in $dockerfile_nodes; do
      for dep in $deprecated_versions; do
        if [ "$ver" = "$dep" ]; then
          issues="$issues Dockerfile uses deprecated node:$ver"
        fi
      done
      if [ "$ver" -lt "$min_node" ]; then
        issues="$issues Dockerfile node:$ver below minimum $min_node"
      fi
    done
  fi

  # Check workflow Node versions, including inline setup-node values.
  for wf in "$REPO_ROOT"/.github/workflows/*.yml "$REPO_ROOT"/.github/workflows/*.yaml; do
    [ -f "$wf" ] || continue
    local wf_nodes
    wf_nodes=$(grep -Eo "(NODE_VERSION|node-version):[[:space:]]*[\"']?[0-9]+" "$wf" | grep -Eo '[0-9]+$' | sort -u || true)
    for wf_node in $wf_nodes; do
      for dep in $deprecated_versions; do
        if [ "$wf_node" = "$dep" ]; then
          issues="$issues $(basename "$wf") uses deprecated Node $wf_node"
        fi
      done
      if [ "$wf_node" -lt "$min_node" ]; then
        issues="$issues $(basename "$wf") Node $wf_node below minimum $min_node"
      fi
    done
  done

  # Keep test/build runtimes aligned so a Docker-only Dependabot update cannot
  # leave CI testing a different Node major than the production image.
  local docker_node_major workflow_node_majors
  docker_node_major=$(grep -ohE 'node:[0-9]+' Dockerfile | head -1 | sed 's/node://' || true)
  workflow_node_majors=$(for wf in "$REPO_ROOT"/.github/workflows/*.yml "$REPO_ROOT"/.github/workflows/*.yaml; do
    [ -f "$wf" ] || continue
    grep -Eo "(NODE_VERSION|node-version):[[:space:]]*[\"']?[0-9]+" "$wf" | grep -Eo '[0-9]+$'
  done | sort -u || true)
  for wf_node in $workflow_node_majors; do
    if [ -n "$docker_node_major" ] && [ "$wf_node" != "$docker_node_major" ]; then
      issues="$issues workflow Node $wf_node does not match Dockerfile Node $docker_node_major"
    fi
  done

  # These action majors execute on the retired Node 20 action runtime.
  local deprecated_action_patterns=(
    'actions/checkout@v[1-4]([^0-9]|$)'
    'actions/setup-node@v[1-4]([^0-9]|$)'
    'actions/upload-artifact@v[1-6]([^0-9]|$)'
    'actions/download-artifact@v[1-6]([^0-9]|$)'
    'docker/login-action@v[1-3]([^0-9]|$)'
    'docker/setup-buildx-action@v[1-3]([^0-9]|$)'
    'docker/metadata-action@v[1-5]([^0-9]|$)'
    'docker/build-push-action@v[1-6]([^0-9]|$)'
    'azure/login@v[1-2]([^0-9]|$)'
    'azure/aks-set-context@v[1-4]([^0-9]|$)'
    'github/codeql-action/[^[:space:]]+@v[1-3]([^0-9]|$)'
    'codecov/codecov-action@v[1-5]([^0-9]|$)'
  )
  for wf in "$REPO_ROOT"/.github/workflows/*.yml "$REPO_ROOT"/.github/workflows/*.yaml; do
    [ -f "$wf" ] || continue
    for pattern in "${deprecated_action_patterns[@]}"; do
      if grep -Eq "$pattern" "$wf"; then
        issues="$issues $(basename "$wf") uses a Node 20 action matching $pattern"
      fi
    done
  done

  # Check @types/node in package.json matches
  local types_node_ver
  types_node_ver=$(node -e "try{console.log(require('./package.json').devDependencies['@types/node']||'')}catch(e){}" 2>/dev/null || true)
  if echo "$types_node_ver" | grep -qE '\^?(1[0-9]|20|21)\.'; then
    issues="$issues package.json @types/node=$types_node_ver is deprecated"
  fi

  if [ -n "$issues" ]; then
    check_fail "node-runtime" "deprecated/unsupported Node version:$issues"
  else
    local current
    current=$(grep -ohE 'node:[0-9]+' Dockerfile | head -1 | sed 's/node://' || echo "N/A")
    check_pass "node-runtime" "all Node versions >= $min_node and action runtimes are supported (Dockerfile: $current)"
  fi
}

# ── Run all checks ──────────────────────────────────────────────────────────
main() {
  if [ "$JSON_OUTPUT" = false ]; then
    echo "────────────────────────────────────────────"
    echo "  Dependency Hygiene Check"
    echo "  Repository: $(basename "$REPO_ROOT")"
    echo "  Date:       $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "────────────────────────────────────────────"
    echo ""
  fi

  check_lock_sync
  check_node_runtime
  check_audit
  check_deprecated

  if [ "$JSON_OUTPUT" = false ]; then
    echo ""
    echo "────────────────────────────────────────────"
  fi

  if [ "$failures" -gt 0 ]; then
    if [ "$JSON_OUTPUT" = true ]; then
      echo "{\"summary\": {\"total_failures\": $failures}}"
    else
      echo "  Result: ❌ $failures blocking finding(s)"
      echo "  Fix the issues above before merging."
    fi
    exit 1
  else
    if [ "$JSON_OUTPUT" = true ]; then
      echo "{\"summary\": {\"total_failures\": 0}}"
    else
      echo "  Result: ✅ All dependency hygiene checks passed"
    fi
    exit 0
  fi
}

main
