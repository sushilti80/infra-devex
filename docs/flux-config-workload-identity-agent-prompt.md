# Agent Prompt: Add External Resource Access (Workload Identity Grants) to flux-config

## Your Task

You are working in the `organization/flux-config` repository. Your goal is to extend the two
self-service workflow files and their Jinja2 templates to support a new optional input called
`workload_identity_grants`. When provided, this input describes Azure RBAC role assignments
that should be created, granting the app's auto-provisioned managed identity access to external
Azure resources (Key Vaults, AI Foundry, Storage accounts, Service Bus namespaces, etc.).

Azure Service Operator (ASO) is already installed on the cluster. Use ASO `RoleAssignment`
resources as Kubernetes manifests — do NOT use az CLI in the workflow or shell scripts.

---

## Background: What the Self-Service Portal Sends

A self-service portal (separate repo) triggers these workflows via `workflow_dispatch`. It
has been updated to pass a new optional input:

```
workload_identity_grants: '[{"resourceType":"security","resourceName":"my-keyvault","role":"Key Vault Secrets User"},{"resourceType":"ai","resourceName":"my-ai-foundry","role":"Azure AI Developer"}]'
```

**Shape of each grant object:**
```json
{
  "resourceType": "security",        // maps to an Azure resource category (see full mapping below)
  "resourceName": "my-keyvault",     // the Azure resource name (NOT full ARM ID)
  "role": "Key Vault Secrets User"   // Azure built-in role display name (see full list below)
}
```

**`resourceType` values and their Azure ARM provider namespaces:**
| resourceType | Azure Resource Provider | ARM type segment |
|---|---|---|
| `security` | `Microsoft.KeyVault` | `vaults` |
| `storage` | `Microsoft.Storage` | `storageAccounts` |
| `ai` | `Microsoft.CognitiveServices` | `accounts` (also covers AI Foundry / OpenAI) |
| `servicebus` | `Microsoft.ServiceBus` | `namespaces` |
| `appconfiguration` | `Microsoft.AppConfiguration` | `configurationStores` |
| `database` | `Microsoft.Sql` | `servers/databases` |
| `compute` | `Microsoft.Compute` | `virtualMachines` |
| `web` | `Microsoft.Web` | `sites` |
| `eventgrid` | `Microsoft.EventGrid` | `topics` (or `domains`) |

**Role display names and their Azure built-in role definition GUIDs:**
| Role Display Name | GUID |
|---|---|
| Key Vault Secrets User | `4633458b-17de-408a-b874-0445c86b69e6` |
| Key Vault Certificates Officer | `a4417e6f-fecd-4de8-b567-7b0420556985` |
| Storage Blob Data Contributor | `ba92f5b4-2d11-453d-a403-e96b0029c9fe` |
| Storage Blob Data Reader | `2a2b9908-6ea1-4ae2-8e65-a410df84e7d1` |
| Storage Queue Data Contributor | `974c5e8b-45b9-4653-ba55-5f855dd0fb88` |
| Storage Account Contributor | `17d1049b-9a84-46fb-8f53-869881c3d3ab` |
| Azure AI Developer | `64702f94-c441-49e6-a78b-ef80e0188fee` |
| Azure AI User | `53ca6127-db72-4b80-b1b0-d745d6d5456d` |
| Cognitive Services OpenAI Contributor | `a001fd3d-188f-4b5d-821b-7da978bf7442` |
| Cognitive Services OpenAI User | `5e0bd9bd-7b93-4f28-af87-19fc36ad61bd` |
| Cognitive Services Contributor | `25fbc0a9-bd7c-42a3-aa1a-3b75d497ee68` |
| App Configuration Data Reader | `516239f1-63e1-4d78-a4de-a74fb236a071` |
| Azure Service Bus Data Sender | `69a216fc-b8fb-44d8-bc22-1f3c2cd27a39` |
| Azure Service Bus Data Receiver | `4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0` |
| EventGrid EventSubscription Reader | `2414bbcf-6497-4faf-8c65-045460748405` |
| EventGrid EventSubscription Contributor | `1e241071-0855-49ea-94dc-649edcd759de` |
| SQL DB Contributor | `9b7fa17d-e63e-47b0-bb0a-15c516ac86ec` |
| Virtual Machine Contributor | `9980e02c-c2be-4d73-94e8-173b1dc7cf3c` |
| Virtual Machine User Login | `fb879df8-f326-4884-b1cf-06f3ad86be52` |
| Website Contributor | `de139f84-1756-47ae-9be6-808fbbe84772` |
| Function App Contributor | `3e64d096-66a3-4814-bb11-63a14e7a1f4d` |
| App Service Contributor | `f49aa87f-1c44-4c25-9b3e-e75da5f31b6f` |
| Reader | `acdd72a7-3385-48ef-bd42-f606fba81ae7` |
| Contributor | `b24988ac-6180-42a0-ab88-20f7382dd24c` |

