#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# generate_dynamic_rbac.sh — build Terragrunt 'generate' block that writes
# rbac.auto.tfvars.json with fully-literal values (overrides TF_VAR_*).
# Usage: generate_dynamic_rbac.sh <project> <environment> <rbac_pairs>
# rbac_pairs example:
#   "userassignmsi|keyvault|Key Vault Secrets Officer,appservicelinux|azuresqlserver|Reader,userassignmsi|/subscriptions/.../resourceGroups/rg1|Reader"
# ------------------------------------------------------------------------------

set -euo pipefail
IFS=$'\n\t'
export LC_ALL=C

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <project> <environment> <rbac_pairs>" >&2
  exit 1
fi

project="$(echo "${1}" | tr '[:upper:]' '[:lower:]')"
environment="$(echo "${2}" | tr '[:upper:]' '[:lower:]')"
rbac_input="$3"

tgt_file="infrastructure/${project}/${environment}/rbac/terragrunt.hcl"
mkdir -p "$(dirname "$tgt_file")"

# Helpers
trim()  { awk '{$1=$1;print}'; }
lower() { tr '[:upper:]' '[:lower:]'; }
esc_hcl_str() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; printf '%s' "$s"; }

# Extract base module name by removing -<identifier> suffix
# Examples: appservicelinux-2 -> appservicelinux, keyvault-prod -> keyvault
extract_base_module() {
  local module="$1"
  # Remove everything after the last hyphen followed by a number or identifier
  echo "$module" | sed -E 's/-[0-9a-zA-Z]+$//'
}

# Generate deterministic GUID from string input (cross-platform: Linux sha256sum, macOS shasum)
generate_mock_guid() {
  local input="$1"
  local hash
  if command -v sha256sum &>/dev/null; then
    hash=$(echo -n "$input" | sha256sum | cut -c1-32)
  else
    hash=$(echo -n "$input" | shasum -a 256 | cut -c1-32)
  fi
  # Format as GUID: 8-4-4-4-12
  printf "%s-%s-%s-%s-%s" \
    "${hash:0:8}" "${hash:8:4}" "${hash:12:4}" "${hash:16:4}" "${hash:20:12}"
}

# Generate safe principal ID expression that handles maps, lists, and strings
generate_safe_principal_expr() {
  local dep_name="$1"
  cat <<'EOF'
  coalesce(
    try(tostring(dependency.DEPNAME.outputs.principal_id[0]), null),
    try(tostring(values(dependency.DEPNAME.outputs.principal_id)[0][0]), null),
    try(tostring(values(dependency.DEPNAME.outputs.principal_id)[0]), null),
    try(tostring(dependency.DEPNAME.outputs.principal_id), null),
    try(tostring(dependency.DEPNAME.outputs.identity[0].principal_id), null),
    try(tostring(dependency.DEPNAME.outputs.identity_principal_id), null),
    "00000000-0000-0000-0000-000000000000"
  )
EOF
}

# Generate safe scope expression that handles different resource types.
# redis module exposes output "redis_id" (azurerm_redis_cache.this.id).
generate_safe_scope_expr() {
  local dep_name="$1"
  cat <<'EOF'
coalesce(
  try(tostring(dependency.DEPNAME.outputs.resource_id[0]), null),
  try(tostring(dependency.DEPNAME.outputs.resource_id), null),
  try(tostring(dependency.DEPNAME.outputs.id[0]), null),
  try(tostring(dependency.DEPNAME.outputs.id), null),
  try(tostring(dependency.DEPNAME.outputs.key_vault_id[0]), null),
  try(tostring(dependency.DEPNAME.outputs.key_vault_id), null),
  try(tostring(dependency.DEPNAME.outputs.app_configuration_id[0]), null),
  try(tostring(dependency.DEPNAME.outputs.app_configuration_id), null),
  try(tostring(dependency.DEPNAME.outputs.storage_account_id[0]), null),
  try(tostring(dependency.DEPNAME.outputs.storage_account_id), null),
  try(tostring(dependency.DEPNAME.outputs.redis_id[0]), null),
  try(tostring(dependency.DEPNAME.outputs.redis_id), null),
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/__rbac-mock-scope__"
)
EOF
}


# Ensure base file exists (minimal)
if [[ ! -f "$tgt_file" ]]; then
  cat > "$tgt_file" <<'HCL'
terraform { source = "{{ .sourceUrl }}" }

include "root" {
  path           = find_in_parent_folders()
  merge_strategy = "deep"
  expose         = true
}

locals {
  # env & naming locals ...
}

# RBAC content will be appended by generator
HCL
fi



# Known module -> relative config path (base module names only)
# For modules with identifiers (e.g., appservicelinux-2), the full path will be constructed
declare -A CONFIG_PATH=(
  [rg]="resourcegroups"
  [appconfiguration]="appconfiguration"
  [appservicelinux]="appservicelinux"
  [appservicewindows]="appservicewindows"
  [functionappsvclinux]="functionappsvclinux"
  [functionappsvcwindows]="functionappsvcwindows"
  [storagev2]="storagev2"
  [keyvault]="keyvault"
  [azuresqlserver]="azuresqlserver"
  [sqldb]="sqldb"
  [userassignmsi]="userassignmsi"
  [eventgridtopics]="eventgridtopics"
  [servicebus]="servicebus"
  [aifoundryproject]="aifoundryproject"
  [aifoundry]="aifoundry"
  [redis]="redis"
  [durabletaskscheduler]="durabletaskscheduler"
)

