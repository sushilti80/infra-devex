# PRD Challenger Review: secrets-ui-enhancements (Round 1)
Date: 2026-08-01
PRD: docs/prd/secrets-ui-enhancements.md

## Verdict
changes_requested

## Blocking Findings

- [ ] **PRD self-declares `approved` before this Challenger gate has run** — Section 1 (`Status |
  approved`) and the `ORCHESTRATOR-READY` block (`status: approved`) both assert final approval
  on the same date this Round 1 review was requested. This repo's own precedent (v1
  `secret-self-service` PRD, `Status: approved (human sign-off 2026-07-31, after PRD Challenger
  rounds 1–4)`) treats "approved" as the *post-gate* human sign-off label, and an identical
  premature-approval pattern was a Blocking finding in that PRD's own Round 1 review. Left as-is,
  an Orchestrator or Architect scanning for `ORCHESTRATOR-READY`/`status: approved` could skip
  this gate entirely.
  **Suggested fix**: Set `Status: draft` (or `in-review`) in Section 1 and `status: pending_review`
  in the `ORCHESTRATOR-READY` block until a human signs off following Challenger approval,
  matching the v1 PRD's convention exactly.

- [ ] **Missing structural sections present in this repo's own PRD template** — The v1
  `secret-self-service` PRD (the explicit baseline this PRD extends) has dedicated `## 8. API and
  Data Impact`, `## 9. UX and Workflow Impact`, `## 11. Delivery Plan`, and `## 12. Test and
  Validation Strategy` sections. This PRD has none of the four — API/data impact is scattered
  across FR acceptance criteria with no consolidated contract view, there is no rollout/delivery
  sequencing for the three FRs (ship together vs. incrementally, flag-gated or not), and no test
  strategy despite FR-003 introducing a new atomicity/conflict-detection code path.
  **Suggested fix**: Add the four missing sections. At minimum, Delivery Plan must state whether
  FR-001/002-003/004 ship together or in stages, and Test Strategy must enumerate scenarios for
  bulk atomicity (FR-003(j)), duplicate-name rejection, SHA-conflict-on-bulk, and Jira regex
  edge cases.

- [ ] **FR-003(e) contradicts OQ-002 on the bulk branch-naming scheme** — FR-003(e) states, as a
  settled acceptance criterion, that the branch name uses
  `secrets/{appName}-{environment}-{vaultSlug}-bulk-{timestamp}`. OQ-002, discussing the exact
  same requirement, is marked **Open** and proposes a *different* scheme —
  `-bulk-{shortHash}` (first 8 chars of a SHA-256 of sorted secret names) — specifically because
  a timestamp-based name isn't idempotent across retries of the same secret set. An Architect
  cannot tell which is authoritative, and as written FR-003(e) is already inconsistent with the
  idempotency goal OQ-002 is trying to solve.
  **Suggested fix**: Resolve OQ-002 first, then make FR-003(e) match it verbatim (the hash-based
  scheme is the one that supports retry-idempotency; recommend adopting it and deleting the
  `-bulk-{timestamp}` text).

- [ ] **Legacy single-secret backward-compatibility path's branch naming is unspecified** —
  FR-003(b) says a legacy `{ secretName, secretValue }` request is wrapped into a one-element
  `secrets[]` array internally. Neither FR-003(b) nor FR-003(e) says whether that wrapped request
  keeps the v1 branch format (confirmed in `services/secretsService.js`:
  `` `secrets/${appName}-${environment}-${vaultSlug}-${secretName}` ``) or switches to the new
  bulk format. This isn't cosmetic: `githubService.findOpenPullRequest(repo, branchName)`
  dedup/collision behavior, and any external tooling that parses branch names, depends on which
  scheme fires for N=1.
  **Suggested fix**: Add an explicit clause: requests using the legacy singular shape produce the
  v1 branch name unchanged; only requests using the new `secrets[]` array shape (including a
  single-element array submitted deliberately via the new UI) use the bulk naming scheme.

- [ ] **NFR-PERF-002's fixed target contradicts OQ-003's own admitted uncertainty, and looks
  unachievable against the actual encryption mechanism** — `services/secretsService.js` confirms
  `encryptValueWithSops()` shells out to the `sops` binary via `execFileAsync` once per secret
  value (not a library call), and FR-003 describes bulk encryption as sequential. Real SOPS CLI
  invocations typically cost several hundred ms each (process spawn + key-material fetch), so 20
  sequential invocations alone risk consuming a large fraction of the 5000 ms p95 budget before
  any GitHub Contents/PR API calls are counted. Meanwhile OQ-003 — discussing the very same
  20-secret cap — is marked **Open** and says the cap "may need adjustment based on SOPS
  encryption time." NFR-PERF-002 presents the 5000 ms/20-secret figure as an already-decided,
  measurable target while OQ-003 says the same capacity question is unresolved.
  **Suggested fix**: Either benchmark real `sops` invocation latency before fixing
  NFR-PERF-002's number, or mark NFR-PERF-002 explicitly provisional pending OQ-003, rather than
  stating a firm target and an open question about the same capacity in the same document.