**Subscription IDs per environment** (needed to construct ARM IDs):
| Environment | Subscription ID |
|---|---|
| `devsand` | `00000000-0000-0000-0000-000000000001` |
| `sand` | `00000000-0000-0000-0000-000000000002` |

---

## Background: Current flux-config Architecture

Before making any changes, **read and understand** the following files:

1. `.github/workflows/generate-webapp-config.yaml` — workflow for deploying web apps
2. `.github/workflows/generate-agent-config.yaml` — workflow for deploying ADO agents
3. `.template/webapp/` — Jinja2 templates: `kustomization.yaml`, `namespace.yaml`,
   `helmrelease.yaml` (examine all three)
4. `.template/agent/` — equivalent agent templates
5. `infrastructure/flux-system/` — how Flux Kustomization CRDs are structured and registered
6. Any existing ASO resource manifests anywhere in the repo — to understand the pattern
   already in use (CRD apiVersion in use, naming conventions, annotation patterns)
7. The cluster-config ConfigMap structure referenced by `postBuild.substituteFrom` in existing
   HelmRelease resources — to understand what `${CLUSTER_*}` variables are available

Key facts about the current architecture:
- Jinja2 templates are rendered by the workflow into `clusters/{envname}/{cluster-name}/apps/{appname}/`
- The workflow then creates/updates a Flux Kustomization CRD in `infrastructure/flux-system/`
  and registers it in the flux-system kustomization index
- A PR is opened against main; Flux reconciles after merge
- The helm chart `helm/app-workload-deployment` **always** creates:
  - `{appname}-uami` — User Assigned Managed Identity in Azure
  - `{appname}-uami-federated` — Federated Identity Credential (links UAMI to AKS OIDC issuer)
  - `{appname}-sa` — Kubernetes ServiceAccount annotated with the UAMI client ID
  - `{appname}-rg-1` — Resource Group scoped to the app
- The UAMI is created by the helm chart at **Flux reconciliation time**, not during the
  GitHub Actions workflow run. This is the critical timing constraint — the UAMI's
  `principalId` is NOT available when the GitHub workflow runs.

---

## Critical Timing Problem and Solution

Because the UAMI does not exist when the workflow renders templates, you CANNOT look up the
`principalId` in the GitHub Actions workflow step. The solution is:

**Use a second Flux Kustomization with `dependsOn`.**

1. The existing Flux Kustomization (`{appname}`) reconciles the app directory (namespace,
   helmrelease). This creates the UAMI.
2. A NEW Flux Kustomization (`{appname}-rbac`) reconciles a separate `rbac/` subdirectory
   containing the ASO `RoleAssignment` manifests. It declares `dependsOn: [{name: {appname}}]`
   so Flux guarantees the first Kustomization (and thus the UAMI) is fully reconciled before
   attempting the role assignments.

The app directory structure becomes:
```
clusters/{envname}/{cluster}/apps/{appname}/
  kustomization.yaml        (existing — resources: namespace.yaml, helmrelease.yaml)
  namespace.yaml            (existing)
  helmrelease.yaml          (existing)
  rbac/
    kustomization.yaml      (NEW — resources: list of roleassignment-*.yaml files)
    roleassignment-{resourceName}-{index}.yaml   (NEW — one per grant)
```

The Flux Kustomization CRD for `{appname}-rbac` is created/updated alongside the existing
`{appname}` one, registered in the same flux-system kustomization index.

---

## ASO RoleAssignment CRD Structure

