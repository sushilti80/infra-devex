#!/usr/bin/env bash

set -euo pipefail

request_list=${1:?Usage: destroy_removed_modules.sh <request-list> [repository]}
repository=${2:-$(git rev-parse --show-toplevel)}
repository=$(cd "$repository" && pwd)

[[ -f "$request_list" ]] || { echo "Removal request list not found: $request_list" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v terragrunt >/dev/null || { echo "terragrunt is required" >&2; exit 1; }
terragrunt run --help | grep -q -- '--queue-include-dir' || {
  echo "Installed Terragrunt does not support targeted queue inclusion" >&2
  exit 1
}

worktree_root=""
worktree_path=""
cleanup() {
  if [[ -n "$worktree_path" && -d "$worktree_path" ]]; then
    git -C "$repository" worktree remove --force "$worktree_path" >/dev/null 2>&1 || {
      echo "Failed to remove temporary worktree: $worktree_path" >&2
    }
  fi
  [[ -z "$worktree_root" ]] || rm -rf "$worktree_root"
}
trap cleanup EXIT

while IFS= read -r request_path || [[ -n "$request_path" ]]; do
  [[ -n "$request_path" ]] || continue

  if [[ ! "$request_path" =~ ^infrastructure/([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9][A-Za-z0-9-]*)/\.module-removals/[0-9]+\.json$ ]]; then
    echo "Invalid removal request path: $request_path" >&2
    exit 1
  fi
  path_project=${BASH_REMATCH[1]}
  path_environment=${BASH_REMATCH[2]}
  request_file="$repository/$request_path"
  [[ -f "$request_file" ]] || { echo "Removal request not found: $request_path" >&2; exit 1; }

  jq -e '
    type == "object" and
    .version == 1 and
    (.project | type == "string") and
    (.environment | type == "string") and
    (.source_commit | type == "string") and
    (.removed_modules | type == "array" and length > 0 and all(.[]; type == "string"))
  ' "$request_file" >/dev/null || { echo "Invalid removal request: $request_path" >&2; exit 1; }

  project=$(jq -r '.project' "$request_file")
  environment=$(jq -r '.environment' "$request_file")
  source_commit=$(jq -r '.source_commit' "$request_file")
  [[ "$project" == "$path_project" && "$environment" == "$path_environment" ]] || {
    echo "Removal request does not match its path: $request_path" >&2
    exit 1
  }
  [[ "$source_commit" =~ ^[0-9a-fA-F]{7,64}$ ]] || {
    echo "Invalid source commit in $request_path" >&2
    exit 1
  }
  git -C "$repository" cat-file -e "${source_commit}^{commit}" || {
    echo "Source commit is unavailable: $source_commit" >&2
    exit 1
  }
  git -C "$repository" merge-base --is-ancestor "$source_commit" HEAD || {
    echo "Source commit is not an ancestor of the merged desired state: $source_commit" >&2
    exit 1
  }

  removed_modules=()
  while IFS= read -r module; do
    [[ "$module" =~ ^[a-z0-9][a-z0-9-]*$ && "$module" != "resourcegroups" ]] || {
      echo "Invalid removed module in $request_path: $module" >&2
      exit 1
    }
    removed_modules+=("$module")
  done < <(jq -r '.removed_modules[]' "$request_file")

  current_environment="$repository/infrastructure/$project/$environment"
  for module in "${removed_modules[@]}"; do
    [[ ! -d "$current_environment/$module" ]] || {
      echo "Removed module still exists in the merged desired state: $module" >&2
      exit 1
    }
  done

  worktree_root=$(mktemp -d "${TMPDIR:-/tmp}/module-destroy.XXXXXX")
  worktree_path="$worktree_root/source"
  git -C "$repository" worktree add --detach "$worktree_path" "$source_commit" >/dev/null
  source_environment="$worktree_path/infrastructure/$project/$environment"
  [[ -d "$source_environment" ]] || {
    echo "Source environment not found at commit $source_commit" >&2
    exit 1
  }

  terragrunt_args=(run --all --non-interactive --parallelism 1 --queue-strict-include)
  for module in "${removed_modules[@]}"; do
    [[ -f "$source_environment/$module/terragrunt.hcl" ]] || {
      echo "Source module not found at commit $source_commit: $module" >&2
      exit 1
    }
    terragrunt_args+=(--queue-include-dir "./$module")
  done
  terragrunt_args+=(-- destroy -lock=false)

  echo "Destroying removed modules for $project/$environment: ${removed_modules[*]}"
  (cd "$source_environment" && terragrunt "${terragrunt_args[@]}")

  cleanup
  worktree_root=""
  worktree_path=""
done < "$request_list"
