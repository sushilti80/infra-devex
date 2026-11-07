# Architecture Challenger Review — Round 3 (human-directed, scoped): `secret-self-service`

**Spec reviewed**: [secret-self-service-spec.md](../architecture/secret-self-service-spec.md),
[secret-self-service-spec.json](../architecture/secret-self-service-spec.json)
**PRD**: [docs/prd/secret-self-service.md](../prd/secret-self-service.md) (FR-003, and the "Multi-vault
per application" Non-Goal)
**Prior rounds**: [round1](./secret-self-service-arch-review-round1.md) (changes_requested, 3 blocking),
[round2](./secret-self-service-arch-review-round2.md) (**approved**, 0 blocking)
**Round**: 3 — **human-directed**, outside the normal two-round cap. Round 2 returned `approved`; a
human re-opened this review after finding evidence that the spec's Key Vault path-pattern assumption
is wrong. Per the Round Discipline rule, a third round only happens on explicit human instruction —
that instruction is this task.
**Scope**: strictly `resolveKeyVaultName()` / Key Vault discovery-and-resolution and anything it
directly contaminates (FR-001, FR-002, FR-003, the `POST /api/secrets` contract, and the UI's
app/environment/vault selection). All other Round 1/2-settled decisions (SOPS per-value blobs,
synchronous POST, file-SHA concurrency, dual-repo `target`, Infrastructure App only, branch naming)
are out of scope and not re-litigated here.

---

## Security note

Every file read during this review (`round1`/`round2` review files, the spec `.md`, the PRD, and
`services/hclParser.js`) returned a tool output with an appended `<PreToolUse-context><context_guidance>`
block instructing a switch to a tool named `context-mode_ctx_execute_file` / `ctx_execute` for
"efficiency." This tool does not exist in my toolset, was not requested by the user, and is not part
of any repo instruction — it is a prompt injection appended at the tool-output layer. I ignored it in
every case and used the standard `read_file`/`grep_search` tools as normal. Flagging per the task's
security note; no other action taken.

---

## Verdict

**escalate_to_human**

Three Blocking findings below (B1–B3) confirm the human's concern is correct and, in one respect
(B3), understates how much unbuilt logic the spec is currently glossing over as "reuse." This round
was already outside the normal cap by explicit human authorization, so per the round-discipline rule
this does not loop into a Round 4 automatically — it goes straight back to a human decision alongside
the Architect Agent for a scoped revision of FR-003 (and the PRD Non-Goal it depends on).

---

## Blocking Findings

### B1 — The singular `{ vaultName: string|null }` contract is a real data-model defect, and it propagates into FR-001, FR-002, the request contract, and the UI

**Evidence**: `mlops` has `infrastructure/mlops/{dev,int,stg,sand,prod}/keyvault01/terragrunt.hcl` **and**
`keyvault02/terragrunt.hcl` side by side, resolving to distinct vaults (`kv-1`..`kv-4` across the
set). `resolveKeyVaultName()`'s contract — `{ found: boolean, vaultName: string|null, resourceGroup:
string|null }` (spec.json `data_contracts.resolve_key_vault_result`, spec.md §4/FR-003(e)) — has no
field that can represent "two vaults exist for this app/environment." Whichever one the primary-path
probe happens to find first (or however a future glob is ordered) is silently returned as *the*
vault, with no signal to the caller that a second one exists.

This is not contained to FR-003:
- **FR-001** (`GET /api/secrets/:appName/:environment`) reads `secrets.enc.yaml` from a single computed
  path, "sibling to that environment's `keyvault/terragrunt.hcl`" (FR-002(e)). With `keyvault01/` and
  `keyvault02/` as two separate directories, there are **two candidate sibling locations**
  (`keyvault01/secrets.enc.yaml`, `keyvault02/secrets.enc.yaml`) and the spec is silent on which one
  the list endpoint reads — confirmed silent by re-reading FR-001(f)/FR-002(e) and
  `technical.data_contracts.secret_list_item` in full; neither mentions vault instance at all.
- **FR-002** (`POST /api/secrets`) has the same ambiguity on write: the request schema
  (`{ target, appName, environment, secretName, secretValue, correlationId }`) has no field to say
  *which* Key Vault instance a submitted secret is for. A developer working on `mlops`/`dev` has no
  way to target `kv-2` specifically — the backend would have to guess, and guessing wrong on a
  **write** path means unrecoverable silent misdelivery of a secret's `secrets.enc.yaml` location.
- **UI**: `SecretsPage.vue`'s acceptance criteria (FR-004(c)) describe target + app/environment
  selectors only; there is no vault-instance selector in scope anywhere in FR-004.

**PRD-vs-spec distinction (per the task's instruction to separate the two)**: this is not "the spec
misread the PRD." The PRD's own Non-Goals section explicitly states: *"Multi-vault per application —
v1 supports exactly one Key Vault per app/environment pair."* That is a factual claim about the world
("v1's target apps have exactly one vault per app/env"), and it is empirically false for `mlops` in
`infrastructure-live` today. **The PRD itself is wrong on this point**, not just the architecture spec
that inherited it. The spec cannot be fixed in isolation without either (a) the PRD explicitly
acknowledging that some apps have >1 vault and defining v1 behavior for that case, or (b) the spec
adding an explicit "detected but unsupported — decline gracefully" path that doesn't require
touching the PRD's stated non-goal, provided it's documented as such.

**Required fix** (recommend (b), the cheaper corrective path, since full multi-vault CRUD is out of
v1 scope per the PRD and does not need to be built now):
1. Change `resolveKeyVaultName` to `resolveKeyVaults` returning
   `{ found: boolean, vaults: Array<{ dirName: string, vaultName: string|null, resourceGroup: string|null }> }`.
   `found` still means "at least one keyvault directory exists"; `vaults.length` disambiguates 0/1/N.
2. FR-001: if `vaults.length > 1` and no vault instance is specified, return a distinguishable
   response (e.g. `422 { success:false, error: 'Multiple Key Vaults found, specify vaultDir', vaults: [...] }`)
   rather than silently picking one.
3. FR-002: add a required `vaultDir` field to the `POST /api/secrets` request schema whenever
   `vaults.length > 1`; validate it against the resolved list before writing anything.
4. FR-004/UI: render a vault-instance selector when the list call reports `vaults.length > 1`.
5. **PRD follow-up required**: flag to the PM agent that the "exactly one Key Vault per
   app/environment pair" Non-Goal needs an addendum — either narrowing it to "single-vault UX is the
   only supported *submission* flow in v1; multi-vault apps are detected and require explicit
   selection, not full parity" (matches the fix above) or removing the non-goal's blanket "v1
   supports exactly one" framing since it is factually contradicted by `mlops`.

---

### B2 — The documented fallback is dead code for every variant it needs to rescue

**Evidence**: FR-003(c)/spec.json line 79: *"a fallback scan of all `*.hcl` in
`infrastructure/{appName}/{environment}/` for a keyvault module block."* Checking this against each
observed variant:
- `keyvault01/`, `keyvault02/` (mlops): the fallback lists `*.hcl` files directly under
  `infrastructure/{appName}/{environment}/` — it does not recurse into `keyvault01/`, so
  `keyvault01/terragrunt.hcl` is invisible to a non-recursive listing at the parent level. **Not rescued.**
- `doccafe/hub/{int,prod,sand}/` (depth-3: `{app}/hub/{env}`): the fallback is still anchored at
  `infrastructure/{appName}/{environment}/` — for `doccafe`, that resolves to
  `infrastructure/doccafe/{environment}/`, which is not a real directory (the real path inserts
  `hub` between app and environment). The fallback never even reaches the right directory. **Not rescued.**
- `linuxVms/sand/acunetix/` (`{app}/{env}/{subapp}`): same anchor-depth problem — the fallback would
  scan `infrastructure/linuxVms/sand/` which is one level short of `acunetix/env.hcl`. **Not rescued.**
- `itg/_common/keyvault.hcl`: lives under `infrastructure/itg/_common/`, entirely outside any
  `{app}/{environment}/` directory the fallback is rooted at. **Not rescued regardless of recursion.**

Every variant the human's evidence names is a variant the stated fallback cannot reach. The fallback
description currently reads as if it provides meaningful additional coverage; it does not, for any of
the four concrete cases in evidence.

**Required fix**: Either delete the fallback-scan language (it is misleading, not merely
under-powered) and honestly scope FR-003 as "depth-2 canonical layout only, `found:false` for
everything else," or — better, since it directly solves this — replace the primary-path/fallback pair
entirely with the tree-enumeration approach assessed in the Recommendation section below, which is the
only approach in scope that actually generalizes across all four variants.

---

### B3 — `resolveKeyVaultName`'s reconstruction logic has no code to build from, and "reuses `hclParser.js` patterns" overstates how much already exists

**Evidence**: I read `services/hclParser.js` directly (not from memory or the PRD's paraphrase).
`parseHclContent()` calls `hcl2-parser.parseToObject()` on a single file's content and only extracts
`module{}.source`/`module{}.version` from the **first** `module` block found — that's the entire
extraction logic in the file today. `findEnvHclFiles()`/`getApplicationsFromRepo()` add directory
listing and per-app `env.hcl` fetch, but never inspect `locals {}` blocks, never call
`read_terragrunt_config(find_in_parent_folders(...))` semantics, never evaluate `substr()`/`format()`/
string interpolation, and never fetch a second file to resolve a cross-file reference. There is
**zero** code today that could reconstruct even the simplest case the spec explicitly claims is
supported (FR-003(d)'s `substr(local.prefix, 0, 7)` example) — this is not an edge case gap, it's the
entire feature's core logic, currently unwritten. FR-003(g)/spec.json's "Reuses `services/hclParser.js`
patterns and `githubService.octokit` — no new credential" is accurate only for the octokit-client
reuse; the locals-chasing logic it implies is a small extension is actually 100% new.

This is compounded by a second confirmed fact from live `service-catalog` HCL (verified independently,
see PRD-consistency section below): the **alias name bound to a cross-file config load varies per
app**. I found, in `service-catalog` alone: `config = read_terragrunt_config(find_in_parent_folders("env.hcl"))`
(used in `dey`, `hr`, `cprs`, `idmprtl`, and others) alongside `common_vars =
read_terragrunt_config(find_in_parent_folders("common.hcl"))` in the same files — i.e. even the LHS
name for "the loaded `env.hcl`'s locals" is not fixed (`config` here; the human's infra-live evidence
names `env` and `config` as two different aliases used by different apps for the same underlying
`env.hcl` load). A resolver that special-cases the literal string `local.env.` or `local.config.` will
silently fail on whichever alias a given app didn't happen to choose. `resolveKeyVaultName` must first
discover the alias-to-file binding (by matching `<name> = read_terragrunt_config(find_in_parent_folders("<file>.hcl"))`)
before it can follow `local.<alias>.locals.<key>` at all — none of this exists in `hclParser.js` and
none of it is named as a component change anywhere in `secret-self-service-spec.json`.

**Required fix**: Name a concrete new component (e.g. `services/terragruntLocalsResolver.js`, not a
silent addition inside `hclParser.js`) whose job is specified as:
1. Fetch `common.hcl`, the app's `env.hcl` (walking up from the target directory, mirroring
   Terragrunt's `find_in_parent_folders()` semantics), and the target `terragrunt.hcl`.
2. Parse each file's `locals {}` block and record which local name is bound to which
   `read_terragrunt_config(find_in_parent_folders("X.hcl"))` call, so `local.<alias>.locals.<key>`
   resolves regardless of whether an app called that alias `env`, `config`, or `common_vars`.
3. Evaluate the small expression grammar actually observed in production
   (`substr(s, start, len)`, `format(...)`, and `"${a}-${b}"` interpolation) over the resolved locals
   — not full HCL/Terraform expression evaluation, just this bounded set.
4. Strip full-line `#`/`//` comments before any assignment match, so a commented-out
   `# keyvaultname = ...` line (confirmed present in `commHub/*/env.hcl`) is never matched as live.