Examine the ASO version installed on the cluster to confirm the exact apiVersion. It is likely
one of:
- `authorization.azure.com/v1api20200801preview`
- `authorization.azure.com/v1beta20200801preview`
- `authorization.azure.com/v1api20220401`

A `RoleAssignment` resource grants `{principalId}` the role `{roleGuid}` on target resource
`{targetArmId}`:

```yaml
apiVersion: authorization.azure.com/v1api20200801preview   # confirm actual version
kind: RoleAssignment
metadata:
  name: {appname}-{resourceName}-{index}    # must be globally unique in the namespace
  namespace: {appname}
  annotations:
    serviceoperator.azure.com/reconcile-policy: detach-on-delete
spec:
  owner:
    armId: {full-arm-id-of-target-resource}
  principalId: {uami-principal-id}
  principalType: ServicePrincipal
  roleDefinitionReference:
    armId: /subscriptions/{subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/{roleGuid}
```

**Constructing `owner.armId` (target resource):**
In the GitHub Actions workflow, BEFORE rendering templates, resolve each grant's target ARM ID
using az CLI:
```bash
az resource list \
  --name "{resourceName}" \
  --resource-type "Microsoft.KeyVault/vaults" \
  --subscription "{subscriptionId}" \
  --query "[0].id" \
  --output tsv
```
Use the `resourceType` → ARM type mapping table above to build the `--resource-type` argument.
Pass the resolved ARM IDs into the Jinja2 template context (add a `resolvedArmId` field to
each grant object before rendering).

