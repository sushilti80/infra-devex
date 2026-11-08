# Plan: Layered Key Vault name resolution (resolver hop/ternary extension + self-heal override)

> Status: Phase A + C shipped (`vault-resolution-override`, PR #89). Phase B (CI terraform-apply
> metadata write-back) rejected 2026-08-12 — replaced by extending `terragruntLocalsResolver`
> itself (multi-hop alias + ternary + `lookup()` support), **shipped and live-verified 2026-08-12**
> against all `exampleApplications` environments. Phase D (application selector qualifiers) is
> spec-approved as its own feature (`secrets-app-selector-qualifiers`), not yet implemented.

## TL;DR
Replace "always live-parse HCL, hope it resolves" with a 2-tier resolution chain, checked in
this order by `secretsService.resolveKeyVaults()`:
1. **Manual override sidecar** (`docs/overrides/keyvault-overrides.json`, service-catalog repo) — human-verified truth, always wins. **Shipped** (`vault-resolution-override`, PR #89).
2. **Live `terragruntLocalsResolver`**, extended to follow up to 3 alias hops and evaluate
   `contains([...]) ? A : B` / `EXPR == "literal"` ternary/conditional expressions plus
   `lookup(map, key, default)` — no longer a frozen last resort. **Shipped and live-verified**
   against all 11 `exampleApplications` environments + all 3 `shared/*` vaults.

If both miss, the Secrets page shows the existing "Key Vault name unavailable" text plus a
"Set name manually" affordance that writes into tier 1 — turning every remaining gap into a
one-time fix instead of a recurring dead end.

**Rejected 2026-08-12: CI terraform-apply metadata write-back** (formerly "Phase B" / "tier 2
metadata field"). `resolveVaultNameWithFallback()` already shipped with `metadata` as a dormant
pass-through parameter (always called with `metadata: undefined`) — that slot stays in code for
optionality, but building out the CI workflow write-back itself is no longer planned. See
"Phase B (revised)" below for the replacement approach.

**Critical scoping fact (confirmed via code read + user decision):** `buildCustomInfrastructure()`
has no qualifier/sub-app concept and never wrote `docs/metadata` directly. IDM's nested sub-apps
(`_idmapplications/notif|autobk|idmprtl|allctmpr`), `azureDatabricks`, and `exampleApplications`'s
`shared` vault are pre-existing infra this platform only *reads*. **Tier 1 (override sidecar)
remains the universal safety net for any expression outside even the extended resolver's
grammar** — the resolver extension's goal is to shrink how often tier 1 needs a manual entry, not
replace it.

## Validated test case: exampleApplications (live probe, 2026-08-12)

To ground this plan in more than the IDM incident, the `exampleApplications` app/qualifier pair was
inspected directly in `organization/infrastructure-live` (default branch `main`, read-only `gh api`,
per the `infrastructure-repo` skill) and then re-run through this app's own
`services/secretsService.resolveKeyVaults('exampleApplications', 'dev', 'live', ..., 'exampleCoreServices')`.

**Repo layout observed:**
- `infrastructure/exampleApplications/exampleCoreServices/keyvaults/<env>/keyvault` — one vault per real
  environment (`dev`, `devsand`, `int`, `prod`, `sand`, `sint`, `stage`, `hot`, `dr`, `demo`, `cint`).
- `infrastructure/exampleApplications/exampleCoreServices/keyvaults/shared/{keyvault,keyvault2,keyvault3}` —
  three environment-agnostic vaults (ADO pipelines, infra certs, QA performance).

**Live probe result (reproducible today):**
```json
{
  "vaultDir": "infrastructure/exampleApplications/exampleCoreServices/keyvaults/dev/keyvault",
  "vaultName": null,          // ← same "name unavailable" failure class as IDM
  "qualifier": "exampleCoreServices"
},
{
  "vaultDir": ".../shared/keyvault",  "vaultName": "example-ado-pipelines-kv-01" },
{ "vaultDir": ".../shared/keyvault2", "vaultName": "example-infra-certs-kv-01" },
{ "vaultDir": ".../shared/keyvault3", "vaultName": "example-qa-performance-kv-01" }
```
The three `shared` vaults resolve fine; the per-environment `dev` vault does not. This confirms the
bug is not IDM-specific — it recurs anywhere a vault name is defined more than one alias-hop away
from the vault's own `terragrunt.hcl`.

**Root cause, now precisely identified (two independent gaps in `terragruntLocalsResolver.js`):**
1. **Single-hop alias ceiling.** `resolveToken()` resolves one `local.ALIAS.locals.NAME` hop by
   loading the aliased file, then re-evaluates that value with
   `nextCtx = { ..., resolveAlias: async () => null }` — hardcoded to refuse any further alias
   lookups. `dev/keyvault/terragrunt.hcl` sets `keyvaultname = local.env.locals.keyvaultname`
   (hop 1, resolves fine), but `env.hcl` in turn sets
   `keyvaultname = local.common_vars.locals.env_key_vault_name` (hop 2, into `common.hcl`) — the
   second hop is structurally impossible with today's code, so it returns `null` before even
   reaching `common.hcl`.
2. **No conditional/ternary support.** Even if hop 2 were supported, `infrastructure/common.hcl`
   defines the value as
   `env_key_vault_name = contains(["shared"], "${local.envName}") ? "example-shared-services-kv-1" : "example-${local.spokeEnv}-kv-${local.region}-${local.kvintsuffix}"`
   — a ternary conditional, which is outside the resolver's documented grammar (literals, local
   refs, interpolation, `substr`, `format`, `basename(dirname(get_terragrunt_dir()))` only, per the
   module's own header comment). This would resolve to `null` regardless of alias depth.
   The `shared` vaults avoid both problems: their `keyvaultname` is a single-hop literal
   interpolation (`"${local.prefix}-ado-pipelines-kv-01"`, with `prefix = "example"` a plain literal in
   `shared/env.hcl`) — no second hop, no conditional.

**Implication for this plan (revised 2026-08-12):** this is now the primary evidence driving the
resolver extension, not the CI write-back approach —
- Tier 1 (override) is confirmed necessary as a universal safety net beyond IDM —
  `exampleApplications`'s per-environment vaults are a second concrete instance, not a hypothetical.
- This exact case (`dev/keyvault` → `env.hcl` → `common.hcl` ternary) is precisely what the
  extended resolver (2-hop alias chasing + ternary evaluation, see "Phase B (revised)") is built
  to solve directly, live, with no CI workflow change and no per-vault manual override entry.
- The earlier "not worth chasing an open-ended HCL grammar" concern is accepted as a real,
  ongoing risk (this only ever covers the grammar observed so far, not all of Terraform's), but is
  judged worth it given how load-bearing tier 1 alone would otherwise have to stay for
  exampleApplications/IDM/Databricks, and because CI write-back needs cross-repo coordination this
  decision explicitly avoids.

## Steps

### Phase A — Override sidecar + self-heal (ships first, needs no external repo changes beyond service-catalog)
*Delivers immediate value for IDM/azureDatabricks/exampleApplications; independent of Phase B. **Shipped.***
1. **Schema**: `docs/overrides/keyvault-overrides.json` in service-catalog repo:
   ```json
   { "overrides": {
       "infrastructure/idm/_idmapplications/notif/dev/keyvault": {
         "name": "idm-notif-dev-kv", "resourceGroup": "rg-idm-notif-dev",
         "appName": "idm", "environment": "dev", "qualifier": "notif",
         "verifiedBy": "user@company.com", "verifiedAt": "2026-08-11T10:00:00Z" }
   } }
   ```
   Key = `vaultDir` (the exact internal identifier `secretsService`/`terragruntLocalsResolver`
   already use — no new derivation logic needed). `appName`/`environment`/`qualifier` are stored
   for auditability/display only, not as key parts.
2. **`services/secretsService.js`**: add `loadVaultOverrides()` (reads + JSON-parses the sidecar via
   `githubService.octokit.rest.repos.getContent()`, same pattern as existing metadata reads; short
   in-process cache, e.g. 60s — file is tiny so staleness risk is low and doesn't need the 5-min
   tree-cache TTL). In `resolveKeyVaults()`, check `overrides[vaultDir]` **before** calling
   `terragruntLocalsResolver.resolveName()`/`resolveResourceGroup()`; if present, use it and skip
   the resolver entirely for that vault.
3. **New endpoint** `POST /api/secrets/vault-name-override` in `routes/api.js`: validate
   `{ vaultDir, name, resourceGroup?, appName, environment, qualifier? }` via `express-validator`;
   read-modify-write the sidecar JSON with the file's current `sha` (optimistic concurrency, same
   shape as other `createOrUpdateFileContents` calls in `githubService.js`); log with
   `req.correlationId`; respond `{ success, data, correlationId }`.
4. **`srcV2/pages/SecretsPage.vue`**: when a vault's `name` is `null`, show the existing
   "Key Vault name unavailable" text plus a small inline "Set name manually" control (name +
   optional resource-group input) that calls the new endpoint, then refetches so the corrected
   value displays immediately. No new component library needed — a small inline form.
5. **Decision needed at implementation time**: is this override endpoint open to any authenticated
   Secrets-page user, or gated further (e.g. only users who already have write access to the
   app/environment)? Recommend: same auth as the rest of the Secrets page (`requireAuth`) — it's a
   display correction, not a security-sensitive write, and the endpoint already requires knowing
   the exact `vaultDir` which isn't user-facing today (would need a small UI change to expose it,
   e.g. as a hidden field carried alongside the vault selector).

### Phase B (revised 2026-08-12) — **Shipped and live-verified** — Extended `terragruntLocalsResolver`: multi-hop alias + ternary + `lookup()` evaluation
*Replaces the CI terraform-apply metadata write-back approach (see rejection note in TL;DR).
Targets `services/terragruntLocalsResolver.js` only — no external repo/workflow changes.*

**Rejected alternative (formerly this section): CI write-back of `terraform output` into
`docs/metadata/<app>-<env>.json`'s `keyvaults[]` array via `self-service-custom-infra.yml`.**
Technically unblocked (both `key_vault_name`/`resource_group_name` Terraform outputs already exist
in `terraform-modules`, confirmed via `gh api` 2026-08-12), but rejected as a strategy: it only
ever helps future platform-provisioned flat apps, requires cross-repo CI-workflow coordination,
and does nothing for the three patterns (IDM sub-apps, `azureDatabricks`, `exampleApplications`) that
actually need it today.

**Additional gap found via live probe (2026-08-12): `exampleApplications`'s `cint`/`sint` environments
still fail even with hop+`contains()`-ternary support**, because `infrastructure/common.hcl`
(`organization/infrastructure-live`) uses two more constructs the original scope didn't cover:
- `envName` itself is computed via an **equality ternary**, not `contains()`:
  `envName = "${basename(dirname(get_original_terragrunt_dir()))}" == "default" ? get_env(...) : ...`.
  The planned `contains([...]) ? A : B` branch alone doesn't cover a bare `X == "literal"` condition.
- `sint`'s `kvintsuffix` resolves through `envcount = lookup(local.envkvcount, "${local.envName}",
  "")` — a `lookup(map, key, default)` function call, not covered by the substr/format/contains
  grammar at all.

1. **Multi-hop alias resolution** (`resolveToken()`'s alias branch in
   `terragruntLocalsResolver.js`): today `nextCtx.resolveAlias` is hardcoded to `async () => null`
   after the first hop. Make it recursive — call `resolveAliasScope(repo, vaultDir,
   aliasScope.locals, nextAliasName, aliasCache)` again so a second `local.ALIAS2.locals.NAME`
   inside the first aliased file's `locals` (e.g. `env.hcl` → `common.hcl`) resolves. Add a
   `MAX_ALIAS_DEPTH = 3` cap (mirrors the existing `MAX_INCLUDE_DEPTH` pattern) and reuse the
   existing `resolving` cycle-guard `Set` so a misconfigured alias loop can't hang.
2. **Conditional evaluation** (`evaluateExpr()`): add a branch, before the "unsupported" fallback,
   that detects `COND ? A : B` (split on the first top-level `?`/`:`, respecting nested
   parens/quotes the same way `splitArgs()` already does for function calls). `COND` must support,
   at minimum:
   - `contains([...], expr)` (the `exampleApplications` `dev`/`prod`/etc. case)
   - bare equality/inequality: `EXPR == "literal"` / `EXPR != "literal"` (needed for `envName`
     itself and the `dr`-alias locals, which every downstream local depends on transitively)
   Then recursively `evaluateExpr()`s whichever branch wins.
3. **`lookup()` map function** (`evaluateFunctionCall()`): add a `lookup` case alongside
   `substr`/`format` — `lookup(mapLocalRef, keyExpr, defaultExpr)`. Requires parsing a `locals`
   map-literal assignment (e.g. `envkvcount = { poc = "2", sint = "3", demo = "1" }`) into a plain
   JS object once, then `map[key] ?? defaultExpr`. Needed for `sint`'s `kvintsuffix` chain.
4. **Scope discipline**: grammar additions are best-effort and additive only — any expression still
   outside the (now larger) supported grammar continues to resolve to `null` and fall through to
   tier 1, per the existing `ponytail` contract at the top of the file. This is NOT a general
   HCL/Terraform evaluator; it only grows to match patterns actually observed in this org's repos.
   Expect more gaps to surface per-environment/per-app as this expands — treat each as a scoped
   addition, not a trigger to build a full expression parser.
5. **Tests**: add cases to `srcV2/services/terragruntLocalsResolver.spec.ts` reproducing:
   - `exampleApplications` `dev/keyvault` → `env.hcl` → `common.hcl` (2-hop + `contains()`-ternary)
   - `exampleApplications` `cint/keyvault` (equality-ternary on `envName`, no `lookup()` needed)
   - `exampleApplications` `sint/keyvault` (equality-ternary + `lookup()` map resolution)
   - a regression test confirming existing single-hop/no-conditional cases are unaffected.
6. **Verification**: after shipping, re-run the live spot-check from this roadmap's Verification
   section against `exampleApplications`'s `dev`, `cint`, and `sint` `keyvault` dirs — all three should
   resolve via tier 2 (live, extended) instead of returning `null`, with no override entries
   required for any of them.

**Shipped 2026-08-12, live-verified against `organization/infrastructure-live`'s
`exampleApplications`/`exampleCoreServices` vaults** — all 11 real environments (`dev`, `devsand`, `int`,
`prod`, `sand`, `sint`, `stage`, `hot`, `dr`, `demo`, `cint`) plus all 3 `shared/*` vaults now
resolve correctly with no override entries. Two additional bugs were found and fixed during live
verification, beyond the originally-scoped `contains()`/equality/`lookup()` grammar work:
- `splitArgs()` only tracked `(`/`)` depth, not `[`/`]` — a multi-item `contains(["poc", "sint",
  "demo"], ...)` list was wrongly split on the commas *inside* the list, breaking any `contains()`
  call with more than one list element. Fixed by making `splitArgs()` bracket- and quote-aware.
- `directoryName` (used by `basename(dirname(get_[original_]terragrunt_dir()))`) was being
  recomputed from the *aliased file's own* location at each hop, instead of staying pinned to the
  *original* vault's directory — this doesn't match Terragrunt's actual semantics (`get_terragrunt_dir()`
  always resolves to the original calling unit, even inside `read_terragrunt_config()`-loaded
  files). Fixed by keeping `ctx.directoryName` constant across all alias hops.
Test coverage: `srcV2/services/terragruntLocalsResolver.spec.ts` gained 3 new cases (2-hop +
`contains()`-ternary, equality-ternary, `lookup()` map resolution) — 8/8 pass; full suite 460/460.

### Phase C — **Shipped** (as part of `vault-resolution-override`, PR #89)
`resolveVaultNameWithFallback(vaultEntry, overrides, metadata)` already exists in
`services/secretsService.js`, returning `{ name, resourceGroup, source: 'override'|'metadata'|
'live'|'unresolved' }`, with a correlationId-prefixed `logger.debug` per vault. `metadata` is
always passed as `undefined` (dormant pass-through slot, per the Phase B rejection above) so the
`'metadata'` source is unreachable today — only `'override'` and `'live'` occur in practice.
**No further consolidation work needed**: Phase B (revised)'s resolver extension slots directly
into the existing `'live'` branch with zero call-site changes.

### Phase D — Application selector: surface nested qualifiers as first-class entries (*parallel track, `SecretsPage.vue` only — no dependency on A/B/C*)
*A UI/discovery-UX fix, distinct from Key Vault **name** resolution: it's about making nested
sub-apps (IDM's `autobk`, `notif`, `idmprtl`, `allctmpr` under `_idmapplications`; the
`exampleCoreServices` qualifier under `exampleApplications`) reachable and correctly scoped in the
Application selector, not about how a vault's name gets resolved once selected.*

**Confirmed gap (code read, 2026-08-12):** `secretsService.js`'s `extractAppEnvPairs()` already
emits fully granular `{ name, environment, qualifier }` tuples — no backend data-model change
needed. The problem is entirely in `SecretsPage.vue`:
```js
const appNames = computed<string[]>(() => Array.from(new Set(apps.value.map(app => app.name))).sort())
```
This throws the `qualifier` away, so the Application `<select>` only ever shows `"idm"` — a nested
sub-app only becomes visible after picking "idm" → picking an environment → the vault resolution
turning out ambiguous → a second "Sub-application" `<select>` appearing. There's no direct path to
"autobk", and `filteredEnvironmentOptions` filters by `app.name` alone, so it shows the **union** of
every sub-app's environments under the root — an environment that only `notif` has (not `autobk`)
still appears as if it applies to "idm" generally.

1. **`appNames`/Application list**: rebuild from `apps.value` keeping `qualifier`, not just `name`.
   Root apps with no qualifier stay flat entries; every distinct `{name, qualifier}` pair becomes
   its own entry (e.g. `idm / autobk`, `idm / notif`).
2. **Rendering**: group with `<optgroup :label="rootName">` per root app, one child `<option>` per
   qualifier — visually nests sub-apps under their root without a separate page/component.
3. **Selection wiring**: choosing `idm / autobk` sets `selectedAppName = 'idm'` **and**
   `selectedQualifier = 'autobk'` immediately (today `selectedQualifier` is only set reactively
   after an ambiguous vault response comes back from `resolveSecretMetadata`).
4. **`filteredEnvironmentOptions` fix**: filter by `app.name === selectedAppName && app.qualifier
   === selectedQualifier` (or `!app.qualifier` for the flat root case) instead of `name` alone —
   this also fixes the environment-leakage bug in point above.
5. The existing `qualifiers.length > 1` "Sub-application" selector stays as a fallback safety net
   only (should rarely trigger once qualifier is chosen up front via the grouped list).
6. No API contract change: `api.getSecrets(appName, environment, target, vaultDir, qualifier)`
   already accepts `qualifier` — this phase just calls it with the value pre-selected instead of
   only after a disambiguation round-trip.
7. Tests: extend `SecretsPage.spec.ts` for the grouped-option rendering, the immediate
   qualifier-set-on-select behavior, and the environment-list scoping fix (an environment unique to
   one qualifier must not appear when another qualifier, or the bare root, is selected).

## Relevant files
- `services/secretsService.js` — `resolveKeyVaults()`, `loadVaultOverrides()`, `resolveVaultNameWithFallback()` tier-check wiring. **Shipped.**
- `routes/api.js` — `POST /api/secrets/vault-name-override` endpoint. **Shipped.**
- `srcV2/pages/SecretsPage.vue`, `srcV2/services/api.ts` — self-heal UI + API call. **Shipped.**
- `services/githubService.js` — reuse existing `createOrUpdateFileContents`/`getContent` patterns for the sidecar file (no new Octokit client needed, same service-catalog repo/app credentials). **Shipped.**
- `docs/overrides/keyvault-overrides.json` (service-catalog repo) — created lazily on first override write. **Shipped.**
- `services/terragruntLocalsResolver.js` — Phase B (revised): `resolveToken()`/`resolveAliasScope()` multi-hop, `evaluateExpr()` ternary branch. **Shipped, live-verified.**
- `srcV2/pages/SecretsPage.vue`, `srcV2/pages/SecretsPage.spec.ts` — Phase D application-selector grouping/scoping fix, tracked as its own feature (`secrets-app-selector-qualifiers`, spec-approved, not yet implemented).

## Verification
1. `npx vitest run --project jsdom srcV2/services/terragruntLocalsResolver.spec.ts` and
   `secretsService` specs — new tier-priority tests pass, existing live-resolver tests unchanged.
2. `npm test` full suite — no regressions.
3. `npm run type-check` — clean.
4. Live spot-check per `infrastructure-repo` skill: after writing a test override entry for
   `infrastructure/idm/_idmapplications/notif/dev/keyvault`, run
   `node -e "const s=require('./services/secretsService'); s.resolveKeyVaults('idm','dev','live','manual-check').then(console.log)"`
   and confirm the override wins over any live-resolver result.
5. Manual E2E: on the Secrets page, trigger an "unavailable" vault, use "Set name manually", confirm
   it persists across a page reload (i.e., actually round-trips through the sidecar file, not just
   local UI state).
6. Once Phase B (revised) ships: re-run the same `resolveKeyVaults('exampleApplications', 'dev',
   'live', 'manual-check', 'exampleCoreServices')` spot-check and confirm `dev/keyvault` now resolves
   with `source: 'live'` (not `null`), with no override entry present for that `vaultDir`.

## Decisions (locked this session, updated 2026-08-12)
- Override sidecar lives at `docs/overrides/keyvault-overrides.json` in service-catalog repo, keyed
  by `vaultDir`, not patched into the per-app `docs/metadata/<app>-<env>.json` file. **Shipped.**
- IDM sub-apps, `azureDatabricks`, and `exampleApplications`'s `shared` vault stay permanently read-only
  (no provisioning-schema changes for qualifier/sub-app requests) — Phase A's override is their
  permanent safety net regardless of how far the resolver extension reaches.
- **2026-08-12: CI terraform-apply metadata write-back (formerly Phase B) rejected.** Requires
  cross-repo coordination (service-catalog workflow edit) for a benefit that only ever applies to
  future platform-provisioned apps. Replaced by extending `terragruntLocalsResolver` directly:
  alias-hop depth raised from 1 to 3, plus `contains([...]) ? A : B` ternary evaluation added.
- Resolution priority remains override > live (a human correction always wins, even over what the
  extended resolver computes, in case a vault is later renamed/recreated outside the platform).
  The `metadata` tier stays a dormant, unused pass-through slot in
  `resolveVaultNameWithFallback()` — not being built out.

## Further Considerations
1. **Override staleness**: if a vault is renamed/recreated after an override is set, the override
   will silently keep serving the old name forever. Recommend: show `verifiedAt` in a
   tooltip/debug view so staleness is at least visible, and let the same "Set name manually"
   affordance overwrite an existing override (not just create new ones). Not building automatic
   staleness detection in this pass — flag if it becomes a real problem.
2. **Auth/permissions on the override endpoint**: recommend reusing existing `requireAuth` (see
   Phase A step 5) rather than adding a new role check, unless you want this restricted further.
3. ~~Phase B's Terraform-output pre-check may reveal the keyvault module needs an output added
   too~~ — resolved 2026-08-12 (outputs already existed), but **moot**: Phase B (CI write-back)
   was itself rejected the same day in favor of the resolver-hop/ternary extension (see
   Decisions). Left here only as a historical record of the investigation.
4. **(Historical, Phase B/CI-write-back-specific, no longer applicable)** Per-directory
   `dependency` alias naming isn't guaranteed uniform. The observed
   `terragrunt.hcl` files all use `dependency "rg" { config_path = "../resourcegroup" }`, but the
   CI step scripting `terragrunt output -json` per keyvault instance should resolve the dependency
   path from the vault's own file rather than hardcoding `../resourcegroup`, since some app layouts
   may differ (e.g. `shared/keyvault2` depends on `../resourcegroup2`).
