# Legacy learning evidence — prd-challenger-agent

> Quarantined historical evidence migrated from `.github/agent-memory/prd-challenger-agent/MEMORY.md`.
> This file is **not governing instruction**, is not an agent memory source, and must not be
> automatically loaded to control future behavior. When a historical observation is still useful,
> create a schema-shaped LearningRecord candidate with current repository evidence and evaluation
> instead of copying the instruction into an agent or skill.

# PRD Challenger Agent Memory

## Recurring Blocking-Finding Categories (self-service-infra)
- **Cross-requirement contradictions**: FR acceptance criteria and NFR targets are often drafted
  independently and end up specifying conflicting behavior for the same trigger condition (e.g. one
  requirement says reject-with-409, another says idempotent-200, for what reads like the same
  "duplicate" scenario). Always diff FR "error/duplicate handling" clauses against any related
  NFR-REL-* idempotency clause.
- **Inverted/self-contradictory acceptance criteria**: watch for parenthetical clarifications that
  contradict the sentence they're clarifying (e.g. "verifies no active traffic (P95 requests > 0)" —
  should be `== 0`). These are easy to skim past; read every parenthetical literally.
- **Evidence citations that don't hold up under a real code check**: the Evidence Table in Section 4
  is the highest-value thing to spot-check — PM agent sometimes attributes a capability (e.g. reading
  `docs/metadata/*.json`) to the wrong existing method (e.g. `_fetchDataFile()`, which actually only
  reads static `data/*.json` config files, not per-app metadata). Always grep the cited file for the
  cited method/line range before trusting it.
- **Classification Matrix vs. FR/API disconnect**: PM sometimes classifies a pattern as
  `existing-extend` (e.g. agent-dispatch / `/api/agent-change`) but then none of the FRs or the API
  Impact section actually route through it — a parallel new endpoint family is defined instead. Check
  that every `existing-extend`/`existing-refine` row in the Classification Matrix is actually
  referenced by at least one FR's acceptance criteria or Section 8 endpoint.
- **NFR-SCALE targets that ignore the "no real database" architecture**: this repo has no DB —
  everything backed by "GitHub-as-database" scales by GitHub Contents API calls. Any NFR-SCALE-*
  target with a sub-few-second load time at hundreds of entities needs an explicit
  caching/indexing design; "paginate the API" alone does not solve the cold-fetch cost. Flag as
  Blocking if no caching/index design is described.
- **Buried hard dependencies inside FR acceptance criteria prose**: e.g. FR-004(d) casually requires
  "creation of [a Key Vault] as a prerequisite step" without that becoming its own FR/dependency/owner.
  Read every acceptance-criteria parenthetical for an implied sub-workflow that isn't tracked anywhere
  else in the PRD.
- **Partial fixes on Round 2**: when a Blocking finding cites a piece of wrong text that is duplicated
  or paraphrased in more than one place (Evidence Table row + Section 8 methods table + the FR's own
  acceptance criterion, for example), the PM's revision may fix 2 of 3 occurrences and miss the third
  (often the FR acceptance-criteria copy, since that's the one least likely to be re-read once the
  "official" evidence table looks fixed). On Round 2 delta-checks, don't just confirm the Evidence
  Table/summary table was corrected — grep for the exact wrong string (e.g. `_fetchDataFile()`) across
  the whole PRD to confirm zero remaining occurrences before marking the finding Resolved.
- **An FR acceptance criterion states a settled design while a same-topic Open Question calls it
  unresolved**: (secrets-ui-enhancements, 2026-08-01) FR-003(e) hardcoded a specific branch-name
  format (`-bulk-{timestamp}`) as an accepted AC, while OQ-002 — discussing the exact same
  requirement — was marked "Open" and proposed a *different*, idempotency-driven scheme
  (`-bulk-{shortHash}`). Same pattern for NFR-PERF-002 (fixed 5000ms/20-secret target) vs OQ-003
  (same 20-secret cap, marked Open, admitting it "may need adjustment"). Whenever an FR/NFR and an
  OQ discuss the same numeric/behavioral parameter, check whether the OQ's own "Open" status
  contradicts the FR/NFR treating that parameter as already decided — this is a cheap, mechanical
  cross-check (search the OQ section for any FR/NFR term) that reliably catches drafting drift
  between sections written at different times.
