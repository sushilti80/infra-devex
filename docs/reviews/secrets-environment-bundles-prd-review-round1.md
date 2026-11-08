# PRD Challenger Review: secrets-environment-bundles (Round 1)
Date: 2026-09-18
PRD: docs/prd/secrets-environment-bundles.md

## Verdict
changes_requested

## Summary

This PRD is structurally strong (all 14 sections present, thorough Risk/Assumption/OQ tables) and its
Evidence Table is unusually well-cited — I spot-checked 10+ citations against the live repository
(`data/environmentTiers.json`, `data/environments.json`, `CODEOWNERS`, `services/secretsService.js`
`classifyEnvironmentTier()`/`submitSecretViaGitOps()`/`submitSecretsFanOut()`/`treeCache`,
`routes/api.js` validator chain/`redactSecretValues()`/production-tier re-derivation,
`srcV2/pages/SecretsPage.vue` `MAX_ENVIRONMENTS`/`secretEntries`/`environmentGroups`,
`services/githubService.js`'s available Octokit methods, and the `docs/roadmaps/plan-layeredKeyVaultResolution.md`
live-probe evidence for `dr`) and every one held up exactly as described. The defects below are not
citation-accuracy problems — they are internal contradictions, an untraceable requirement, an
under-scoped request contract, and one mis-classified capability that together mean the Architect
cannot start from this PRD without guessing at several load-bearing design decisions.

## Blocking Findings

- [ ] **No per-environment `vaultDir`/`qualifier` disambiguation field exists in the bundle-mode
  request contract, so any environment needing disambiguation can never be included** —
  FR-004(a)/§10 Evidence — FR-004(a) explicitly builds eligibility on "`resolveKeyVaults()` returns
  exactly one resolvable vault **(or a caller-selected `vaultDir`/`qualifier` disambiguates a
  multi-vault case)**." But FR-005(a)'s formal request schema is only
  `{ bundleId, environmentSecrets: [{ environment, secrets[] }] }` — no field anywhere carries a
  per-environment `vaultDir` or `qualifier` selection (confirmed by grepping the whole PRD: the only
  other `qualifier` references, at FR-005(g)/NFR-REL-002, treat it as a single whole-submission value
  used for the idempotency key, and FR-005(a) never even declares that field in the schema it
  presents). This is not a hypothetical: the PRD's own evidence table cites `exampleApplications`
  requiring an explicit `qualifier` (`exampleCoreServices`) to resolve at all
  (`docs/roadmaps/plan-layeredKeyVaultResolution.md`), and `secret-self-service`'s own evidence
  (`mlops`-style apps) requires `vaultDir` to disambiguate 2+ vaults per environment — both patterns
  are confirmed real in this codebase (`services/secretsService.js` `matchVaultsFromEntries`/
  `classifyVaultEntry`, lines ~188–298). Under FR-004(b), any bundle member that needs
  disambiguation is simply reported `VAULT_AMBIGUOUS`/`QUALIFIER_AMBIGUOUS` and **excluded** — and
  with no field to supply the disambiguating value, it stays excluded forever for bundle-mode
  submissions, even though the existing single-environment endpoint already supports resolving
  exactly this case via its top-level `vaultDir`/`qualifier` fields. **Fix**: add a per-environment
  `vaultDir`/`qualifier` field to `environmentSecrets[]` (e.g.
  `{ environment, vaultDir?, qualifier?, secrets[] }`), have FR-005(b)'s eligibility re-check consume
  it, and add an explicit FR-004/FR-005 acceptance criterion + QA test case covering a bundle
  submission that successfully disambiguates and includes an initially-`VAULT_AMBIGUOUS`/
  `QUALIFIER_AMBIGUOUS` environment. If per-environment disambiguation is intentionally out of scope
  for v1, say so explicitly as a Non-Goal and update FR-004(a)'s parenthetical (which currently
  promises the opposite) accordingly.