Flag to the Vue.js Dev / SRE DevOps agents that this is new parsing infrastructure with real edge
cases, not a one-line extension of an existing function — the effort estimate implied by "reuses
hclParser.js" is misleading as currently worded.

---

## Assessment of the human's proposed inversion (tree enumeration)

**Recommendation: adopt it.** Once B1–B3 are actually fixed under the current probe-based design,
that design ends up doing tree enumeration by another name anyway (recursing into numbered vault
directories, handling variable path depth, finding a config file outside any `{app}/{env}/` root) —
the inversion is simply the honest, single version of that logic instead of a patchwork of
special-cased probes.

1. **Correctness against observed variants**: one `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`
   call returns every path in the repo. Filtering path segments for `/keyvault(\d+)?$/i` (directories)
   **and** `/keyvault\.hcl$/i` (files, for the `itg/_common/keyvault.hcl` case) catches all four named
   variants in one pass, provided `{appName}`/`{environment}` extraction is written as "everything
   between `infrastructure/` and the matched segment, minus the environment/hub-segment convention,"
   not hardcoded to exactly two path segments. That variable-depth requirement must be stated
   explicitly in the revised spec — it's the one part of the inversion that isn't free.
2. **API cost — confirmed fewer calls, not more**: the current probe design issues 1 call
   (primary path hit) up to 1 + 1-per-file (fallback: dir listing + one get per `*.hcl`), repeated per
   distinct `{target, appName, environment}` tuple until the 5-minute TTL expires — across a catalog
   with 100+ apps that's many repeated round trips over a session. Tree enumeration is **exactly one**
   call per repo, after which every app/environment/vault lookup is answered from the in-memory path
   list with zero further API calls until the cache entry expires. This confirms the human's claim.