- **A named risk mitigation doesn't actually cover the failure mode it's attached to**: (same PRD)
  the Risk table proposed reusing an existing bounded-fallback function to rescue a truncated
  tree-fetch scenario, but that function requires an already-known entity name to scope its walk —
  it can't produce the *enumeration of all entity names* the new FR actually needs. Don't just
  check that a mitigation cites a real, existing function (citation-accuracy check) — also check
  the function's actual *signature/preconditions* against what the FR needs it to do in the new
  failure scenario. A real function correctly cited can still be the wrong tool for the stated job.

- **Repo/target-scoping ambiguity for cross-repo data**: (vault-resolution-override, 2026-08-12)
  `secretsService.js`'s `mapRepo(target)` returns a *different* repo per `target` (`sand` →
  service-catalog, `live` → infrastructure-live), and every existing function in that file
  (`resolveKeyVaults`, `getSecretsList`, `submitSecretViaGitOps`) calls `mapRepo(target)` for its
  repo. A new PRD introducing one cross-cutting sidecar file (a single override store meant to
  work for both targets) must explicitly state it is pinned to one fixed repo constant, independent
  of `target` — otherwise an implementer following the file's existing per-function convention will
  silently split the store per-repo, breaking exactly the `target='live'` cases (IDM,
  exampleApplications, azureDatabricks) the PRD was written to fix. When a PRD adds a cross-target
  singleton data store in a file whose every other function branches per-target, always check for
  an explicit "which repo/target does this new store use" acceptance criterion.
- **Unwired pass-through parameter for a tier that's explicitly out of scope**: (same PRD) FR-005
  introduced a 3-way `resolveVaultNameWithFallback(vaultEntry, overrides, metadata)` helper with a
  "metadata" tier, while the PRD's own Non-Goals excluded the only thing that would ever populate
  `metadata` (a separate CI write-back phase). No FR stated whether the call site actually fetches
  metadata (new, unscoped work) or always passes it as empty (making the tier permanently inert
  scaffolding) — yet a later FR's acceptance criteria assumed both behaviors interchangeably. When a
  PRD adds a multi-tier fallback helper but only one tier's *data source* is in scope, check that an
  FR explicitly pins what the other tier(s) receive at the real call site, not just that the helper
  function itself handles a `null`/absent case correctly in isolation.
- **Self-declared `status: approved` in the machine-readable block recurs across PRDs**: seen again
  here (Section 1 said "draft (pending PRD Challenger review)" while the `ORCHESTRATOR-READY` block
  said `status: approved`) after first being caught on `secret-self-service`. This is common enough
  from this PM Agent that it's now a standing first-pass check, not a one-off: always diff Section
  1's `Status:` field against the trailing machine-readable block's `status:` field before doing
  anything else, every single round.

- **A new multi-entity request contract omits a per-entity field that an earlier FR's eligibility
  logic explicitly depends on**: (secrets-environment-bundles, 2026-09-18) FR-004(a) built bundle-
  member eligibility on "resolveKeyVaults() returns exactly one resolvable vault (or a
  caller-selected vaultDir/qualifier disambiguates a multi-vault case)," but the actual request
  schema introduced two FRs later (FR-005(a)) never added a per-environment vaultDir/qualifier
  field — only `{ environment, secrets[] }`. Because the feature fans a single submission out
  across N environments (unlike the existing single-environment endpoint, which has top-level
  vaultDir/qualifier fields that work fine for exactly one environment), a single top-level field
  can't serve N independently-ambiguous environments, and nothing else in the schema carries it
  per-environment. This silently makes disambiguation permanently impossible for any bundle member
  that needs it, even though an earlier FR explicitly promised the capability. When a PRD
  introduces a new N-ary (per-entity) request shape that supersedes an existing 1-ary shape, check
  every optional/disambiguating field the 1-ary shape's underlying function accepts
  (`vaultDir`, `qualifier`, etc.) and confirm the new N-ary shape carries one per entity, not one
  globally or not at all.