**Resolving `principalId` (the UAMI's object ID):**
First, check whether the helm chart creates the UAMI as an ASO `UserAssignedIdentity` resource.
If so, you may be able to use an ASO cross-resource reference in `principalIdFromIdentityRef`.

If the UAMI is NOT an ASO resource, use the following approach: In the workflow, attempt
`az identity show --name "{appname}-uami" --resource-group "{appname}-rg-1"
--subscription {subscriptionId} --query principalId --output tsv`. If the UAMI already
exists (re-deployment / allow_update=true), use its principalId directly. If it does NOT
exist yet (first deployment), set `principalId` to an empty string placeholder and rely on
the `dependsOn` ordering — ASO will retry the RoleAssignment until the principalId becomes
valid, OR use a Kubernetes `Secret` or `ConfigMap` written by a post-sync hook.

The **recommended and simplest approach** if the UAMI is not yet an ASO resource:
Check at workflow time whether the UAMI exists:
- If YES (allow_update=true, re-deploy): resolve principalId and write it into the manifest.
- If NO (first deploy): write the manifest with a known-invalid placeholder and add a
  Flux `postBuild` patch or use ASO's `UserAssignedIdentity` reference if available.
  Alternatively, convert the UAMI creation itself to an ASO manifest so ASO manages both
  the identity and the role assignments in dependency order.

**Whichever approach you choose, document your reasoning clearly in a comment in the
generated manifest and in the workflow step.**

---

## Exact Changes Required

### 1. `.github/workflows/generate-webapp-config.yaml`

**a. Add `workload_identity_grants` to `workflow_dispatch.inputs`:**
```yaml
workload_identity_grants:
  description: >
    Optional JSON array of external resource access grants.
    Each object: {"resourceType": "security|storage|ai|servicebus|appconfiguration|database|compute|web|eventgrid",
    "resourceName": "azure-resource-name", "role": "Azure Role Display Name"}
  required: false
  default: '[]'
```

**b. Add a validation step** (after existing kv_secrets validation, same pattern):
```yaml
- name: Validate workload identity grants
  if: inputs.workload_identity_grants != '[]'
  run: |
    python3 - <<'EOF'
    import json, sys
    raw = '''${{ inputs.workload_identity_grants }}'''
    try:
        grants = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: workload_identity_grants is not valid JSON: {e}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(grants, list):
        print("ERROR: workload_identity_grants must be a JSON array", file=sys.stderr)
        sys.exit(1)
    required = {'resourceType', 'resourceName', 'role'}
    valid_types = {'security','storage','ai','servicebus','appconfiguration','database','compute','web','eventgrid'}
    for i, g in enumerate(grants):
        missing = required - set(g.keys())
        if missing:
            print(f"ERROR: grant[{i}] missing fields: {missing}", file=sys.stderr)
            sys.exit(1)
        if not all(g[k] for k in required):
            print(f"ERROR: grant[{i}] has empty field values", file=sys.stderr)
            sys.exit(1)
        if g['resourceType'] not in valid_types:
            print(f"ERROR: grant[{i}] unknown resourceType '{g['resourceType']}'", file=sys.stderr)
            sys.exit(1)
    print(f"OK: {len(grants)} grant(s) validated")
    EOF
```

**c. Add a step to resolve ARM IDs and UAMI principal ID** (after validation, before template rendering):
```yaml
- name: Resolve workload identity grant ARM IDs
  if: inputs.workload_identity_grants != '[]'
  id: resolve_grants
  run: |
    python3 - <<'EOF'
    import json, subprocess, sys

    SUBSCRIPTION_MAP = {
        'devsand': '00000000-0000-0000-0000-000000000001',
        'sand':    '00000000-0000-0000-0000-000000000002',
    }
    ARM_TYPE_MAP = {
        'security':         'Microsoft.KeyVault/vaults',
        'storage':          'Microsoft.Storage/storageAccounts',
        'ai':               'Microsoft.CognitiveServices/accounts',
        'servicebus':       'Microsoft.ServiceBus/namespaces',
        'appconfiguration': 'Microsoft.AppConfiguration/configurationStores',
        'database':         'Microsoft.Sql/servers',
        'compute':          'Microsoft.Compute/virtualMachines',
        'web':              'Microsoft.Web/sites',
        'eventgrid':        'Microsoft.EventGrid/topics',
    }
    ROLE_GUID_MAP = {
        'Key Vault Secrets User':              '4633458b-17de-408a-b874-0445c86b69e6',
        'Key Vault Certificates Officer':      'a4417e6f-fecd-4de8-b567-7b0420556985',
        'Storage Blob Data Contributor':       'ba92f5b4-2d11-453d-a403-e96b0029c9fe',
        'Storage Blob Data Reader':            '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1',
        'Storage Queue Data Contributor':      '974c5e8b-45b9-4653-ba55-5f855dd0fb88',
        'Storage Account Contributor':         '17d1049b-9a84-46fb-8f53-869881c3d3ab',
        'Azure AI Developer':                  '64702f94-c441-49e6-a78b-ef80e0188fee',
        'Azure AI User':                       '53ca6127-db72-4b80-b1b0-d745d6d5456d',
        'Cognitive Services OpenAI Contributor': 'a001fd3d-188f-4b5d-821b-7da978bf7442',
        'Cognitive Services OpenAI User':      '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd',
        'Cognitive Services Contributor':      '25fbc0a9-bd7c-42a3-aa1a-3b75d497ee68',
        'App Configuration Data Reader':       '516239f1-63e1-4d78-a4de-a74fb236a071',
        'Azure Service Bus Data Sender':       '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39',
        'Azure Service Bus Data Receiver':     '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0',
        'EventGrid EventSubscription Reader':  '2414bbcf-6497-4faf-8c65-045460748405',
        'EventGrid EventSubscription Contributor': '1e241071-0855-49ea-94dc-649edcd759de',
        'SQL DB Contributor':                  '9b7fa17d-e63e-47b0-bb0a-15c516ac86ec',
        'Virtual Machine Contributor':         '9980e02c-c2be-4d73-94e8-173b1dc7cf3c',
        'Virtual Machine User Login':          'fb879df8-f326-4884-b1cf-06f3ad86be52',
        'Website Contributor':                 'de139f84-1756-47ae-9be6-808fbbe84772',
        'Function App Contributor':            '3e64d096-66a3-4814-bb11-63a14e7a1f4d',
        'App Service Contributor':             'f49aa87f-1c44-4c25-9b3e-e75da5f31b6f',
    }

    envname   = '${{ inputs.envname }}'
    appname   = '${{ inputs.appname }}'
    grants    = json.loads('''${{ inputs.workload_identity_grants }}''')
    sub_id    = SUBSCRIPTION_MAP.get(envname)

    if not sub_id:
        print(f"ERROR: unknown environment '{envname}'", file=sys.stderr)
        sys.exit(1)

    resolved = []
    for i, g in enumerate(grants):
        arm_type = ARM_TYPE_MAP[g['resourceType']]
        role_guid = ROLE_GUID_MAP.get(g['role'])
        if not role_guid:
            print(f"ERROR: unknown role '{g['role']}'", file=sys.stderr)
            sys.exit(1)

        # Resolve the target resource ARM ID
        result = subprocess.run([
            'az', 'resource', 'list',
            '--name', g['resourceName'],
            '--resource-type', arm_type,
            '--subscription', sub_id,
            '--query', '[0].id',
            '--output', 'tsv'
        ], capture_output=True, text=True)
        arm_id = result.stdout.strip()
        if not arm_id:
            print(f"ERROR: could not resolve ARM ID for {g['resourceType']}/{g['resourceName']} "
                  f"in subscription {sub_id}", file=sys.stderr)
            sys.exit(1)

        resolved.append({
            **g,
            'resolvedArmId': arm_id,
            'roleGuid': role_guid,
            'subscriptionId': sub_id,
            'index': i,
        })
        print(f"  Resolved grant[{i}]: {g['role']} on {arm_id}")

    # Try to resolve UAMI principal ID (exists on re-deployments, not on first deploy)
    uami_result = subprocess.run([
        'az', 'identity', 'show',
        '--name', f'{appname}-uami',
        '--resource-group', f'{appname}-rg-1',
        '--subscription', sub_id,
        '--query', 'principalId',
        '--output', 'tsv'
    ], capture_output=True, text=True)
    uami_principal_id = uami_result.stdout.strip()
    if uami_principal_id:
        print(f"  UAMI principal ID resolved: {uami_principal_id} (re-deployment)")
    else:
        print("  UAMI not yet created (first deployment) — RoleAssignment will be created "
              "with empty principalId; ASO will retry once UAMI is reconciled by dependsOn Kustomization")

    output = json.dumps({'grants': resolved, 'uamiPrincipalId': uami_principal_id})
    # Write to GITHUB_OUTPUT for use in next step
    with open('${{ runner.temp }}/resolved_grants.json', 'w') as f:
        f.write(output)
    print(f"\nResolved {len(resolved)} grant(s). Written to resolved_grants.json")
    EOF
```

**d. Pass resolved grants to the Jinja2 rendering step:**
In the existing template rendering step (wherever `jinja2` is invoked or the template context
is built), add `workload_identity_grants` and `uami_principal_id` to the context:
```python
import json
resolved_data = json.load(open('${{ runner.temp }}/resolved_grants.json'))
context['workload_identity_grants'] = resolved_data['grants']   # list of resolved grant dicts
context['uami_principal_id'] = resolved_data.get('uamiPrincipalId', '')
```

**e. Add a step to create/update the `{appname}-rbac` Flux Kustomization CRD** (after the
existing step that creates the `{appname}` Kustomization CRD):

This step should only run when `workload_identity_grants != '[]'`. It renders the rbac
Flux Kustomization CRD using the same pattern as the existing app Kustomization CRD, but
with:
- `name: {appname}-rbac`
- `path: ./clusters/{envname}/{cluster}/apps/{appname}/rbac`
- `dependsOn: [{name: {appname}}]`
- Register it in the flux-system kustomization index (same as the existing CRD)

### 2. `.github/workflows/generate-agent-config.yaml`

Apply the **exact same changes** as above (steps a through e). Agents also get a UAMI from
the helm chart and may need external resource access. The inputs, validation, resolution
logic, and template rendering additions are identical.

### 3. `.template/webapp/` — New Jinja2 templates for the rbac subdirectory

Create two new Jinja2 template files rendered only when `workload_identity_grants` is
non-empty:

**`.template/webapp/rbac/kustomization.yaml.j2`**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
{% for grant in workload_identity_grants %}
  - roleassignment-{{ grant.resourceName | lower | replace('_', '-') }}-{{ grant.index }}.yaml
{% endfor %}
```

**`.template/webapp/rbac/roleassignment.yaml.j2`** (rendered once per grant, output filename
per grant):
```yaml
# Role assignment: {{ appname }}-uami → {{ grant.role }} → {{ grant.resourceName }}
# Created by self-service portal. Do not edit manually.
apiVersion: authorization.azure.com/v1api20200801preview   # adjust to actual installed version
kind: RoleAssignment
metadata:
  # Name must be unique within the namespace. Use a deterministic hash or slug.
  name: {{ appname }}-{{ grant.resourceName | lower | replace('_', '-') }}-{{ grant.index }}
  namespace: {{ namespace }}
  annotations:
    # detach-on-delete: ASO removes the k8s object but does NOT delete the Azure role assignment.
    # This is intentional — manual cleanup prevents accidental access removal on redeploy.
    serviceoperator.azure.com/reconcile-policy: detach-on-delete
spec:
  owner:
    # Full ARM ID of the target Azure resource, resolved at workflow time.
    armId: {{ grant.resolvedArmId }}
  {% if uami_principal_id %}
  principalId: {{ uami_principal_id }}
  {% else %}
  # FIRST DEPLOYMENT: UAMI does not exist yet. This Kustomization depends on the app
  # Kustomization (via dependsOn), so by the time Flux reconciles this file the UAMI
  # will already have been created. However, ASO needs the principalId to be set.
  # The workflow will patch this on the next sync, or use the approach below if ASO
  # supports UserAssignedIdentity reference (check installed ASO CRDs for principalIdFromIdentityRef).
  # TODO: On first deploy, patch after UAMI creation or use ASO identity reference.
  principalId: ""   # Will be patched on next workflow run or by post-sync mechanism
  {% endif %}
  principalType: ServicePrincipal
  roleDefinitionReference:
    # Built-in role definition ARM ID (subscription-agnostic path also accepted by ASO)
    armId: /subscriptions/{{ grant.subscriptionId }}/providers/Microsoft.Authorization/roleDefinitions/{{ grant.roleGuid }}
```

**IMPORTANT — First Deployment principalId handling:**
Before writing the empty `principalId: ""` placeholder, first check whether the ASO version
installed on the cluster supports `principalIdFromIdentityRef` (referencing a
`UserAssignedIdentity` object by name). If it does, use that instead:
```yaml
spec:
  owner:
    armId: {{ grant.resolvedArmId }}
  principalIdFromIdentityRef:
    group: managedidentity.azure.com
    kind: UserAssignedIdentity
    name: {{ appname }}-uami
    namespace: {{ namespace }}
  principalType: ServicePrincipal
  roleDefinitionReference:
    armId: /subscriptions/{{ grant.subscriptionId }}/providers/Microsoft.Authorization/roleDefinitions/{{ grant.roleGuid }}
```
If `principalIdFromIdentityRef` is supported, use it unconditionally (it works for both
first deploys and re-deploys, and you don't need the `uami_principal_id` resolution step
at all for the manifest content — though the resolution step can remain for logging).

### 4. `.template/agent/rbac/` — Mirror the webapp templates

Create the same `kustomization.yaml.j2` and `roleassignment.yaml.j2` in `.template/agent/rbac/`.
The content is identical — agents get the same UAMI chain as web apps.

### 5. Flux Kustomization CRD for `{appname}-rbac`

In `infrastructure/flux-system/`, add a new Jinja2 template (or extend the existing workflow
step that generates the app Kustomization CRD) to produce a second CRD:

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: {{ appname }}-rbac
  namespace: flux-system
spec:
  interval: 10m
  path: ./clusters/{{ envname }}/{{ cluster_name }}/apps/{{ appname }}/rbac
  prune: true
  sourceRef:
    kind: GitRepository
    name: flux-system
  dependsOn:
    - name: {{ appname }}    # Wait for main app Kustomization (creates the UAMI) first
  postBuild:
    substituteFrom:
      - kind: ConfigMap
        name: cluster-config   # Same cluster-config substitution as the app Kustomization
```

Register this CRD in the flux-system kustomization index file (same as the existing app CRD).
Only render and register it when `workload_identity_grants` is non-empty.

---

## Files to Read First (Exploration Checklist)

Before writing a single line of new code, read these files to understand conventions:

- [ ] `.github/workflows/generate-webapp-config.yaml` — full file
- [ ] `.github/workflows/generate-agent-config.yaml` — full file
- [ ] `.template/webapp/helmrelease.yaml` (or `.j2`) — understand how Jinja2 context vars are used
- [ ] `.template/webapp/kustomization.yaml` (or `.j2`) — resource list format
- [ ] `infrastructure/flux-system/` — examine all files; understand how Kustomization CRDs are
  structured and how the kustomization index is maintained
- [ ] Any `*roleassignment*` or `*authorization.azure.com*` files in the repo — existing ASO usage
- [ ] Any `*managedidentity.azure.com*` or `*UserAssignedIdentity*` files — to determine if the
  helm chart uses ASO for the UAMI (critical for choosing the principalId strategy)
- [ ] `selfserve-metadata/` — understand the metadata schema to see if grants should be recorded

---

## Naming Conventions to Follow

Observe the existing naming patterns in the repo for:
- Branch names (auto/gen-{env}-{appname})
- PR titles and body format
- Flux Kustomization CRD names and metadata
- File output paths
- Jinja2 variable names (snake_case vs camelCase)
- Kubernetes resource naming (lowercase, hyphens only)

The `roleassignment` manifest name must be a valid Kubernetes name: lowercase alphanumeric
and hyphens, max 253 characters. Use:
`{{ appname }}-{{ grant.resourceName | lower | regex_replace('[^a-z0-9]', '-') }}-{{ grant.index }}`

---

## Metadata Update

The workflow writes a JSON file to `selfserve-metadata/` tracking all deployment parameters.
Add `workload_identity_grants` to this metadata record so it appears in the deployment history.
Follow the exact same pattern used for `kv_secrets` in the existing metadata generation step.

---

## PR Description Update

The PR body generated by `peter-evans/create-pull-request` should include a section for
workload identity grants when they are present. After the existing deployment details, add:

```markdown
### External Resource Access (Workload Identity Grants)

| Resource Type | Resource Name | Role |
|---|---|---|
{% for grant in workload_identity_grants %}
| {{ grant.resourceType }} | `{{ grant.resourceName }}` | {{ grant.role }} |
{% endfor %}

The app's managed identity `{{ appname }}-uami` will be granted the above roles.
```

---

## What NOT to Change

- Do not modify the helm chart (`helm/app-workload-deployment`). The UAMI, Federated
  Credential, and ServiceAccount provisioning already works correctly. We are only adding
  RBAC assignments on top.
- Do not change the existing `externalSecret_enabled` / `kv_secrets` flow. That handles
  the cluster-managed Key Vault. `workload_identity_grants` is for external resources only.
- Do not change the existing kustomization.yaml, namespace.yaml, or helmrelease.yaml
  templates. Add new files to a new `rbac/` subdirectory only.
- If `workload_identity_grants` is `'[]'` or absent, the workflow must behave exactly
  as before — no `rbac/` directory created, no extra Kustomization CRD, backward compatible.

---

## Verification Checklist

After implementation, verify:

1. A workflow dispatch with `workload_identity_grants: '[]'` (or absent) produces identical
   output to the current workflow — no new files, no new Kustomization CRDs.

2. A workflow dispatch with:
   ```json
   [{"resourceType":"security","resourceName":"my-test-kv","role":"Key Vault Secrets User"}]
   ```
   produces:
   - `clusters/{env}/{cluster}/apps/{appname}/rbac/kustomization.yaml`
   - `clusters/{env}/{cluster}/apps/{appname}/rbac/roleassignment-my-test-kv-0.yaml`
   - A Flux Kustomization CRD `{appname}-rbac` in `infrastructure/flux-system/` with
     `dependsOn: [{name: {appname}}]`
   - The metadata JSON includes the grants
   - The PR body includes the grants table

3. The `roleassignment-*.yaml` file has:
   - Correct `owner.armId` (full ARM ID of `my-test-kv`, not just the name)
   - Correct `roleDefinitionReference.armId` containing `4633458b-17de-408a-b874-0445c86b69e6`
   - `principalType: ServicePrincipal`
   - `serviceoperator.azure.com/reconcile-policy: detach-on-delete` annotation

4. Validation step rejects:
   - Invalid JSON
   - Unknown `resourceType` values
   - Missing required fields
   - A resource name that cannot be found in the subscription (az resource list returns empty)

5. The agent workflow (`generate-agent-config.yaml`) has the same changes as the webapp workflow.
