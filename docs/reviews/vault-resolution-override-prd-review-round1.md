# PRD Challenger Review: vault-resolution-override (Round 1)
Date: 2026-08-12
PRD: docs/prd/vault-resolution-override.md

## Verdict
changes_requested

## Blocking Findings

- [ ] **Override sidecar repo location is not pinned relative to `target`, and the primary motivating cases resolve under `target='live'` against a *different* repo than FR-001 names.**
  Reference: FR-001, FR-002 (AC1-AC4), Section 8 "Data contracts".
  Evidence: `services/secretsService.js` `mapRepo(target)` (line ~24) returns `config.github.serviceRepo`
  (`organization/service-catalog`) for `target='sand'` and `config.github.infrastructureLiveRepo`
  (`organization/infrastructure-live`) for `target='live'` — two different GitHub repos
  ([config.js](../../config.js) lines 120/123). The roadmap's own validated probe for the PRD's
  headline use cases (IDM, `exampleApplications`, implicitly `azureDatabricks`) explicitly calls
  `resolveKeyVaults('exampleApplications', 'dev', 'live', ...)` — i.e. these vaults are discovered
  against `infrastructure-live`, not `service-catalog`. FR-001 states the override sidecar lives
  "in the service-catalog repo," but no FR specifies whether `loadVaultOverrides()` / the write
  endpoint use a fixed repo constant (`config.github.serviceRepo`) regardless of `target`, or
  whether they reuse `mapRepo(target)` like every other function in the file (`resolveKeyVaults`,
  `getSecretsList`, `submitSecretViaGitOps` all call it). If an implementer follows the file's
  existing convention and calls `mapRepo(target)` for the override read/write, overrides written
  while resolving a `target='live'` vault would go to `infrastructure-live`, while FR-001 pins the
  file to `service-catalog` — the override would then never be found on read, silently breaking
  the feature for exactly the IDM/exampleApplications/azureDatabricks cases this PRD exists to fix.
  **Fix**: add an explicit acceptance criterion to FR-002/FR-003 stating the sidecar read/write
  always targets `config.github.serviceRepo` regardless of the `target` parameter passed to
  `resolveKeyVaults()`/the override endpoint (a single central override store, independent of which
  repo a vault was discovered in), and add a regression test that sets an override for a
  `target='live'`-discovered `vaultDir` and confirms it round-trips through the fixed repo.

- [ ] **FR-003 has no acceptance criterion validating that the submitted `vaultDir` corresponds to a real, currently-resolvable vault**, unlike the codebase's own established convention for the same kind of input.
  Reference: FR-003 (AC1-AC6), NFR-003.
  Evidence: `submitSecretViaGitOps` in the same file explicitly allow-lists client-supplied
  `vaultDir` against the live `resolveKeyVaults()` result before using it to construct a repo path
  ("FR-002(l): vaultDir must be allow-list validated against the live resolveKeyVaults() result
  BEFORE it is used to construct any repo path — never trust client input directly," `services/secretsService.js`
  around line 620). `POST /api/secrets/vault-name-override`'s FR-003 acceptance criteria only cover
  auth, field validation regex, sha-conflict handling, overwrite-on-repeat, logging, and response
  shape — none require confirming `vaultDir` (plus `appName`/`environment`/`qualifier`) actually
  matches a vault path `resolveKeyVaults()`/`matchVaultsFromEntries` can discover today. Without
  this, any authenticated user can write an override entry for an arbitrary, fabricated `vaultDir`
  string, either bloating the sidecar with garbage with no cleanup path, or — worse — pre-emptively
  planting a stale/wrong name for a path that becomes a real vault later, with no server-side sanity
  check at write time.
  **Fix**: add an FR-003 acceptance criterion requiring the endpoint to call
  `resolveKeyVaults(appName, environment, target, correlationId, qualifier)` (or
  `matchVaultsFromEntries`) and reject the write (4xx, with `correlationId`) if the submitted
  `vaultDir` is not among the vaults it discovers — mirroring the existing `submitSecretViaGitOps`
  convention rather than introducing a second, weaker input-trust model for the same field.