- [ ] **FR-005(b) and FR-005(h) specify contradictory behavior for the same "environment becomes
  ineligible at submission time" trigger** — FR-005(b) vs FR-005(h) — FR-005(b) states: "any
  environment named in the request that is no longer eligible (deployed-and-resolvable) at
  submission time is **rejected per FR-003**, not silently dropped" — i.e., the whole request fails
  (HTTP 400). But FR-005(h)'s own worked example response is a **successful** submission
  (`"success": true`, a real `prNumber`/`prUrl`) that includes
  `"excludedEnvironments": [{ "environment": "demo", "reason": "VAULT_AMBIGUOUS" }]` — i.e., an
  environment becoming ineligible (`VAULT_AMBIGUOUS`, precisely the scenario FR-005(b) describes) is
  handled by excluding it and succeeding with the rest, not by rejecting the request. Worse, FR-003's
  own acceptance criteria (a)–(e) only ever discuss **bundle-membership** rejections (unknown
  `bundleId`, environment outside the declared bundle) — FR-003 never mentions deployment/vault/
  qualifier ineligibility at all, so FR-005(b)'s "rejected per FR-003" cross-reference doesn't even
  point at behavior FR-003 defines. An Architect implementing this PRD literally cannot satisfy both
  FR-005(b) and FR-005(h) for the same scenario. **Fix**: pick one behavior and make both ACs and the
  Test Strategy consistent — most likely, narrow FR-005(b) to cover only true bundle-membership
  violations (not a member of `bundleId` at all → 400, matching FR-003) and state explicitly that
  deployment/vault/qualifier ineligibility discovered at submission time is **excluded**, matching
  FR-004's model and FR-005(h)'s own example. Add a dedicated Test Strategy row for "environment
  becomes ineligible between pre-flight display and submission" — today's Test Strategy (§12) has no
  case for this at all.