# Parse pairs -> normalized triples + role index (per source+role)
declare -a triples=()
declare -A role_idx=()
declare -A used=()          # modules to emit dependency for (full names with identifiers)
declare -A base_modules=()  # map full module name to base module name
declare -A by_source_roles  # group roles per source (we'll serialize later)
IFS=',' read -r -a raw_pairs <<< "$rbac_input"
for raw in "${raw_pairs[@]}"; do
  p="$(echo "$raw" | trim)"; [[ -z "$p" ]] && continue
  IFS='|' read -r s t r <<< "$p" || { echo "⚠️  Skipping malformed: $p" >&2; continue; }
  s_norm="$(echo "$s" | trim | lower)"
  t_norm="$(echo "$t" | trim)"; t_norm_lc="$(echo "$t_norm" | lower)"
  r_norm="$(echo "$r" | trim)"   # Role name is case-sensitive in Azure

  # role_index per (source, role)
  key="${s_norm}|${r_norm}"
  role_idx[$key]=$(( ${role_idx[$key]:-0} + 1 ))
  idx="${role_idx[$key]}"

  # track modules used (skip raw ARM scope)
  # store both full name and base module name
  if [[ "$s_norm" != /* ]]; then
    used["$s_norm"]=1
    base_modules["$s_norm"]="$(extract_base_module "$s_norm")"
  fi

  if [[ "$t_norm_lc" != /* ]]; then
    # module target
    used["$t_norm_lc"]=1
    base_modules["$t_norm_lc"]="$(extract_base_module "$t_norm_lc")"
    triples+=( "${s_norm}|${t_norm_lc}|${r_norm}|${idx}|mod" )
  else
    # raw ARM scope
    triples+=( "${s_norm}|${t_norm}|${r_norm}|${idx}|raw" )
  fi
done

# Fail fast on unknown module labels (check base module names)
unknown=0
for t in "${triples[@]}"; do
  IFS='|' read -r src tgt _ _ kind <<< "$t"
  if [[ "$src" != /* ]]; then
    src_base="${base_modules[$src]}"
    if [[ -z "${CONFIG_PATH[$src_base]+x}" ]]; then
      echo "❌ Unknown base module for source: '$src' (base: '$src_base'). Add to CONFIG_PATH." >&2
      unknown=1
    fi
  fi
  if [[ "$kind" == "mod" ]]; then
    tgt_base="${base_modules[$tgt]}"
    if [[ -z "${CONFIG_PATH[$tgt_base]+x}" ]]; then
      echo "❌ Unknown base module for target: '$tgt' (base: '$tgt_base'). Add to CONFIG_PATH." >&2
      unknown=1
    fi
  fi
done
[[ $unknown -eq 1 ]] && exit 2

# --------- Clean previous generated regions / inputs / generate blocks ----------
tmp="$(mktemp)"
awk '
  BEGIN { in_auto=0; in_deps=0; in_gen=0; in_inputs=0; depth=0 }
  # RBAC auto regions
  /RBAC: BEGIN AUTO-GENERATED/ { in_auto=1; next }
  /RBAC: END AUTO-GENERATED/   { in_auto=0; next }
  /RBAC DEPS: BEGIN AUTO-GENERATED/ { in_deps=1; next }
  /RBAC DEPS: END AUTO-GENERATED/   { in_deps=0; next }

  # Remove any existing generate "rbac_inputs" { ... }
  /^[[:space:]]*generate[[:space:]]+"rbac_inputs"[[:space:]]*{/ { in_gen=1; depth=1; next }
  in_gen {
    for (i=1; i<=length($0); i++) {
      c = substr($0, i, 1)
      if (c == "{") depth++
      if (c == "}") depth--
    }
    if (depth <= 0) in_gen = 0
    next
  }

  # Remove any prior inputs blocks (attribute or bare)
  /^[[:space:]]*inputs[[:space:]]*(=[[:space:]]*)?{/ { in_inputs=1; depth=1; next }
  in_inputs {
    for (i=1; i<=length($0); i++) {
      c = substr($0, i, 1)
      if (c == "{") depth++
      if (c == "}") depth--
    }
    if (depth <= 0) in_inputs = 0
    next
  }

  (in_auto==0 && in_deps==0) { print }
' "$tgt_file" > "$tmp" && mv "$tmp" "$tgt_file"

# --------- Inject generate "rbac_inputs" with fully-evaluated JSON --------------
# Build HCL that Terragrunt will evaluate, then jsonencode to JSON literals
gen_payload="$(mktemp)"
{
  echo 'generate "rbac_inputs" {'
  echo '  path              = "rbac.auto.tfvars.json"'
  echo '  if_exists         = "overwrite"'
  echo '  disable_signature = true'
  echo '  contents = jsonencode({'
  echo '    roleAssignment = ['

  # group by source (preserve insertion order)
  declare -A seen_src=(); declare -a src_list=()
  for t in "${triples[@]}"; do
    IFS='|' read -r src _ _ _ _ <<< "$t"
    if [[ -z "${seen_src[$src]+x}" ]]; then seen_src["$src"]=1; src_list+=("$src"); fi
  done

  for ((i=0;i<${#src_list[@]};i++)); do
    src="${src_list[$i]}"
    # Use helper function to generate safe principal ID expression
    prin_expr="$(generate_safe_principal_expr "$src" | sed "s/DEPNAME/${src}/g" | tr -d '\n')"

    echo '      {'
    echo "        service_principle_id = ${prin_expr}"
    echo '        roles = ['

    # roles for this source
    for t in "${triples[@]}"; do
      IFS='|' read -r s tgt role idx kind <<< "$t"; [[ "$s" != "$src" ]] && continue
      if [[ "$kind" == "raw" ]]; then
        scope_expr="\"$(esc_hcl_str "$tgt")\""
      else
        # Use helper function to generate safe scope expression
        scope_expr="$(generate_safe_scope_expr "$tgt" | sed "s/DEPNAME/${tgt}/g" | tr -d '\n')"
      fi
      role_q="\"$(esc_hcl_str "$role")\""
      cat <<HCL
          {
            scope                = ${scope_expr}
            role_definition_name = ${role_q}
            role_index           = ${idx}
          },
HCL
    done

    echo '        ]'
    echo '      },'
  done

  echo '    ]'
  echo '  })'
  echo '}'
} > "$gen_payload"

# Append the generate block to the end of file
{ echo ""; cat "$gen_payload"; } >> "$tgt_file"
rm -f "$gen_payload"

# --------- Emit dependency blocks for used modules (idempotent region) ----------
# Build list of labels to add (skip any already present)
declare -a gen_labels=()
for mod in "${!used[@]}"; do
  # Get base module name for config_path lookup
  base_mod="${base_modules[$mod]}"
  path="${CONFIG_PATH[$base_mod]-}"; [[ -z "$path" ]] && continue
  # Check if dependency already exists for this full module name
  if grep -qE '^[[:space:]]*dependency[[:space:]]+"'"$mod"'"[[:space:]]*{' "$tgt_file"; then
    continue
  fi
  gen_labels+=("$mod")
done

inj_deps="$(mktemp)"
{
  echo ""
  echo "# --- RBAC DEPS: BEGIN AUTO-GENERATED - DO NOT EDIT ---"
  for mod in "${gen_labels[@]}"; do
    # Get base module name for validation
    base_mod="${base_modules[$mod]}"
    base_path="${CONFIG_PATH[$base_mod]}"

    # Construct full config_path using the full module name (with identifier)
    # This ensures we point to the actual folder, e.g., ../appservicelinux-2
    config_path="../${mod}"

    # Generate unique mock GUIDs for this specific module instance
    mock_principal_guid=$(generate_mock_guid "${project}-${environment}-${mod}-principal")
    mock_resource_guid=$(generate_mock_guid "${project}-${environment}-${mod}-resource")
    mock_subscription_guid=$(generate_mock_guid "${project}-${environment}-subscription")

    cat <<HCL
dependency "${mod}" {
  config_path = "${config_path}"
  mock_outputs_allowed_terraform_commands = ["validate", "plan", "output"]
  mock_outputs = {

    # Module-specific mocks to avoid conflicts during plan
    id                    = "/subscriptions/${mock_subscription_guid}/providers/Microsoft.Mock/type/${mod}-mock"
    resource_id           = "/subscriptions/${mock_subscription_guid}/resourceGroups/${project}-${environment}-${mod}-mock-rg"
    principal_id          = ["${mock_principal_guid}"]
    identity_principal_id = "${mock_principal_guid}"
    identity              = []
    resource_group_name   = "${project}-${environment}-${mod}-mock-rg"
    key_vault_id          = "/subscriptions/${mock_subscription_guid}/resourceGroups/${project}-${environment}-${mod}-mock-rg/providers/Microsoft.KeyVault/vaults/${project}-${environment}-${mod}-mock-kv"
    redis_id              = "/subscriptions/${mock_subscription_guid}/resourceGroups/${project}-${environment}-${mod}-mock-rg/providers/Microsoft.Cache/Redis/${project}-${environment}-${mod}-mock-redis"

  }
}
HCL
  done
  echo "# --- RBAC DEPS: END AUTO-GENERATED ---"
} > "$inj_deps"

# Replace previous deps region (if any) and append
tmp="$(mktemp)"
awk '
  BEGIN { in_deps=0 }
  /RBAC DEPS: BEGIN AUTO-GENERATED/ { in_deps=1; next }
  /RBAC DEPS: END AUTO-GENERATED/   { in_deps=0; next }
  in_deps==0 { print }
' "$tgt_file" > "$tmp"
cat "$inj_deps" >> "$tmp"
mv "$tmp" "$tgt_file"
rm -f "$inj_deps"

echo "✅ RBAC JSON generator injected into $tgt_file"