- [ ] **The stated mitigation for a truncated `infrastructure-live` tree doesn't address FR-001's
  actual failure mode** — The Risks table proposes reusing `resolveKeyVaults`'s "bounded per-app
  directory walk" fallback (confirmed in `secretsService.js`, the `guard < 500` loop) when the
  tree fetch is truncated. That fallback requires an already-known `appName` to scope its walk —
  it exists to enumerate vaults *inside* one identified app directory, not to enumerate the
  top-level list of *all* app names FR-001 needs to populate the dropdown in the first place. When
  the tree is truncated, there is no defined mechanism left to still produce a complete app list;
  the named mitigation doesn't rescue the scenario it's attached to.
  **Suggested fix**: Define a real fallback for the truncated case — e.g., a paginated
  `GET /repos/{repo}/contents/infrastructure` non-recursive directory listing to at least recover
  top-level app names — or explicitly document that the app list may be silently incomplete under
  truncation and require the UI to surface that state rather than claiming a fix that doesn't work.

## Advisory Findings

- FR-001(a) vs FR-001(b) present two mutually exclusive API shapes ("new `GET /api/secrets/apps`"
  vs. "extend `GET /api/installed-apps` with `?target=`") as an either/or without a decision. Given
  OQ-001 already tracks a related open design question for this same FR, recommend moving the
  endpoint-shape choice into Section 8 (Open Questions) explicitly rather than leaving two
  candidate contracts alive in the acceptance criteria.
- FR-002(b) says the per-submission cap is a "configurable maximum (default: 20)" while FR-003(c)
  states a flat "maximum 20 entries" with no mention of configurability. Align the wording — say
  explicitly whether 20 is a hardcoded validator constant or an env-configurable value.
- Two of the three top-level Success Metrics (support-ticket-drop %, "time to provision 10
  secrets") have no stated instrumentation source — neither maps to a `logMetric` call defined
  anywhere in the FRs. Note how each will actually be measured (ticket-system query, timed manual
  test) so the targets are falsifiable, not aspirational.
- FR-003(j)'s all-or-nothing bulk abort has no corresponding UI behavior in FR-002 — what does the
  developer see in the form/StatusModal when entry 15 of 20 fails encryption and the whole batch
  is rejected? Worth one acceptance criterion tying FR-003(j)'s response shape to a specific
  FR-002 UI state.
- NFR-UX-001 covers keyboard navigation for the bulk row UI but not screen-reader announcement of
  dynamically added/removed rows (e.g. an `aria-live` region), which this portal's other dynamic
  list UIs (RBAC removal, per `copilot-instructions.md`) already had to solve. Worth a line.
- The Jira regex `/^[A-Za-z]+-\d+$/` (reused verbatim from `ProjectInfoForm.vue`) is a
  pre-existing limitation, not introduced by this PRD, but this PRD is the second place to bake it
  in — worth a one-line note so a future format fix doesn't have to touch two files.

## Citation Spot-Checks (verified against repo)
- `SecretsPage.vue` — `loadApps()` at line 75 (PRD cites 78-90, close enough), `appNames`/
  `filteredEnvironments` computed at 53/56, `watch([selectedAppName, selectedEnvironment,
  target], loadSecrets)` at line 189, `onMounted(loadApps)` at 190 — confirmed present.
- `services/infrastructureService.js:143` — `getInstalledApps()`, hardcoded to
  `config.github.serviceRepo` — confirmed.
- `services/hclParser.js:147` — `getApplicationsFromRepo()` — confirmed.
- `srcV2/components/infrastructure/ProjectInfoForm.vue:112-128` — `approvalNumber` field,
  `/^[A-Za-z]+-\d+$/` pattern, `"e.g., JIRA-1234 or CR-5678"` placeholder — confirmed (PRD cites
  113-124, close enough).
- `services/githubService.js:1405-1434` — `triggerAgentDispatch(...jiraTicket)` threading
  `jira_ticket` into dispatch inputs — confirmed.
- `routes/api.js:260-265` — `POST /secrets` currently validates singular `secretName`/
  `secretValue` — confirmed; supports the PRD's backward-compatibility claim in FR-003(b).
- `services/secretsService.js:23-24, 39, 96, 250, 306` — target→repo mapping, 5-minute
  repo-level tree cache, 500-dir bounded fallback guard, `execFileAsync('sops', ...)` per-value
  encryption, and the v1 branch-name template — all confirmed, and all directly underpin the
  Blocking findings above.

## Round Context
N/A — this is Round 1.

<!-- CHALLENGER-VERDICT
feature: secrets-ui-enhancements
round: 1
verdict: changes_requested
blocking_count: 6
advisory_count: 6
-->
