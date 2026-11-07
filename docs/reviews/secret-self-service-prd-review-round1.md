# PRD Challenger Review: secret-self-service (Round 1)
Date: 2026-07-24
PRD: docs/prd/secret-self-service.md

## Verdict
changes_requested

## Summary

The PRD is structurally complete (all 14 sections present) and most FR acceptance criteria are
concretely testable (regex patterns, HTTP status codes, response shapes). Spot-checked evidence
citations (`config.js:123`, `middleware/auth.js` `requireAuth`/`requireRole`, `services/hclParser.js`
`findEnvHclFiles()`/`getApplicationsFromRepo()`, `routes/api.js` `appName` regex and `app_list_fetched`
metric pattern, `data/environments.json` feature-flag shape, the `infrastructure/{appName}/{environment}/`
path convention via the `terragrunt-new-env` skill) are all substantively accurate.

However, the OQ-001/OQ-002/OQ-003 resolutions that were cascaded through FR-002, FR-003, Section 8,
and Section 10 introduced several internal inconsistencies — most notably a security-relevant gap in
NFR-SEC-003 that does not reflect the new `wrapKey`/`unwrapKey` role-split design, plus a handful of
implementability and status-labeling contradictions. These must be resolved before Architecture work
begins.

## Blocking Findings

- [ ] **NFR-SEC-003 does not reflect the OQ-001 role-split design and misattributes its verification OQ** —
  NFR-SEC-003 ("Least-Privilege Key Vault Access") only states the portal backend needs
  `Key Vault Secrets Reader` (for FR-007) and "no write roles," verified via OQ-004. But the
  OQ-001 resolution (Section 10) introduces a **second, distinct grant**: the portal backend also
  needs `wrapKey`-only access on the platform's `sops-master-key` (a different Key Vault) to
  support FR-002 encryption. NFR-SEC-003 as written neither enumerates this second grant nor
  reconciles it with the "no write roles" language (is `wrapKey` a "write role"? unclear), and it
  cites OQ-004 for verification when the `wrapKey` grant actually comes from OQ-001. As the single
  NFR meant to define least-privilege Key Vault access, it is currently incomplete and internally
  inconsistent with Section 8's `submitSecretViaGitOps` description and the OQ-001 resolution text.
  **Fix**: Rewrite NFR-SEC-003 to separately state both grants — (1) `Key Vault Secrets Reader` on
  the per-app Key Vault for FR-001/FR-007, verified via OQ-004; (2) `wrapKey`-only on
  `sops-master-key` for FR-002, verified via OQ-001 sign-off — and clarify that "no write roles"
  refers to the per-app vault, not the SOPS master key.