- [ ] **FR-005(g)'s idempotency branch-naming scheme has no content hash, so it blocks legitimate,
  distinct resubmissions to the same bundle — a regression from the exact precedent it claims to
  extend** — FR-005(g) / NFR-REL-002 vs `services/secretsService.js` lines 771–781 — FR-005(g) keys
  the deterministic branch name (and therefore the "duplicate" 409 check) purely on
  `{appName}-{bundleId}-{qualifier?}`, with **no secret-name or environment-set hashing**. The
  existing precedent it cites (`submitSecretViaGitOps()`'s `PR_EXISTS` branch-name convention,
  verified at lines 771–781) is content-addressed: a single secret's branch name includes the secret
  name itself, and a multi-secret batch's branch name includes `bulkBranchHash(secrets)` — so two
  genuinely different secret submissions to the same app/environment never collide. FR-005(g)'s new
  scheme drops this: **any** second bundle submission to the same `{appName, bundleId, qualifier}`
  while a prior PR is open is treated as a "duplicate" and hard-blocked with 409 — even one adding an
  entirely different secret, or one that finally includes an environment that was previously excluded
  (e.g., `cint` excluded as `VAULT_AMBIGUOUS` in the first submission, then resubmitted after the
  developer supplies a disambiguating `vaultDir`). This directly breaks the resubmission workflow the
  PRD itself describes in Non-Goals ("the developer resubmits after resolving the exclusion
  manually") and in FR-004(c)'s UX flow, for as long as the first bundle PR remains open/unmerged.
  Neither NFR-REL-002 nor the Test Strategy (§12, "409 on duplicate submission") tests the case of a
  legitimately *different* second submission — only byte-identical duplicates are covered. **Fix**:
  key the branch name (or at least the duplicate-detection check) on a hash of the actual submitted
  content (included-environment set + secret names, mirroring `bulkBranchHash`), and add an explicit
  acceptance criterion + QA test case confirming a distinct second submission to the same bundle
  succeeds (opens a second PR or updates the branch) while a prior, unrelated PR is still open.

- [ ] **FR-005 (atomic single-commit/single-PR submission) is classified `existing-extend`, but its
  own acceptance criterion says the required mechanism has no code precedent at all** — Classification
  Matrix / Summary Table / FR-005(d) — The Classification Matrix labels this capability
  `existing-extend`, citing `submitSecretViaGitOps()` as evidence, and the Summary Table (§13) rolls
  this into "existing-extend: 7, new-feature: 0." But FR-005(d) itself states: "this **cannot** be
  built from repeated `githubService.createOrUpdateFile()`... it requires a multi-file, single-commit
  mechanism (e.g., the Git Data API's create-tree/create-commit/update-ref sequence) — flagged
  explicitly so this is **not underestimated as a drop-in loop extension**." I confirmed by grepping
  `services/githubService.js` (1547 lines) that **zero** `createTree`/`createCommit`/`createBlob`/
  `updateRef` (or equivalent) methods exist today — only `createOrUpdateFile` (Contents API,
  single-file) and a read-only `getTree` call. OQ-005 itself calls this "the single highest-risk
  unknown in this PRD's scope." A capability with no existing implementation path, that the PRD's own
  risk framing treats as the highest-risk item in the entire feature, is not accurately described as
  "extend" — it is net-new GitOps infrastructure. This matters beyond semantics: the Summary Table's
  "0 new-feature" figure is what an Orchestrator/Architect would use to gauge delivery risk and staff
  the work, and it currently understates FR-005 specifically. **Fix**: reclassify FR-005 (the atomic
  commit mechanism only — not the encrypt/PR-body reuse around it) as `new-feature` in both the
  Classification Matrix and the Summary Table's category counts, and adjust the "existing-extend: 7"
  / "new-feature: 0" tally accordingly.

- [ ] **NFR-PERF-001's worst-case load figure bakes in OQ-004's unresolved "per-submission" cap
  interpretation, and no FR anywhere actually enforces a numeric secret-count cap for bundle-mode
  requests** — NFR-PERF-001 vs OQ-004 — NFR-PERF-001's description assumes the worst case is "5
  environments × 20 secrets" (i.e., 100 encrypt operations), which is exactly OQ-004's **recommended
  but not yet confirmed** default ("Status: Open, owner: Engineering/Architect... Recommended default
  pending confirmation: the existing 20-secret cap applies per submission... not per environment").
  If OQ-004 is instead resolved as "20 secrets per environment" (the other option OQ-004 itself poses),
  the real worst case becomes 5 × 20 = 100 secret *names*, each with up to 5 values = up to 500 encrypt
  operations — 5x larger than what NFR-PERF-001's 20000 ms target was budgeted against. Separately,
  unlike the existing single/fan-out endpoint (`routes/api.js` line 325:
  `check('secrets').isArray({ min: 1, max: 20 })`), **no FR or acceptance criterion anywhere defines
  an enforceable validator cap** on `environmentSecrets[].secrets[]` counts for the new bundle-mode
  shape — FR-005(a) only caps the environment count (1–10, via `MAX_ENVIRONMENTS`), not the secret
  count. This is both a completeness gap (missing an enforcement mechanism the NFR depends on) and a
  timing hazard (an NFR target that could be silently invalidated depending on how an still-open OQ
  is resolved). **Fix**: resolve OQ-004 before or alongside finalizing NFR-PERF-001 (not after), and
  add an explicit FR-005/FR-006 acceptance criterion + `express-validator` check enforcing whatever
  cap is chosen, mirroring the existing `check('secrets')` pattern.

- [ ] **Section 9 (UX Journey) and Section 12 (Test Strategy) both describe a "bundle shown
  empty/disabled with a reason" behavior that traces to no FR or acceptance criterion** — §9 step 2 /
  §12 FR-002 test row — The UX Journey states: "Bundles with zero eligible environments for this app
  are shown as empty/disabled rather than hidden entirely... (e.g., 'Release Bundle — no deployed
  environments for this app')," and the Test Strategy's FR-002 row explicitly requires testing "empty
  bundle shown disabled with reason." But no FR anywhere defines this: FR-002's acceptance criteria
  only govern **individual environment** visibility (an environment with `bundleId: null`, or a
  bundle member that isn't deployed, is "never present... no placeholder... no warning text," FR-002(b)/(c))
  — nothing in FR-002 addresses what happens at the **bundle-group container** level when *all* of a
  bundle's members are ineligible. FR-004(f) is the closest related AC, but it only governs the
  submit-button state *after* a bundle has already been selected, not the initial bundle-list
  rendering. QA has no acceptance-criterion ID to implement or verify this exact reason-text format
  against, and it sits in unreconciled tension with FR-002(c)'s explicit "no placeholder... no
  warning text" design principle for the environment level. **Fix**: add an explicit acceptance
  criterion (in FR-002 or a new FR-002(f)) defining the bundle-group-level empty state precisely:
  the trigger condition (zero FR-004-eligible environments for that bundle+app), the exact UI
  treatment, and the exact reason-text format — and reconcile it with FR-002(c)'s stated philosophy
  of not showing not-deployed placeholders at the environment level.

- [ ] **The same physical environment (e.g., `stage`) receives inconsistent production/release-control
  treatment depending on which request shape a client uses, and the one Known Risk that discusses this
  reclassification only addresses external tooling, not this platform's own dual behavior** —
  §2 "Current Pain" point 1 / §10 Known Risks / FR-009(d) — `data/environmentTiers.json` is
  deliberately left unchanged (FR-001(h)), so `stage` remains classified `"production"` there, and the
  legacy `environments[]` shape still requires `confirmedProductionWrite` for it (per
  `secrets-environment-scope` FR-007, preserved by FR-009(d)). But the new `data/secretBundles.json`
  puts `stage` in the `developer` bundle with `releaseControlled: false` — so a bundle-mode submission
  to `stage` never surfaces the `[RELEASE]`/`releaseControlled: true` signal (FR-007) or (per the
  existing tier-based pattern) any production-write confirmation prompt at all. Since both UI paths
  are explicitly expected to coexist post-launch (OQ-003 — whether to retire the old tier UI — is
  left open, non-blocking), a developer can write to the exact same real infrastructure environment
  (`stage`) with a production-write confirmation via the legacy path, or with **no** special
  confirmation via the new bundle path, depending only on which UI they happen to use. The only Known
  Risk that touches this reclassification frames it purely as an **external tooling/dashboard**
  concern ("any external tooling/dashboard depending on `data/environmentTiers.json`'s current
  classification may need updating") — it never analyzes the fact that this platform's *own* two
  submission paths would now disagree with each other about whether `stage` needs elevated
  confirmation. This is a security/compliance-relevant gap (Review Dimension 5), not just a
  cosmetic classification drift. **Fix**: add an explicit acceptance criterion (FR-007 or a new NFR)
  stating how the two classification systems interact during the coexistence period — e.g., a bundle
  submission touching an environment tier-classified `"production"` in `data/environmentTiers.json`
  must still surface a production-write-style confirmation even when its bundle's own
  `releaseControlled` flag is `false` — or explicitly document (with Security/Compliance sign-off)
  that Platform Engineering's bundle curation is intended to be the sole, superseding authority for
  confirmation purposes going forward, and call that decision out in the Delivery Plan's cutover
  coordination step, not only in the Risk table's external-tooling framing.

- [ ] **Section 1's `Status` and the trailing `ORCHESTRATOR-READY` block's `status` contradict each
  other, so `ORCHESTRATOR-READY` is not justified for this submission** — §1 Title/Metadata vs
  machine-readable footer — Section 1 states `Status | draft (pending PRD Challenger review)`, but the
  file's trailing block reads `status: approved`. This PRD has not yet been reviewed by the PRD
  Challenger (this is Round 1) — a self-declared `approved` status ahead of that review is exactly the
  premature-approval pattern this review process exists to catch, and it would let an Orchestrator
  that trusts the machine-readable block skip the gate entirely. **Fix**: set the `ORCHESTRATOR-READY`
  block's `status` to `pending_review` (or remove/omit the field) until this Round 1 review's verdict
  is `approved`; keep Section 1's `Status` and the footer's `status` mechanically in sync from this
  point forward (recorded as a standing check for this PM Agent across multiple prior PRDs).

## Advisory Findings

- FR-001(c) ("duplicate `id` fails config load with a startup/log error, never a silent overwrite")
  and FR-001(d) ("environment in two bundles... fails config validation (startup/log error, safe
  fallback to the last-known-good config)") describe two structurally similar config-validation
  failures with different described outcomes — (d) explicitly promises a "last-known-good" fallback,
  (c) does not. Neither AC specifies how "last-known-good" is actually persisted (in-memory cache
  populated by a prior successful load? on a fresh process start with an already-broken file, there
  is no last-known-good to fall back to). Clarify whether (c) also falls back, and specify the
  cold-start case explicitly.
- The Evidence Table's claim that `SecretsPage.vue`'s `environmentGroups` computed includes "an
  always-rendered 'Other'/unclassified bucket" (line 177) is slightly imprecise: all three template
  groups (production/non-production/unclassified, lines 664/679/694) are guarded by the same
  `v-if="group.length"` pattern — the unclassified bucket is rendered whenever non-empty, not
  unconditionally. Reword to "rendered whenever non-empty, with no filtering to exclude it" so the
  contrast drawn with the new bundle UI's deliberate omission model (FR-002(b)) is precise.
- FR-005(d)'s parenthetical ("potentially one file per vault, since an app/environment may own more
  than one vault per the existing `mlops`-style precedent") could be misread as implying a single
  bundle-member environment might contribute more than one file to the atomic commit. FR-004(a)
  already requires each environment to resolve to exactly one vault before it's eligible, so the
  "one file per vault" language is really about different environments having different vault paths,
  not multi-vault-per-environment inclusion. Reword to avoid the ambiguity for whoever implements
  FR-005(d).
- Minor citation drift: the Evidence Table cites `submitSecretsFanOut()` as "lines 851–876"
  (§4); the function declaration itself starts at line 856 (851–855 is a leading explanatory
  comment). Harmless, but worth tightening given how precise the rest of this PRD's citations are.
- No new RBAC/authorization tier is introduced for `release`-bundle submissions beyond the existing
  `requireAuth` + client-side confirmation + audit-log pattern already accepted as a residual risk in
  `secrets-environment-scope`'s readiness report. Consistent with prior precedent, not a new gap this
  PRD introduces — flagged only for awareness given this PRD explicitly elevates "release" to a
  governance-flagged bundle; no action required this round.

## Round Context

Not applicable — this is Round 1.

<!-- CHALLENGER-VERDICT
feature: secrets-environment-bundles
round: 1
verdict: changes_requested
blocking_count: 8
advisory_count: 5
-->
