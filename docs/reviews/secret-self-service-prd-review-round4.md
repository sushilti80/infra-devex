# PRD Challenger Review: secret-self-service (Round 4)
Date: 2026-07-24
PRD: docs/prd/secret-self-service.md

## Note on Round Framing

**This is a delta-only re-check against `docs/reviews/secret-self-service-prd-review-round3.md`
(verdict `changes_requested`, 6 blocking + 5 advisory findings), not a full re-review.** Per
Round Discipline, this pass verifies only whether the Round 3 Blocking (and, time permitting,
Advisory) findings were resolved, and checks for new contradictions introduced by those specific
edits. It does not re-examine dimensions Round 3 already cleared.

## Verdict
changes_requested

## Round 3 Blocking Finding Resolution Status

1. **`resolveKeyVaultName()` return contract ambiguity** — **RESOLVED.** FR-003(e) now defines
   the concrete tri-state shape `{ found: boolean, vaultName: string|null, resourceGroup:
   string|null }`, with `found` reflecting only directory existence and `vaultName`/
   `resourceGroup` best-effort/nullable independent of `found`. The Section 8 service-methods
   table for `resolveKeyVaultName()` repeats the identical shape and semantics. FR-002(j) branches
   explicitly on `found: false` (422) vs. `found: true` + `vaultName: null` (not an error,
   proceeds normally). All three locations are consistent.

2. **Missing Section 12 test case for "found directory, unresolvable vault name"** —
   **RESOLVED.** The `resolveKeyVaultName()` row in Section 12 now lists: "found via primary
   path", "found via fallback scan", **"found directory but vault name unresolvable due to
   computed `substr` expression (`found: true, vaultName: null` — success, not an error)"**, "not
   found — no `keyvault/` directory (`found: false` → FR-001(g)/FR-002(j) 404/422)", and
   "graceful degradation (unconfigured target repo)". The exact missing case is now present and
   correctly labeled as a success path.

