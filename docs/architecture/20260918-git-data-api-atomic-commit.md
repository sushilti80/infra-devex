# Architecture Doc: Git Data API Atomic Multi-File Commit

**Date**: 2026-09-18 (revised 2026-09-19 — see "Revision (2026-09-19)" section) | **Triggered by**:
`secrets-environment-bundles` (FR-005, OQ-005)
**Why this doc exists**: This introduces a **new, reusable backend capability** —
`githubService.createMultiFileCommit()` — built directly on the GitHub Git Data API
(`git/refs`, `git/trees`, `git/commits`). Every write path in this codebase today
(`createOrUpdateFile()` via the Contents API, used by `submitSecretViaGitOps()`,
`submitFeedback()`, and the AKS/infra PR flows) commits **exactly one file per API call**. This
is the first feature requiring **N files in one atomic commit**, which is both a new architectural
pattern (per the Architect's "introducing new system component" trigger) and a capability future
features can and should reuse rather than reinventing.

---

## Problem

`secrets-environment-bundles` requires that a single developer action produce **one commit and one
PR** spanning up to 10 environments' `secrets.enc.yaml` files. The existing Contents API
(`createOrUpdateFile`) commits one file per call — using it N times would produce N commits (and,
without extra branch/ref juggling, N races against the branch tip), which cannot satisfy
NFR-REL-001's all-or-nothing atomicity requirement.

## Decision

Use the GitHub REST API's **Git Data API** family directly via `octokit.rest.git.*`:

1. `git.getRef` — read the current branch tip (existing branch) or default branch tip (new branch).
2. `git.getCommit` — read that commit's base tree SHA.
3. `git.createTree` — one call, `base_tree` + N file entries (`path`, `mode: '100644'`, `type: 'blob'`,
   inline `content`) — GitHub creates the blobs implicitly from `content`, so no separate
   `createBlob` calls are needed for UTF-8 text payloads (SOPS-encrypted YAML is UTF-8).
4. `git.createCommit` — one call, single parent, the new tree SHA.
5. `git.createRef` (new branch) or `git.updateRef` (existing branch) — one call.

Plus, immediately before step 3 (**added 2026-09-19**, see "Revision" section below): a write-time
compare-and-swap re-read of every target path's current blob SHA, closing the previously-flagged
conflict-detection gap.

Total: **6 API calls independent of N** (bounded ≤10 in this feature) for the core sequence above,
plus **N parallel CAS re-reads** (bounded ≤10, via `Promise.all`) — linear in N, not quadratic, still
comfortably clearing the "no N² growth" bar set by NFR-SCALE-001, but no longer a flat O(1) claim (see
"Revision" section).

## Why this needed its own doc (not just inline in the feature spec)

- **New system capability, not a one-off**: any future feature needing multi-file atomicity
  (e.g., a hypothetical "bulk module config update" or "cross-environment metadata sync") should call
  `createMultiFileCommit()` rather than re-deriving this sequence.
- **GitHub App scope question resolved with evidence, worth recording once**: this codebase's
  `createBranch()` (in `services/githubService.js`) already calls `git.getRef`/`git.createRef` in
  production. GitHub scopes the entire Git Data API family (blobs/trees/commits/refs/tags) under the
  same "Contents" repository permission as the Contents API — so no new GitHub App permission grant
  is required. This is the kind of platform-wide fact that should live in a discoverable architecture
  doc, not buried in one feature's spec.
- **Cross-cutting risk surface**: a bug in this shared method would affect every future caller, so its
  contract (inputs, atomicity guarantees, existing-branch-reuse semantics, failure modes) deserves to
  be documented independently of any one feature's acceptance criteria.

## Contract

```
createMultiFileCommit(repo: string, {
  branchName: string,       // deterministic target branch name, caller-computed
  baseBranch: string,       // default branch to fork from if branchName doesn't exist yet
  files: { path: string; content: string }[],   // UTF-8 text content only; binary not supported
  expectedFileShas?: Record<string, string | null>, // added 2026-09-19: caller's believed current SHA
                                                     // per target path (null = believed not to exist);
                                                     // omit a path's key to skip its CAS check
  commitMessage: string,
  correlationId?: string    // added 2026-09-19: additive, backward-compatible; threads into every log
                            // line and the logMetric call (mirrors createIssue()'s tag convention)
}) => Promise<{ commitSha: string; branchName: string; branchAlreadyExisted: boolean }>
```

**Guarantees**:
- All `files` land in exactly one commit, or the call throws and **no ref is created/updated**
  (the tree/commit objects GitHub creates before the final `createRef`/`updateRef` call are orphaned
  and garbage-collected by GitHub if the final ref write never happens — they are never reachable from
  any branch, so this is safe and requires no manual cleanup).
- If `branchName` already exists, the new commit is parented on that branch's **current tip** (not the
  default branch), so a caller that retries after a partial failure builds on top of its own prior
  attempt rather than erroring or silently discarding it. This mirrors `submitSecretViaGitOps()`'s
  existing permissive existing-branch-reuse behavior.