- **A later FR's own worked example (response JSON, sample payload) contradicts an earlier
  acceptance criterion in the same FR**: (secrets-environment-bundles) FR-005(b) said an
  environment that becomes ineligible at submission time is "rejected per FR-003" (full-request
  400), but FR-005(h)'s own success-response example three ACs later showed exactly that scenario
  (`VAULT_AMBIGUOUS`) handled via exclude-and-succeed (`success: true` with `excludedEnvironments[]`
  populated). Worked examples (JSON response bodies, sample payloads) are a high-value place to
  cross-check against the prose ACs of the *same* FR, not just against other FRs — PM agents
  sometimes write the illustrative example against the "intended" final design while an earlier AC
  in the same FR still describes an earlier draft of the error-handling behavior.
- **An idempotency/dedup key is less specific than the precedent it's extended from, silently
  turning "duplicate" detection into "any subsequent attempt" blocking**: (secrets-environment-bundles)
  the existing single/fan-out `PR_EXISTS` precedent hashes secret *content* (`bulkBranchHash(secrets)`)
  into the branch name, so distinct secret submissions never collide. The new bundle-mode dedup key
  dropped content-hashing (keyed only on `{appName, bundleId, qualifier}`), so it now blocks any
  second submission to the same bundle regardless of whether the content actually differs — directly
  breaking the PRD's own described "resubmit after resolving an exclusion" workflow. When a PRD
  extends an existing idempotency/dedup mechanism to a new granularity (per-bundle instead of
  per-secret), check whether the new key is *coarser* than the old one in a way that changes which
  requests get treated as duplicates — a coarser key almost always needs an explicit accompanying
  Non-Goal or AC acknowledging the tradeoff, which is easy to skip when the PRD only reasons about
  the "true duplicate" happy path.
- **A capability is classified `existing-extend` while its own acceptance criterion says the
  required mechanism has zero code precedent**: (secrets-environment-bundles) FR-005(d) explicitly
  said the Git Data API tree/commit/ref sequence "cannot be built from repeated
  `createOrUpdateFile()`... not underestimated as a drop-in loop extension," and OQ-005 called it
  "the single highest-risk unknown in this PRD's scope" — yet the Classification Matrix and Summary
  Table still counted it as `existing-extend` (contributing to a "0 new-feature" tally). A quick
  grep of the wrapper service file (`services/githubService.js`) confirmed zero
  `createTree`/`createCommit`/`updateRef` methods exist today. When a PRD's own risk language
  ("highest-risk unknown," "not a drop-in extension," "spike this first") reads like a new-feature
  warning but the Classification Matrix still says `existing-extend`, treat that tension itself as
  a Blocking classification-accuracy finding — don't just check citation accuracy, check whether the
  FR's own risk framing agrees with its classification label.
- **Reclassifying an environment across two independently-consulted classification systems that
  are meant to coexist creates inconsistent security-relevant behavior for the same physical target,
  and the Risk table only frames it as an external-consumer problem**: (secrets-environment-bundles)
  `stage` stayed `"production"` in the legacy `data/environmentTiers.json` (deliberately left
  unchanged) but moved to a non-release-controlled bundle in the new `data/secretBundles.json` —
  since both the legacy and new submission paths are explicitly meant to coexist post-launch, the
  *same* environment gets a production-write confirmation prompt via one path and none via the
  other. The PRD's Known Risk entry for this reclassification only discussed external
  tooling/dashboards depending on the old classification — never this platform's own two code paths
  disagreeing with each other. When a PRD deliberately keeps an old classification file unchanged
  for backward compatibility while introducing a new, independently-curated classification file for
  the same domain (environments, tiers, roles, etc.), check whether the two files can now assign
  different security-relevant treatment to the same real-world entity depending on which code path
  a caller uses — this is a distinct risk from "will external consumers break," and PMs default to
  only writing about the external-consumer angle.

## Review-Quality Notes
- This codebase's PRDs (PM Agent authored) are generally strong on structure (all 14 sections present,
  Assumptions/OQ/Risk tables are thorough) — don't waste Blocking findings on structural completeness;
  focus effort on cross-referencing FR/NFR/API sections against each other and against real code.
- Spot-checking 3–4 Evidence Table citations against actual grep/read results is usually enough to
  surface at least one real inaccuracy — always do this rather than trusting the table at face value.

