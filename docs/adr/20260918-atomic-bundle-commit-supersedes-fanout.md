# ADR: Atomic Single-Commit Bundle Submission Supersedes Per-Environment Fan-Out (for bundle-mode only)

**Date**: 2026-09-18 | **Status**: Accepted | **Feature**: `secrets-environment-bundles`

## Context

`secrets-environment-scope` (already shipped, no architecture spec on record) established the current
multi-environment secrets submission model: `submitSecretsFanOut()` calls `submitSecretViaGitOps()`
once per environment via `Promise.allSettled`, producing **one commit and one PR per environment**,
each independently succeeding or failing. Its NFR-REL-001 contract is explicitly per-environment
independence: "a failure in one environment must not block or roll back any other environment."

`secrets-environment-bundles` (this feature) requires the opposite guarantee for its new bundle-mode
submission path: **one commit and one PR covering every included environment, atomically** — either
all included environments land together or none of them do (excluding the documented
`PR_CREATION_FAILED` partial-artifact case, which is a commit-without-PR state, never a
partial-commit state).

These two contracts are mutually incompatible for the same request. A decision was needed on how the
codebase reconciles them.

## Decision

Bundle-mode submissions (`bundleId` + `environmentSecrets[]` requests) use a **new, separate code
path** — `submitSecretBundleViaGitOps()` plus `githubService.createMultiFileCommit()` (Git Data API,
see `docs/architecture/20260918-git-data-api-atomic-commit.md`) — with an all-or-nothing atomicity
contract that **supersedes** the fan-out model **only for bundle-mode requests**.

The existing `environment` (singular) and `environments[]` (fan-out) request shapes, and
`submitSecretsFanOut()`/`submitSecretViaGitOps()` themselves, are **not modified, deprecated, or
removed** — FR-009 requires full backward compatibility, and the two models serve genuinely different
use cases (ad hoc/independent environments vs. governed bundles) that the PRD's OQ-002/OQ-003 leave
open for a later, separate migration decision.

## Consequences

- **Positive**: bundle-mode gets a real atomicity guarantee that fan-out structurally cannot provide
  (fan-out's `Promise.allSettled` means partial success is an inherent, accepted property of that
  model — acceptable for independent environments, unacceptable for a governed release bundle).
- **Positive**: zero risk to the shipped fan-out behavior — it is untouched code, exercised by its
  existing test suite unmodified (verified in this spec's Testing section, §6 Backward Compatibility).
- **Trade-off**: the codebase now carries **two submission models with different atomicity semantics**
  for what is conceptually "submit some secrets to some environments." This is accepted as a
  necessary, temporary duality — OQ-002 ("should the legacy free multi-select eventually be replaced
  by bundle-only submission?") and OQ-003 (UI transition period) are explicitly left open by the PRD
  for a future decision once bundle-mode has real production usage data. This ADR does **not** decide
  that question; it only decides that bundle-mode itself must be atomic, and that atomicity must not
  be retrofitted onto the existing fan-out path as a side effect of this feature.
- **Trade-off**: idempotency semantics differ between the two models too — fan-out's per-environment
  `bulkBranchHash()` produces per-environment branch names; bundle-mode's `computeBundleContentHash()`
  produces one branch name for the whole bundle. Anyone extending either path must not assume they
  share a duplicate-detection unit.
- **Follow-up (non-blocking)**: if a future decision resolves OQ-002/OQ-003 in favor of bundle-only
  submission, that follow-on work should revisit whether `submitSecretsFanOut()` can be deprecated —
  out of scope for this ADR and this feature.
- **Addendum (2026-09-19)**: Architecture Challenger Round 1 found that `createMultiFileCommit()`, as
  originally specified, lacked a write-time compare-and-swap check — a correctness gap in, not a
  reversal of, this ADR's atomicity decision. The companion architecture doc and the feature spec were
  updated to add a best-effort write-time CAS (reusing the existing `getFileContent()` method) and
  ref-race handling immediately before the commit is built; the "one commit, all-or-nothing" contract
  decided here is unchanged and, if anything, more precisely guaranteed than when this ADR was
  originally accepted. See `docs/architecture/20260918-git-data-api-atomic-commit.md` "Revision
  (2026-09-19)" and `docs/architecture/secrets-environment-bundles-spec.md` §1.4/§2.4 for the full detail.

## Alternatives considered

1. **Retrofit atomicity onto `submitSecretsFanOut()` itself** (e.g., wrap it in a single transaction-like
   check). Rejected: would silently change `secrets-environment-scope`'s already-shipped, already-relied-upon
   NFR-REL-001 contract (independent per-environment failure) for existing callers, violating FR-009's
   backward-compatibility requirement.
2. **Use N sequential `createOrUpdateFile()` calls with a manual rollback-on-failure step** (delete
   already-created files if a later one fails). Rejected: GitHub's Contents API has no atomic
   multi-file primitive; a manual rollback is itself non-atomic (the rollback call could fail too),
   and it would still produce N git commits instead of one, failing FR-005(a)'s literal "one commit"
   requirement.
3. **Adopt the Git Data API path (chosen)**: a true multi-file, single-commit primitive, with GitHub
   App scope evidence already established via the existing `createBranch()` code path (see the
   companion architecture doc).

## References
- Feature spec: `docs/architecture/secrets-environment-bundles-spec.md`
- Architecture doc: `docs/architecture/20260918-git-data-api-atomic-commit.md`
- Existing fan-out precedent: `services/secretsService.js` (`submitSecretsFanOut`, `submitSecretViaGitOps`)