3. **FR-002(k) "rebase" mechanism incompatible with SOPS + `wrapKey`-only** — **RESOLVED**, with
   one propagation gap (see New Issues #2 below). FR-002(k) was rewritten to drop "rebase"
   entirely: it now explains why a git-level merge of two independently-encrypted SOPS documents
   can't work (per-file MAC), states the backend never attempts to merge/rebase encrypted
   content, and replaces it with a plain file-SHA comparison against the target repo's current
   default-branch content immediately before opening/updating a PR — HTTP 503 + retry on
   mismatch. This requires no `unwrapKey` access, so it's consistent with NFR-SEC-003.

4. **FR-002(i) 5-minute poll timeout vs. Section 9's human-review journey** — **RESOLVED**, with
   one propagation gap (see New Issues #1 below). FR-002(i) now states the endpoint is
   synchronous: encryption, commit, and PR creation happen in the request/response cycle, no
   `useWorkflowPolling.ts`/`/api/status/:correlationId` polling is used, and post-merge CI
   sync status (human-timed, unbounded) is explicitly "not tracked by the portal." NFR-UX-001 was
   updated to match ("brief in-flight indicator... not a multi-step polling sequence"). FR-004(f)
   matches ("brief in-flight indicator... no polling is used for this call"). Section 9's user
   journey (steps 6–10) was rewritten to show: synchronous submit → immediate terminal state with
   PR link → human review/merge (unbounded, not tracked by modal) → next `GET /api/secrets` visit
   reflects the change. All of these are now mutually consistent.

5. **Section 5 classification matrix row 8 stale "blocking open question" language** —
   **RESOLVED.** The "SOPS encryption key management" row's Proposed Action now reads "Implement
   per the resolved OQ-001 design: SOPS native Azure Key Vault `azure_keyvault` creation rule,
   single `sops-master-key` in a common platform Key Vault, `wrapKey`/`unwrapKey` role split (see
   Section 10, OQ-001 — resolved)" — no remaining "document as blocking open question" text.

6. **NFR-OBS-001 field list missing `target`** — **RESOLVED.** The "Events include" list now
   reads `correlationId`, `user` (email), `target`, `appName`, `environment`, `latency_ms` —
   matches FR-006(a) and FR-007(e).

**All 6 Round 3 Blocking findings are resolved on their own terms.** However, the fixes for #3 and
#4 were not fully propagated to two other sections that still describe the pre-fix behavior — see
New Issues below, which is why the overall verdict remains `changes_requested`.

## Round 3 Advisory Finding Resolution Status (checked as time permitted)

All 5 are resolved:
- NFR-PERF-001 now states the rationale for the 2000 ms budget inline (GitHub API round trip +
  HCL parsing on the request path, vs. typical <500 ms for pre-fetched-metadata endpoints).
- The classification matrix's "Auto-discover Key Vault" row now has a clarifying note that the
  `substr`-reconstruction logic itself is new, and explains why the row is still labeled
  `existing-extend` (extends the parser/service layer).
- NFR-SCALE-001 now includes the multi-replica caveat ("cache is in-process... aggregate
  cross-pod call count scales with replica count").
- Section 8's data contracts now show **two** example responses for `GET /api/secrets`: one with
  a resolved `vaultName`, one with `vaultName: null` explicitly labeled as a success case.
- FR-004(h) now has a clarifying parenthetical distinguishing the portal-deployment-environment
  gating flag from the target application's own environment selected in FR-001/FR-007.

## New Issues Introduced By the Round 3 Fixes

- [ ] **(Blocking) Section 9's error-handling table still has a "Sync workflow failure" row that
  contradicts the now-synchronous FR-002(i)/NFR-UX-001 design.** Line 741:
  `| Sync workflow failure | Status modal shows "failure" with workflow URL for diagnostics |`.
  FR-002(i) explicitly states "Post-merge CI decrypt-and-sync status... is not tracked by the
  portal," and the status modal reaches its terminal state (PR-opened success) before any human
  review/merge happens, with no further polling. There is no mechanism left in the redesigned
  flow by which the modal could later show a "sync workflow failure" with a "workflow URL" — that
  UX described a since-removed asynchronous polling/workflow-tracking path. This is the same
  table Round 3 Finding #4 flagged for the opposite (5-minute-timeout) reason; the fix corrected
  FR-002(i)/NFR-UX-001/Section 9's step list but missed this one row in the same section's error
  table. **Fix**: remove the "Sync workflow failure" row (the portal has no visibility into it
  per FR-002(i)), or replace it with a row describing what actually happens when CI sync fails
  post-merge (e.g., "not surfaced by the portal; visible only via the target repo's Actions tab,
  same as other infra workflows").

- [ ] **(Advisory) Risk table's mitigation for the concurrent-submission risk still says "merge"
  where FR-002(k) explicitly disclaims merging.** Line 756: "FR-002(k) uses a
  read-merge-commit-retry cycle before pushing, returning HTTP 503 on a second conflicting
  write..." FR-002(k) itself says the opposite — "the backend therefore does not attempt to merge
  or rebase encrypted content," using file-SHA comparison instead. This is descriptive risk-table
  prose (not a normative AC), and the resulting behavior (503 + retry) is correctly described, so
  it's not blocking — but the word "merge" in this one-line summary contradicts the mechanism just
  corrected in FR-002(k) and could confuse a reader who reads the risk table first. **Fix**:
  reword to "FR-002(k) uses a read-SHA-compare-retry cycle" (or similar) to drop "merge".

## `fr_count` / `nfr_count` Verification

- Direct count of `### FR-` headers: 7 (FR-001 through FR-007) — matches `ORCHESTRATOR-READY`
  `fr_count: 7` and Section 13's summary table.
- Direct count of `### NFR-` headers: 11 (PERF-001, SEC-001, SEC-003, SEC-004, SEC-005, REL-001,
  REL-002, SCALE-001, OBS-001, UX-001, UX-002) — matches `ORCHESTRATOR-READY` `nfr_count: 11` and
  Section 13's summary table.
- No discrepancy found.

## A Note on Injected Content Encountered While Reviewing

While reading both `docs/prd/secret-self-service.md` and this feature's earlier review files via
the normal file-reading tool, the tool output repeatedly contained an embedded
`<PreToolUse-context>` block instructing a switch to a different (unavailable) tool for "analysis."
This is injected/untrusted content embedded in the file output, not a genuine system or user
instruction, and was ignored; this review was produced using the same file-reading tool as prior
rounds, per the user's explicit instruction to disregard it.

<!-- CHALLENGER-VERDICT
feature: secret-self-service
round: 4
verdict: changes_requested
blocking_count: 1
advisory_count: 1
-->