- [ ] **FR-005's `metadata` parameter is never wired to a real data source, and the PRD is silent on whether that wiring is in scope**, which makes FR-005 AC3/AC5 and the FR-007 AC2 test ambiguous to implement.
  Reference: FR-005 (AC3, AC5), FR-007 (AC2), Non-Goals ("Metadata write-back... out of scope").
  Evidence: `infrastructureService.getApplicationDetails()` exists
  ([services/infrastructureService.js](../../services/infrastructureService.js) line 625) but
  `secretsService.js` currently only calls `infrastructureService.getInstalledApps()` (line 399) —
  it never calls `getApplicationDetails()` today. FR-005 introduces
  `resolveVaultNameWithFallback(vaultEntry, overrides, metadata)` and requires `resolveKeyVaults()`
  to use it as "the single resolution call site," with AC3 describing a "missing/absent
  `metadata.keyvaults` array" as a no-op, and AC5 asserting "no behavior change for vaults that have
  neither an override nor metadata entry" — both of which imply `resolveKeyVaults()` is aware of
  metadata's presence or absence per call. But the PRD's own Non-Goals explicitly excludes the CI
  write-back that would ever populate `metadata.keyvaults[]` (Phase B), and no FR states whether
  `resolveKeyVaults()` (a) calls `infrastructureService.getApplicationDetails()` per resolution and
  passes the result through (new, unscoped work: an extra per-app GitHub-backed call, with its own
  caching/error-handling questions not covered by NFR-001, which only budgets for the override
  sidecar), or (b) always passes `metadata: undefined`/`{}`, making the metadata tier permanently
  inert scaffolding in this PRD. FR-007 AC2 requires a test proving "a metadata `keyvaults[]` entry
  matching `vaultDir`... short-circuits the resolver," but if `resolveKeyVaults()` never actually
  fetches metadata, that behavior can only ever be exercised by calling the helper directly, not
  through the code path FR-005 claims to wire it into.
  **Fix**: add an explicit FR-005 acceptance criterion picking one of the two options above. If (b),
  state directly that `resolveKeyVaults()` passes `metadata` as `undefined` in this PRD's scope (the
  tier exists only as a pass-through slot for Phase B) and reword FR-007 AC2 to test the helper
  function in isolation, not `resolveKeyVaults()`'s wired behavior. If (a), add the
  `getApplicationDetails()` call as its own acceptance criterion with a stated caching approach and
  fold its cost into NFR-001.

- [ ] **The machine-readable `ORCHESTRATOR-READY` block declares `status: approved` while Section 1's
  own `Status` field says "draft (pending PRD Challenger review)."**
  Reference: Section 1 ("Status: draft (pending PRD Challenger review)") vs. the trailing
  `<!-- ORCHESTRATOR-READY ... status: approved -->` block.
  Evidence: read directly from `docs/prd/vault-resolution-override.md` (Section 1 line 6; final
  HTML comment block). This is the same self-declared-approval pattern flagged in this repo's PRD
  Challenger memory for `secret-self-service` — a PRD must never mark itself `approved` in the
  machine-readable block before a Challenger round has actually produced that verdict, since an
  Orchestrator that parses the trailing block instead of the prose could route straight to the
  Architect Agent, skipping this review entirely.
  **Fix**: PM Agent should set `status: draft` (or omit the field) in the `ORCHESTRATOR-READY` block
  until a PRD Challenger round actually returns `approved`; the Orchestrator should treat this
  Round 1 review's verdict, not the PRD's self-reported block, as authoritative regardless.

## Advisory Findings
- NFR-005's phrasing "≤ 2 user actions (open inline form, submit)" implies the inline form starts
  collapsed/hidden, but FR-004 AC1 says the control "appears" whenever `vaultName` is `null` (no
  mention of an open/expand step). Align the two — either FR-004 gains an explicit "collapsed by
  default" AC, or NFR-005 drops "open inline form" as a counted action.
- FR-002 AC3 and FR-005 both describe "override checked before the live resolver is invoked" as the
  wiring point inside `resolveKeyVaults()`. Consider having FR-002 defer entirely to FR-005 for the
  wiring description (FR-002 stays scoped to `loadVaultOverrides()` + caching) to avoid two FRs
  each partially owning the same call-site change.
- Section 10's framing that the override endpoint is "a display correction, not a security-sensitive
  write" is accurate and verifiable (`submitSecretViaGitOps` keys all actual secret writes off
  `vaultDir`, never `vaultName`/`resourceGroup`), but the PRD doesn't show this reasoning — worth
  citing the `vaultDir`-vs-`vaultName` distinction explicitly in Section 10 so a future reviewer
  doesn't have to re-derive it from the code.
- `resourceGroup` overrides could still mislead a user's "view in Azure Portal" navigation to the
  wrong resource group (per `config.js`'s stated use of resource group for portal-link
  construction) even though it can't corrupt an actual secret write. Not a blocker given Azure RBAC
  still gates the portal, but worth a one-line callout alongside the existing `vaultName` risk note.

## Round Context
N/A (Round 1).

<!-- CHALLENGER-VERDICT
feature: vault-resolution-override
round: 1
verdict: changes_requested
blocking_count: 4
advisory_count: 4
-->