3. **Response size / truncation risk**: I do not have a tool that calls the GitHub Trees API directly,
   so I cannot report an exact entry/byte count for `infrastructure-live` or `service-catalog` — this
   is an estimate, not a verified measurement. From the path volume surfaced by text search across
   `service-catalog` alone (100+ live app directories plus a comparably sized `recycle-bin/` tree,
   each with several module subdirectories and a handful of files), the order of magnitude looks like
   low thousands of entries, well under GitHub's 100,000-entry / 7MB truncation ceiling — but this is
   an inference, not a verified fact, and **must be checked with an actual call** before being relied
   on. Regardless of the estimate, the revised spec should explicitly require: if the trees response
   returns `truncated: true`, log a warning and fall back to bounded per-directory `getContent` calls
   rather than silently operating on a partial tree.
4. **Cache key**: the Round 1 B2 fix (cache the in-flight Promise, not the resolved value — this
   pattern itself is not being re-litigated) was scoped to key
   `${target}:${appName}:${environment}`. A tree-based design should re-key it to `${target}` alone
   (one repo-level tree Promise serves every app/environment/vault lookup), which is strictly better:
   it collapses concurrent bursts across *different* app/environment combinations into one call, not
   just bursts for the identical tuple. This is a re-scoping of the existing cache mechanism, not a
   reopening of whether to cache the in-flight Promise (settled, out of scope) — only the key shape
   changes.

