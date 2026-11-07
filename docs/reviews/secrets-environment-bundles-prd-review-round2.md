# PRD Challenger Review: secrets-environment-bundles (Round 2)
Date: 2026-09-18
PRD: docs/prd/secrets-environment-bundles.md

## Verdict
approved

## Blocking Findings

None.

## Advisory Findings

- Test Strategy §12's FR-005 row still has no test case whose label explicitly names the "an
  environment that was eligible during pre-flight becomes not-deployed/unresolved by submission
  time" race scenario, even though FR-005(a.2)/(b) now describe it clearly and consistently
  (excluded via `excludedEnvironments[]`, not rejected). Round 1's suggested fix asked for both an
  AC fix (done) and "a dedicated Test Strategy row for 'environment becomes ineligible between
  pre-flight display and submission'" (not done — the closest existing row, "distinct
  secret-name/environment sets succeed while an unrelated PR is open," tests a different scenario).
  Not blocking because the AC itself is now unambiguous and independently testable by QA/the
  Architect without this row, but recommend adding an explicit row before QA test-case authoring
  in Phase 2 so the scenario isn't accidentally skipped.
- FR-007(e)'s resolution of the `stage` dual-classification risk (bundle-mode's
  `data/secretBundles.json` is authoritative; legacy tier-based confirmation is preserved
  unchanged for legacy requests) is a genuine security-relevant behavior decision — Security/
  Compliance is a named PRD stakeholder (§1) but the PRD does not record their sign-off on this
  specific tradeoff the way OQ-001's external CODEOWNERS gap explicitly names Platform/DevSecOps
  as owner. This is not a new Blocking finding (Round 1's suggested fix offered "add an AC" or
  "document with sign-off" as alternatives, and the AC route taken is a valid, complete resolution
  of the Round 1 item), but if Security/Compliance has not actually reviewed this specific
  decision, doing so before Phase 3 (release-bundle rollout) would be prudent.

## Round Context

All 8 Round 1 Blocking findings were verified resolved by re-reading the exact acceptance criteria,
schema, classification matrix, summary table, and footer text (not the PM's description of the fix),
cross-checked against a fresh `git diff` of the two PRD revisions and, where the fix touched a code
citation, against the live source file:

1. **Missing per-environment `vaultDir`/`qualifier` field** — Resolved. `environmentSecrets[]`
   (FR-005(a)) now carries `vaultDir?`/`qualifier?` per entry; FR-004(g) defines how the UI supplies
   a disambiguating value per excluded environment; FR-005(b) explicitly re-checks membership
   "after its supplied `vaultDir`/`qualifier` values are checked." Test Strategy's FR-004 and FR-005
   rows both now include "per-environment `vaultDir`/`qualifier` disambiguation."
2. **FR-005(b) vs FR-005(h) contradiction** — Resolved. FR-005(b) was rewritten: a bundle-membership
   violation (environment outside the declared bundle) → HTTP 400 before any write; an environment
   that becomes not-deployed/unresolved at submission time → excluded via `excludedEnvironments[]`,
   "not treated as a bundle-membership violation." This now agrees with FR-005(h)'s worked example
   (`VAULT_AMBIGUOUS` → `success: true` with `excludedEnvironments` populated) and with FR-003(b)'s
   scope (membership only). New FR-005(a.2) cleanly separates the two failure modes
   (`INCOMPLETE_BUNDLE` for omitting a still-eligible environment vs. exclusion for one that
   genuinely became ineligible). See Advisory note above on the still-missing dedicated Test
   Strategy row for the race-condition sub-case.
3. **Weak, content-blind idempotency key** — Resolved. FR-005(g)'s branch name is now
   `{appName}-{bundleId}-{bundleContentHash}`, where `bundleContentHash` is a SHA-256 (first 8 hex
   chars) over "target, appName, bundleId, canonical included-environment set, per-environment
   `vaultDir`/`qualifier` selections, and per-environment secret-name set" — explicitly extending
   the real `bulkBranchHash()` precedent (verified at `services/secretsService.js` lines 577–580,
   matching the PRD's cited 572–580 range) rather than the old bundle-only key. NFR-REL-002 and the
   Test Strategy row now both state "a materially different secret-name or included-environment set
   is not a duplicate" / "distinct secret-name/environment sets succeed while an unrelated PR is
   open."
4. **FR-005 misclassified `existing-extend`** — Resolved. The Classification Matrix row and the
   Summary Table both now read `new-feature` for the atomic commit mechanism; the Summary Table's
   `existing-extend` count correctly dropped from 7 to 6 and its item list dropped
   "atomic single-commit/PR submission." I re-confirmed the underlying evidence still holds:
   `grep -n "createTree\|createCommit\|createBlob\|updateRef\|createOrUpdateFile"
   services/githubService.js` still returns only `createOrUpdateFile` — zero Git Data API
   tree/commit primitives exist, justifying `new-feature`.
5. **NFR-PERF-001 baked in an unresolved OQ-004 + no enforceable secret-count cap** — Resolved.
   OQ-004 is now marked "(Resolved)" with a concrete rule (union of distinct secret names per
   submission capped at 20; each per-environment array also capped at 20), FR-005(a.1) is the new
   enforcing acceptance criterion (validator-level cap, HTTP 400 before encryption/writes), and
   NFR-PERF-001/NFR-SCALE-001/the Test Strategy/`Next Decisions Needed` were all updated in lockstep
   to the 10-environment × 20-secret (≤200 op) ceiling — I checked all four locations and found no
   leftover reference to the old "5-environment × 20-secret" or "Open, owner: Engineering/Architect"
   framing anywhere in the file (`grep -n "5-environment\|5 environments × 20"` returns no matches).
6. **Untraceable "empty bundle shown disabled with reason" requirement** — Resolved, via the
   opposite (and now uniformly applied) design: FR-002(f) is a new, explicit acceptance criterion
   stating a zero-eligible bundle is "omitted from the bundle selector entirely... no reason
   message." The UX Journey (§9 step 2) and the Test Strategy's FR-002 row were both rewritten to
   match this same omission language — I confirmed no remaining occurrence of the old
   "shown as empty/disabled ... so the developer understands why" phrasing anywhere in the file.
7. **`stage` dual production/release-control classification treated only as an external-tooling
   risk** — Resolved. FR-007(e) is a new, explicit acceptance criterion: for bundle-mode requests,
   `data/secretBundles.json`'s `releaseControlled` value is authoritative (`stage` in `developer`
   gets no release marker), while legacy singular/array requests keep the existing tier-based
   behavior "until the legacy UI is retired or migrated under OQ-003." The Risk table's mitigation
   text was reworded to reference this same AC instead of only the external-tooling angle. This
   satisfies the first of Round 1's two suggested-fix options (an explicit AC pinning the
   interaction) — see Advisory note above regarding explicit Security/Compliance sign-off, offered
   as a forward-looking suggestion, not a reopened Blocking item.
