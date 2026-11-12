#!/usr/bin/env bash
set -euo pipefail

request_list=${1:?Usage: destroy_removed_modules.sh <request-list> [repository] [plan|destroy]}
repository=${2:-$(git rev-parse --show-toplevel)}
operation=${3:-destroy}
[[ "$operation" == plan || "$operation" == destroy ]] || exit 1
repository=$(cd "$repository" && pwd)
[[ -f "$request_list" ]] || { echo "Removal request list not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v terragrunt >/dev/null || exit 1
terragrunt run --help | grep -q -- '--queue-include-dir' || {
  echo "Terragrunt must support targeted queue inclusion" >&2
  exit 1
}

worktree_root=""
worktree_path=""
cleanup() {
  if [[ -n "$worktree_path" && -d "$worktree_path" ]]; then
    git -C "$repository" worktree remove --force "$worktree_path"
  fi
  [[ -z "$worktree_root" ]] || rm -rf "$worktree_root"
}
trap cleanup EXIT

while IFS= read -r request_path || [[ -n "$request_path" ]]; do
  [[ -n "$request_path" ]] || continue
  if [[ ! "$request_path" =~ ^infrastructure/([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9][A-Za-z0-9-]*)/\.module-removals/[0-9]+\.json$ ]]; then
    echo "Invalid removal request path" >&2
    exit 1
  fi
  path_project=${BASH_REMATCH[1]}
  path_environment=${BASH_REMATCH[2]}
  request_file="$repository/$request_path"
  jq -e '
    type == "object" and .version == 1 and
    (.project | type == "string") and
    (.environment | type == "string") and
    (.source_commit | type == "string") and
    (.removed_modules | type == "array" and length > 0 and all(.[]; type == "string"))
  ' "$request_file" >/dev/null
  project=$(jq -r '.project' "$request_file")
  environment=$(jq -r '.environment' "$request_file")
  source_commit=$(jq -r '.source_commit' "$request_file")
  [[ "$project" == "$path_project" && "$environment" == "$path_environment" ]] || exit 1
  [[ "$source_commit" =~ ^[0-9a-fA-F]{7,64}$ ]] || exit 1
  git -C "$repository" cat-file -e "${source_commit}^{commit}"
  git -C "$repository" merge-base --is-ancestor "$source_commit" HEAD

  removed_modules=()
  while IFS= read -r module; do
    [[ "$module" =~ ^[a-z0-9][a-z0-9-]*$ && "$module" != resourcegroups ]] || {
      echo "Invalid removed module: $module" >&2
      exit 1
    }
    [[ ! -d "$repository/infrastructure/$project/$environment/$module" ]] || {
      echo "Removed module still exists: $module" >&2
      exit 1
    }
    removed_modules+=("$module")
  done < <(jq -r '.removed_modules[]' "$request_file")

  worktree_root=$(mktemp -d "${TMPDIR:-/tmp}/module-destroy.XXXXXX")
  worktree_path="$worktree_root/source"
  git -C "$repository" worktree add --detach "$worktree_path" "$source_commit" >/dev/null
  source_environment="$worktree_path/infrastructure/$project/$environment"
  [[ -d "$source_environment" ]] || exit 1
  if [[ -f "$worktree_path/infrastructure/root.hcl" ]]; then
    cp "$worktree_path/infrastructure/root.hcl" "$worktree_path/infrastructure/terragrunt.hcl"
  fi
  arguments=(run --all --non-interactive --parallelism 1 --queue-strict-include)
  for module in "${removed_modules[@]}"; do
    [[ -f "$source_environment/$module/terragrunt.hcl" ]] || exit 1
    arguments+=(--queue-include-dir "./$module")
  done
  if [[ "$operation" == plan ]]; then
    if [[ -n "${PLAN_OUTPUT_ROOT:-}" ]]; then
      output="$PLAN_OUTPUT_ROOT/removed-$(basename "$request_path" .json)"
      arguments+=(--out-dir "$output" --json-out-dir "$output-json")
    fi
    arguments+=(-- plan -destroy -input=false -lock-timeout=5m)
  else
    arguments+=(-- destroy -auto-approve -input=false -lock-timeout=5m)
  fi
  (cd "$source_environment" && terragrunt "${arguments[@]}")
  cleanup
  worktree_root=""
  worktree_path=""
done < "$request_list"