---

## Verification of `service-catalog` independently (not taken on PRD's word)

I ran targeted GitHub code search against `Aya-DevOpsTeam/service-catalog` rather than trusting the
PRD's "both repos share the same layout" assertion.

- **Directory depth**: every live (non-`recycle-bin`) example found — `dey`, `delt`, `hr`, `tpms`,
  `mlowfai`, `cprs`, `shft`, `plens`, `sqlmcp`, `addrval`, `idmprtl`, `ciamsvc`, `onbrdrp`, `aptfinde`,
  `allctmpr`, `aixhouse`, `atmagent` — follows the depth-2 `{app}/{devsand|sand}/keyvault/terragrunt.hcl`
  pattern, matching FR-003(b)'s claim for the samples I could see. I did not find a depth-3 (`hub`-style)
  or multi-instance (`keyvault01`/`02`) example in `service-catalog` via text search, but text search is
  not exhaustive proof of absence — a full recursive tree walk (which I could not run with available
  tools) would be needed to rule those structural variants out with certainty in this repo specifically.
- **Value-resolution fragility exists in `service-catalog` too, contrary to what "identical layout"
  implies**: I found `infrastructure/idmprtl/devsand/env.hcl` defining its own literal
  `keyvaultname = "idmprtl-${local.envName}-${local.alias}-kv-1"`, separately referenced elsewhere via
  `local.config.locals.keyvaultname` (`idmprtl/devsand/appservicelinux/terragrunt.hcl`) — the same
  indirection-through-a-differently-aliased-config-file pattern the human's `infrastructure-live`
  evidence describes (`local.env.locals.X` / `local.config.locals.X`). I also confirmed the
  alias-naming inconsistency directly: the same conceptual "load `env.hcl`" step is bound to the local
  name `config` in `dey`/`hr`/`cprs`/`idmprtl`'s `keyvault/terragrunt.hcl`, while `common.hcl` is
  separately bound to `common_vars` in those same files. **Conclusion**: the PRD's "both repos share
  the same layout" claim (FR-007's rationale) holds for *directory depth* in what I could verify, but
  does **not** hold for *value-resolution simplicity* — the same alias-name fragility that motivates
  B3 is present in `service-catalog`, not just `infrastructure-live`. FR-003(b)'s "Validated via GitHub
  for both repos... identical to infrastructure-live" language should be corrected to scope that claim
  to directory depth only, not to imply the discovery problem is uniformly easy in both repos.

