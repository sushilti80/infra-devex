# PRD Challenger Review: kong-api-self-service (Round 2)
Date: 2026-07-22
PRD: docs/prd/kong-api-self-service.md

## Verdict
escalate_to_human

## Blocking Findings

- [ ] **Round 1 Finding #4 (incorrect `_fetchDataFile()` citation) is only partially resolved — FR-008(c) still contains the corrected-elsewhere error** — The PM's revision correctly fixed Section 4's Evidence Table (now explicitly states `_fetchDataFile()` only reads `data/` static config and does not read `docs/metadata/`) and correctly fixed Section 8's "New Service Layer Methods" table (`getKongServices`/`getKongService` now described as "mirroring the `getInstalledApps()` pattern"). However, **FR-008's own acceptance criterion (c)** was not updated and still reads: "Metadata is readable by `infrastructureService.getKongServices(environment)` (new method) **which follows the same pattern as existing `_fetchDataFile()`**." This is the exact same incorrect citation the Round 1 finding was about, now contradicting the corrected Section 4 and Section 8 tables within the same document. An implementer reading FR-008 in isolation (a very plausible path, since FRs are the primary implementation reference) would still be pointed at the wrong existing method. **Fix**: Update FR-008(c) to read "...which follows the same pattern as existing `getInstalledApps()` (not `_fetchDataFile()`, which only reads static `data/` config files)" — matching the language already corrected in Section 4 and Section 8.

## Advisory Findings

None beyond those already carried from Round 1 (not re-litigated per Round 2 scope).

## Round Context

Of the 7 Round 1 Blocking findings, **6 are fully resolved** and **1 remains open** (partially fixed):

1. **Contradictory duplicate-handling (FR-001f vs NFR-REL-002)** — ✅ Resolved. FR-001(f) now splits into explicit (i) Conflict (HTTP 409, payload differs) and (ii) Idempotent retry (HTTP 200, payload identical) cases, cross-referenced from NFR-REL-002, which now states the matching rule and includes integration-test criteria for both branches.
2. **Self-contradictory FR-002(d) ("no active traffic" >0 vs ==0)** — ✅ Resolved. Now correctly reads "P95 request count in the last 5 minutes == 0" with an explicit override path (`force_delete: true`) when traffic is non-zero.
3. **Undefined metrics source for FR-002(d) traffic check** — ✅ Resolved. Now names the Kong Konnect Vitals API explicitly, ties it to the FR-005 service-account token, and adds a v1 descope-to-manual-confirmation caveat if Vitals API access isn't confirmed by Phase 3.
4. **Incorrect evidence citation (`_fetchDataFile()` vs `getInstalledApps()`)** — ⚠️ **Not fully resolved.** Section 4 and Section 8 were corrected, but FR-008(c)'s acceptance criterion still cites `_fetchDataFile()` verbatim, reintroducing the exact contradiction within the same PRD. See Blocking Finding above.
5. **Classification Matrix agent-dispatch contradiction** — ✅ Resolved. Classification Matrix now explicitly states v1 uses the dedicated `/api/kong/*` REST namespace for all mutations, with the `kongConfig` agent entry deferred to v2; no FR references `/api/agent-change`.
6. **NFR-SCALE-001 unachievable target** — ✅ Resolved. Split into a warm-cache primary target (≤2s P90) and a cold-cache secondary target (≤10s P90), with an explicit strategy note preferring a git-tree batch fetch over N individual file reads and a requirement for a loading skeleton during cold-cache load.
7. **FR-004(d) unlisted Key Vault dependency** — ✅ Resolved. FR-004(d) now states the hard prerequisite explicitly, defines the failure path (workflow fails with a descriptive error directing the team to the Custom Infrastructure wizard), and a new Assumption A7 (with owner) was added and cross-referenced in FR-004's Dependencies field.

**New defect assessment**: No new defect was introduced by the revision beyond the incomplete application of the Finding #4 fix described above — the revision correctly touched two of the three locations that needed updating (Section 4, Section 8) but missed the third (FR-008(c)), leaving an internal inconsistency. This is judged as the original Finding #4 remaining open rather than a wholly new defect, since it is the same citation error the PM was asked to fix, left in a third location.

<!-- CHALLENGER-VERDICT
feature: kong-api-self-service
round: 2
verdict: escalate_to_human
blocking_count: 1
advisory_count: 0
-->