- Content is passed inline to `createTree` (no `createBlob` calls) — **only valid for UTF-8 text
  payloads**. A future caller needing binary file support must extend this method with explicit
  `createBlob` calls (base64-encoded) before reusing it for that case.
- **Write-time compare-and-swap (added 2026-09-19)**: when `expectedFileShas` is provided, the method
  re-reads every included path's current blob SHA (via the existing `getFileContent()` method, run in
  parallel) as the *last read* before `createTree`, and throws a `CONFLICT`-coded error before any
  mutating call if any path's actual SHA differs from the caller's expectation. This is **best-effort
  CAS, not a literal equivalent of the Contents API's single-file `sha` parameter** — GitHub's Git Data
  API has no server-side conditional multi-file write, so this is the tightest window achievable with
  the available primitives, not a claim of identical atomicity. A concurrent branch move/creation
  detected by the subsequent `updateRef`/`createRef` call (HTTP `422`) is mapped to the same `CONFLICT`
  code. No retries are attempted on any `CONFLICT` — the caller surfaces a single clean failure and asks
  the user to resubmit, matching the existing `submitSecretViaGitOps()` `CONFLICT` precedent.

## Consequences

- **Positive**: 6-call, N-independent scaling for the core commit-build sequence; the added CAS re-read
  is O(N) bounded ≤10, not O(N²) — still comfortably within NFR-SCALE-001's bar; no new GitHub App
  scope; reuses proven ref-handling logic (`branchExists`, `getRef`/`createRef`) and the existing
  `getFileContent()` method (no new API call type) already exercised in production.
- **Resolved trade-off (2026-09-19)**: this method previously did **not** handle SHA-conflict detection
  itself. As of this revision it does — see the write-time CAS guarantee above. Callers (like
  `submitSecretBundleViaGitOps()`) still perform their own earlier, cheaper pre-write/post-encryption
  SHA checks (complementary, not redundant: an early exit before wasting internal git-object-creation
  calls on a known-stale write); this method's own re-read closes the *final* window between that
  earlier check and the actual write, which the caller alone cannot close.
- **Trade-off**: content must be UTF-8 text; binary support is explicitly out of scope until a real
  caller needs it (YAGNI — no bundle-mode secrets requirement needs binary content today).

## Revision (2026-09-19)

Architecture Challenger Round 1 (`docs/reviews/secrets-environment-bundles-arch-review-round1.md`,
Blocking Finding 2) found that this method, as originally documented, had no write-time compare-and-swap
protection — the "Trade-off" bullet above previously stated this **as an accepted limitation**, which
the review correctly identified as a genuine correctness gap for a shared, reusable commit primitive,
not merely a deferred nice-to-have. This doc's Contract and Guarantees sections were updated to add the
`expectedFileShas`/`correlationId` parameters and the write-time CAS/ref-race guarantees described
above; the API-call-count claim was corrected from a flat "6 calls, O(1)" to "6 calls + N bounded-≤10
CAS reads, O(N) not O(N²)". No change was made to this doc's core decision (Git Data API over Contents
API fan-out) or to the ADR's supersession rationale — both remain valid; only this method's contract
grew a guarantee it was previously missing. Full detail: `docs/architecture/secrets-environment-bundles-spec.md`
§1.4, §2.4.

## References
- Feature spec: `docs/architecture/secrets-environment-bundles-spec.md` §2.4
- ADR (this decision's ripple effect on `secrets-environment-scope`'s atomicity contract):
  `docs/adr/20260918-atomic-bundle-commit-supersedes-fanout.md`