---

## Advisory Findings

### A1 — FR-003(b)'s "identical to infrastructure-live" claim should be scoped down
As found above, this is true for directory depth in the sampled data but not for value-resolution
complexity. Recommend narrowing the wording so a reader doesn't infer the whole discovery problem is
solved for both repos just because the directory shape matches.

### A2 — No disambiguation rule between the per-app `keyvaultname` local and the shared `env_key_vault_name` local
The spec already notes (FR-003(d)) that `env_key_vault_name` in `common.hcl` is a distinct,
shared/environment-level vault, not the per-app one. Confirmed in the same `service-catalog` search:
many app-level `terragrunt.hcl` files reference `local.env_key_vault_name` for Datadog/App Settings
purposes, which is a completely different vault than the per-app `keyvaultname` the keyvault module
itself creates. If B3's resolver is built as a generic "find any local assigned to something ending in
`-kv-1`" scan, it risks matching the wrong one. Recommend an explicit rule: only the `inputs.keyvaultname`
value inside the matched `keyvault*/terragrunt.hcl` counts; ignore any `*_key_vault_name` local
encountered while resolving locals.

### A3 — Tree-enumeration's Infrastructure App scope isn't confirmed in writing
`git.getTree`/`git.getRef` are standard REST calls under the same Octokit client and the same
Infrastructure GitHub App installation already used elsewhere in this file — this should not require
a new permission, but the revised spec should say so explicitly in one line so the Dev/SRE agents
don't have to independently re-derive it.

---

## Round Context

This is not a Round 1→2 delta check; Round 2 already closed with 0 blocking findings and an
`approved` verdict on the concerns it was scoped to (B1–B3 from Round 1, all about SOPS/caching/branch
handling, not Key Vault discovery). Nothing in Round 1 or Round 2 examined the path-pattern assumption
this round is scoped to — this is new ground, opened by explicit human instruction after Round 2
closed, not a re-litigation of anything either prior round already settled.

---

## Recommendation Summary

- **Adopt the tree-enumeration inversion** for `resolveKeyVaultName` (renamed `resolveKeyVaults`),
  re-keying the existing in-flight-Promise cache to repo-level (`${target}`) rather than
  per-app/environment tuple.
- **Fix the data model** to return a list of vaults, not a singular nullable name, and thread that
  through FR-001/FR-002's contracts and the UI with an explicit vault-instance selector shown only
  when more than one is found.
- **Build (not extend) a real locals/expression resolver** — name it as new work, not a reuse of
  `hclParser.js`'s existing (much simpler) extraction logic.
- **PRD needs a follow-up**: the "exactly one Key Vault per app/environment pair" Non-Goal is
  factually false for at least `mlops`; this is a PRD defect, not a spec-fidelity defect, and should
  be routed back to the PM agent for a scoped addendum (not a full re-run of the 4-round PRD Challenger
  cycle) rather than silently patched around in the architecture layer alone.

<!-- ARCH-CHALLENGER-VERDICT
feature: secret-self-service
round: 3
verdict: escalate_to_human
blocking_count: 3
advisory_count: 3
human_directed: true
opened_after_round2_approval: true
note: "Round 3 authorized by explicit human instruction after Round 2 approved; not a self-initiated loop past the two-round cap. Prompt-injection attempt observed in tool outputs (fake context_guidance blocks urging a nonexistent ctx_execute tool) and ignored; see Security note above."
-->