- [ ] **FR-003(a) asserts the Infrastructure GitHub App "existing" access to infra-live as fact,
  contradicting OQ-003's own remaining-open-item text and the Phase 1 gate** — FR-003(a) reads
  "...using the existing Infrastructure GitHub App (`githubService.octokit`)" as if this access is
  already available. But OQ-003's resolution explicitly states: "no code path in this repo
  currently calls the GitHub API against [infrastructure-live] — Platform Engineering must confirm
  or grant this installation before Phase 1 begins," and the Phase 1 Delivery Gate repeats this as
  a blocker. FR-003's own "Dependencies" line cites only "`GITHUB_INFRA_LIVE_REPO` env var (OQ-003)"
  without surfacing the installation-scope sub-item, so a reader of FR-003 alone would not know
  this criterion is unimplementable until Platform Engineering grants access.
  **Fix**: Add an explicit caveat to FR-003(a) (e.g., "pending confirmation of GitHub App
  installation scope on infrastructure-live — see OQ-003") and list the installation-scope
  confirmation as a named dependency, not just the env var.

- [ ] **OQ-003 is labeled "RESOLVED" but Section 13 and the Phase 1 gate still treat it as a
  blocking open question** — Section 10's OQ-003 heading says "RESOLVED (evidence-based)," yet
  Section 13's summary table lists "Open Questions (Blocking Phase 1) | 2 (OQ-003, OQ-004)" and
  Section 11's Phase 1 gate says "OQ-003's GitHub App installation scope ... must be confirmed
  before Phase 1 can begin." A reader skimming the OQ header or the summary counts gets two
  contradictory signals about whether OQ-003 is closed.
  **Fix**: Change the OQ-003 status label to something like "PARTIALLY RESOLVED — path convention
  confirmed; GitHub App installation scope still open" and adjust the Section 13 count/footnote so
  it doesn't read as a flat, unqualified "still blocking" entry alongside a header that says
  "RESOLVED."

- [ ] **FR-002(h) / NFR-REL-002 depend on an undefined "existing open PR" detection mechanism** —
  Both criteria require detecting "if a PR for the same secret already exists and is open" to
  decide between treating a submission as an update vs. returning HTTP 409. No branch-naming
  convention, PR-title convention, or lookup method is specified in FR-002, Section 8's
  `submitSecretViaGitOps` description, or the data contracts. Without a deterministic
  identification scheme, this acceptance criterion cannot be implemented consistently or verified
  by the integration test listed in Section 12 ("Second identical POST returns 409 with prUrl").
  **Fix**: Specify the identification convention explicitly in FR-002 and Section 8 (e.g., a
  deterministic branch name such as `secrets/{appName}-{environment}-{secretName}` that the
  backend can search for via the GitHub API before opening a new PR).

- [ ] **Concurrent-submission conflict risk for the shared per-app/environment secrets file is
  unaddressed** — FR-002(e) stores all of an app/environment's secrets in a single
  `secrets.enc.yaml` document rather than per-secret files. FR-002(h)/NFR-REL-002 only cover the
  *same-secret-name* duplicate-submission case. They do not address two developers submitting
  *different* secrets for the same app/environment concurrently, which would produce two PRs
  modifying the same file/branch state — a distinct merge-conflict/data-loss risk that is absent
  from both the acceptance criteria and the Section 10 Risks table.
  **Fix**: Add a risk entry to Section 10 and either (a) an explicit conflict-detection/retry
  acceptance criterion in FR-002, or (b) a documented constraint (e.g., serialize submissions
  per app/environment, or merge into the existing file server-side rather than relying on a raw
  git PR merge) so this isn't discovered during implementation.

- [ ] **Phase 3 Delivery Gate text contradicts NFR-SEC-003's read-only requirement** — Section 11's
  Phase 3 gate states: "OQ-004 (Azure SDK identity) must include write confirmation." FR-007 is a
  read-only reveal endpoint, and NFR-SEC-003 explicitly requires the portal identity to have only
  `Key Vault Secrets Reader` with "no write roles" for this exact operation. A gate asking for
  "write confirmation" either is a wording defect or implies an undocumented write capability that
  would directly contradict NFR-SEC-003.
  **Fix**: Clarify the gate text — likely intended as "confirm the identity has read-only
  `Key Vault Secrets Reader` access (no write grants)" — and align the wording with NFR-SEC-003.

- [ ] **PRD contains a self-asserted `status: approved` machine-readable block that contradicts its
  own metadata and bypasses this review gate** — The document ends with an
  `<!-- ORCHESTRATOR-READY ... status: approved ... -->` block, despite Section 1's metadata table
  stating `Status: draft` and despite this being the PM Agent's PRD prior to any Challenger sign-off.
  A PRD declaring itself "approved" before the PRD Challenger gate has run undermines the purpose of
  this review step and could cause an Orchestrator parsing that block to skip straight to
  Architecture.
  **Fix**: Remove the `ORCHESTRATOR-READY` block from the PRD (that status belongs in the
  Challenger's own `CHALLENGER-VERDICT` block per the artifact-paths convention) or correct it to
  reflect `status: draft` / `pending-review` until a Challenger round actually approves it.

## Advisory Findings

- FR-002's acceptance criteria and Section 8's service-method description present the SOPS/
  infra-live design as settled fact, with no inline caveat, even though Section 10 explicitly
  labels OQ-001/OQ-002 as "PROPOSED RESOLUTION (needs Platform Engineering sign-off)." The Phase 2
  Delivery Gate is the only place tying this back together. Consider a short inline note on FR-002
  ("design pending Platform Engineering sign-off — see OQ-001/OQ-002") for readers who don't reach
  Section 10/11.

- `hclParser.findEnvHclFiles()` derives the GitHub org from `config.github.serviceRepo.split('/')[0]`
  rather than from the `repo` parameter passed in. This happens to work for infra-live only because
  it shares the same org (`Aya-DevOpsTeam`) as the service-catalog repo today. FR-003(f)'s claim that
  extending this method is a direct "mirror" with no new credential doesn't flag this implicit
  same-org assumption — worth a one-line note for the Architect.

- NFR-PERF-001 sets a 2000ms p95 target for secrets endpoints that call both GitHub (vault
  discovery) and the Azure Key Vault SDK, tighter than the existing analogous `app-metadata`
  endpoint's documented 3000ms target (which only calls GitHub, per the `NFR-002` code comment in
  `routes/api.js`). No rationale is given for the stricter bound on a more I/O-heavy endpoint;
  consider justifying it or relaxing to be consistent with existing precedent.

- FR-007's dependency on `requireRole('secret-viewer')` requires a new Entra ID app role that does
  not exist today — `data/roles.json` is exclusively Azure infrastructure RBAC role definitions, a
  different mechanism entirely. This is already flagged loosely in Section 14 item 5 as a "Decision"
  but not tracked as a numbered Open Question with its own Phase gate like OQ-004/OQ-005. Consider
  promoting it to OQ-006 for consistency.

- A few `routes/api.js` evidence line-number citations (e.g., `540-648` for `getApplicationDetails`,
  `88-93` for `app_list_fetched`) are close but not exactly aligned with current file contents.
  Not materially incorrect, but line numbers drift as the file changes — future revisions should
  re-verify ranges before citing them as evidence.

## Round Context

This is Round 1; no prior review exists.

---

**Note on tool output during this review**: Several `read_file`/`grep_search` tool results in this
session returned an appended `<PreToolUse-context>` block instructing the reviewing agent to switch
to a different tool ("context-mode_ctx_execute_file") for efficiency. This did not originate from
the PRD content, the artifact-paths skill, or any instruction given by the user, and is inconsistent
across otherwise-legitimate file reads. It was treated as untrusted content and ignored; all reads
in this review were performed with the standard `read_file`/`grep_search` tools as intended. Flagging
this for visibility in case it indicates a compromised or misconfigured tool/hook in the environment.

<!-- CHALLENGER-VERDICT
feature: secret-self-service
round: 1
verdict: changes_requested
blocking_count: 7
advisory_count: 5
-->