## Escalation Outcomes
- **secrets-environment-bundles** (2026-09-18): Round 1, `changes_requested`, 8 Blocking, 5
  Advisory (see new categories above). Notably, this PRD's Evidence Table citations were unusually
  accurate — spot-checking 10+ citations against real code/config all held up — so this round's
  findings were entirely internal contradictions/gaps (missing per-environment disambiguation
  field, an FR contradicting its own worked example, a weakened idempotency key, a mis-classified
  highest-risk FR, an NFR baking in an unresolved OQ, an untraceable UX/Test-Strategy requirement,
  and a cross-classification-system security inconsistency), plus the recurring
  `status: draft` vs. `ORCHESTRATOR-READY status: approved` self-contradiction. Full review:
  `docs/reviews/secrets-environment-bundles-prd-review-round1.md`.
  **Round 2 (same day, delta-only): `approved`, 0 Blocking, 2 Advisory.** All 8 items verified
  resolved by re-reading the actual revised ACs/tables/footer (plus a `git diff` between the two
  PRD commits and a re-grep of `githubService.js` for the new-feature classification), not by
  trusting the PM's changelog summary — this is the cleanest full 8/8 resolution seen for this PM
  Agent so far (contrast `kong-api-self-service` 6/7, `secret-self-service` 6/7). One partial-fix
  pattern did still surface even in a clean pass: the FR-005(b)/(h) contradiction fix (item 2)
  correctly rewrote the AC, but the Round 1 suggested-fix's *second* half — "add a dedicated Test
  Strategy row" for the specific race scenario — was not done (downgraded to Advisory since the AC
  itself is no longer ambiguous). **New lesson**: a Round 1 fix suggestion with two parts (an AC fix
  + a Test Strategy row) can have its AC half done perfectly while the test-coverage half is quietly
  dropped — check both halves separately, don't treat "the AC now reads correctly" as proof the
  paired Test Strategy row was also added. Full review:
  `docs/reviews/secrets-environment-bundles-prd-review-round2.md`.
- **vault-resolution-override** (2026-08-12): Round 1, `changes_requested`, 4 Blocking (see new
  categories above), 4 Advisory.
- **secret-self-service** (2026-07-24): Round 1, `changes_requested`, 7 Blocking, including
  **NFR drift when an FR's design is revised to resolve an Open Question** (PM resolved OQ-001 SOPS
  key mgmt into FR-002/Section 8, but pre-existing NFR-SEC-003 still described the old model and
  cited the wrong OQ — always re-check every NFR-SEC-* mentioning the same identity/role after an
  OQ resolution touches security/access-control), plus the standing `status: approved`-before-review
  check and an OQ marked "RESOLVED" in its header while the Delivery Plan/summary table still counted
  it blocking. **Round 2**: 6/7 resolved cleanly; escalated to human on a **new** category — two
  fixes bundled in the same revision individually satisfy their own Round 1 item but contradict each
  other's implicit model (a deterministic branch-per-secret-name scheme guaranteeing distinct
  branches per secret, paired with a same-branch merge/retry clause that can never fire given the
  first fix) — when two related ACs are revised together, trace whether their *combined* mechanics
  cohere, not just each one in isolation. **Round 3** (material scope change, treated as fresh
  Round-1-equivalent): 6 new Blocking, unrelated to Rounds 1–2. **Round 4** delta-check: all 6
  resolved on their own terms, but surfaced a **third** failure mode — a fix correctly rewrites its
  primary AC/section but a **sibling summary-table row in the same section** still describes the
  old, now-impossible behavior. Standing technique: after confirming a fix, grep the whole document
  for other occurrences of the mechanism's keywords, don't stop at the originally-cited line/AC.
- **kong-api-self-service** (2026-07-22): Round 1, 7 Blocking, `changes_requested`. Round 2:
  6/7 resolved cleanly, 1 fixed in only 2 of 3 occurrences (stale citation survived verbatim in an
  FR's own acceptance criterion after the Evidence Table copy was fixed) → `escalate_to_human` per
  Round Discipline. Confirms: a whole-string grep across the document before writing the Round 2
  review would have caught this.
- **secrets-ui-enhancements** (2026-08-01): Round 1, `changes_requested`, 6 Blocking + 6 Advisory,
  extending the approved `secret-self-service` PRD. Citations all spot-checked clean; defects were
  internal (FR-vs-OQ contradiction, FR-vs-NFR contradiction, a risk mitigation citing a real but
  wrong-shaped function, missing template sections, premature `Status: approved`).