8. **`Status: draft` vs. footer `status: approved` self-contradiction** — Resolved. Section 1 now
   reads `draft (revised; pending PRD Challenger round 2)` and the `ORCHESTRATOR-READY` footer now
   reads `status: pending_review`; both are mutually consistent and no longer claim premature
   approval.

All 5 Round 1 Advisory findings were also independently re-verified as addressed: (a) FR-001(c)/(d)
now both state the same last-known-good/cold-start-fail-closed behavior explicitly; (b) the Evidence
Table's "Other"/`unclassified` bucket description was reworded to "rendered whenever non-empty" (no
longer "always-rendered"); (c) the `submitSecretsFanOut()` citation was corrected from
"lines 851–876" to "lines 856–876" (verified: the function declaration is at line 856 in
`services/secretsService.js`); (d) FR-005(d)'s "one file per vault" ambiguity was reworded to "one
file per included environment; distinct environments may resolve to different vault paths"; (e) the
RBAC/residual-risk note required no PRD change (informational-only in Round 1) and none was made.

No new defect was introduced by this revision: I traced every changed FR/NFR/OQ/Test-Strategy/
Summary-Table cell against its cross-referenced counterparts (FR-002(f) vs. FR-004(c)/(f) vs. the
UX Status/Error-Handling table; FR-005(a.2) vs. FR-005(b); FR-003(b) vs. FR-005(b); the Classification
Matrix vs. the Summary Table's numeric counts; the footer's `fr_count`/`nfr_count` vs. the actual
9 FR/8 NFR headings in the body) and found all of them mutually consistent. The revision also did not
introduce any requirement, FR, or scope beyond what was needed to resolve the 8 Round 1 Blocking and
5 Advisory items (confirmed via `git diff` between the two PRD revisions — every changed hunk maps
directly to one of the 13 Round 1 findings; the one Risk-table row about diagnostic logging for
misconfigured bundle members that might look like new scope was already present, byte-identical, in
the Round 1 PRD version and was not touched by this revision).

<!-- CHALLENGER-VERDICT
feature: secrets-environment-bundles
round: 2
verdict: approved
blocking_count: 0
advisory_count: 2
-->
