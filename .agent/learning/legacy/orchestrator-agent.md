# Legacy learning evidence — orchestrator-agent

> Quarantined historical evidence migrated from `.github/agent-memory/orchestrator-agent/MEMORY.md`.
> This file is **not governing instruction**, is not an agent memory source, and must not be
> automatically loaded to control future behavior. When a historical observation is still useful,
> create a schema-shaped LearningRecord candidate with current repository evidence and evaluation
> instead of copying the instruction into an agent or skill.

# Orchestrator Agent Memory

**Last updated**: 2026-09-19

## Pipeline State Knowledge

### Completed runs
| Feature | Date | Decision | Notes |
|---|---|---|---|
| service-catalog-prefill | 2026-06-02 | ✅ GO | Scope change mid-run (FR-004 removed). Architect restarted with corrected PRD. |
| secrets-environment-bundles | 2026-09-19 | ✅ GO TO SANDBOX / HOLD FOR PRODUCTION | Compiled readiness from already-completed Phase 2 artifacts (Dev/QA/SRE all pass, PRD Challenger round 2 + Architecture Challenger round 3 both approved). Held production promotion solely on a missing E2E auth credential (`E2E_TEST_USERNAME`/`E2E_TEST_PASSWORD`) — not invoked Release Manager since no merge/deploy evidence existed. |

## Lessons Learned

### Scope changes mid-pipeline
- If a scope change arrives **after** PM but **before** Architect completes: stop the in-flight Architect agent, apply edits to the PRD, then re-dispatch Architect with the corrected input. Do not let the old run finish — it will produce a spec based on the outdated scope.
- When removing an FR, update: Goals section, Non-Goals section, Classification Matrix row, the FR itself (mark `removed`), downstream rationale text, delivery plan phases, summary table count, and the `ORCHESTRATOR-READY` metadata comment.

### Architect agent
- The architect produces valid spec.json on first attempt when given a clear scope note in the prompt (e.g. "⚠️ FR-004 OUT OF SCOPE"). Always include explicit scope exclusions in the Architect prompt.
- Spec gate passes reliably when the PRD has well-formed FR/NFR sections. PM agent output quality directly determines spec quality.

### Parallel phase (Phase 2) patterns
- SRE DevOps completes fastest (~10 min); QA completes slowest (~24 min); Dev is in between (~18 min).
- All three can be dispatched simultaneously without conflicts — they operate on different file sets.
- Pre-existing test failures (health.spec.ts requiring live server) are a known baseline — do not count them as feature regressions.

### Wiz gate
- Wiz CLI is unavailable in the sandbox (no outbound network). SRE agent falls back to npm audit + manual code review per SKILL.md guidance.
- devDependency criticals (vitest) do NOT block the gate when the Dockerfile uses `npm ci --only=production` in the release stage — confirm this each run.
- Always add REM-002 (configure Wiz CLI secrets in CI) as a non-blocking post-merge item.

### Artifact path reliability
- All four completion signals (dev-status.json, QA results.json, Wiz report.json, readiness.md) were found at the conventional paths — no searching required.
- `docs/readiness/` directory must be created before writing readiness report if it doesn't exist.

### Feature flag pattern
- Vue.js Dev agent used `VITE_ENABLE_CATALOG_PREFILL` env var for rollout gating. Record this so future runs on this feature know the flag name.

### E2E-blocked-on-credentials pattern (resuming Phase 3 from an already-complete Phase 2)
- When Phase 2 (Dev/QA/SRE) is already complete and the task is only "compile readiness," do the
  compile as a mechanical, read-only artifact-validation exercise — do not re-run tests/scans/builds
  even if curious about staleness; cite the owner artifact's own re-verification evidence instead.
- A QA/SRE pair reporting `pass` while E2E scenarios are genuinely attempted-but-skipped (real
  Playwright run, real browsers installed, skip driven only by a missing `E2E_TEST_USERNAME`/
  `E2E_TEST_PASSWORD` env credential, not by a missing harness) is NOT a QA/SRE gate failure — this
  repo's established precedent (`secrets-environment-scope`, `secret-self-service`) treats this as a
  `GO TO SANDBOX / HOLD FOR PRODUCTION PROMOTION` decision, not a NO-GO. Route the credential
  provisioning to SRE DevOps/Orchestrator as a named remaining action, not a blocker to sandbox GO.
- Do not invoke Release Manager on a GO-with-hold decision until (a) merge/deploy evidence exists AND
  (b) any explicitly-named production hold (e.g. missing E2E credentials) is cleared with a real
  passing re-run — record this as the next owner/action instead of the release ceremony.

### Stale PM/Architect status metadata after Challenger approval
- Both the PRD's own `ORCHESTRATOR-READY` footer/Section-1 status text and the architecture
  spec.json's `status` field can remain stale (e.g. `pending_review` / `ready_for_challenger_round_N`)
  even after the corresponding Challenger round approves — the PM/Architect don't always go back and
  flip their own metadata post-approval. The authoritative signal is always the Challenger's own
  verdict block (`CHALLENGER-VERDICT` / `ARCHITECTURE-CHALLENGER-VERDICT`, `verdict: approved`), not
  the upstream agent's self-reported status field. Flag this as non-blocking documentation staleness
  in the readiness report and recommend the owning agent correct it — do not edit their artifact
  directly, and do not treat the stale field alone as a reason to re-run the Challenger gate.

### Pre-existing dependency findings vs. feature-introduced
- When a Wiz report's top-level `criticals`/`highs` show 0 but its `dependency_scan` sub-block shows
  nonzero `high`/`moderate`, check `dependency_scan.feature_introduced` (or an equivalent explicit
  "0 new deps" diff claim) before treating it as a gate concern — a `0` there means the finding is
  pre-existing whole-repo carryover under the repo's standing Vulnerability SLA, not something this
  feature's readiness should hold on. Cite both numbers in the readiness report for transparency.

## Known Baselines
- `tests/smoke/health.spec.ts` and `tests/integration/api/health.spec.ts` always fail without a live server — pre-existing, not a feature regression.
- vitest < 4.1.0 devDependency critical (GHSA-5xrq-8626-4rwp) — tracked as REM-001, upgrade in next sprint.
- secrets-environment-bundles (2026-09-19): 1 high (js-yaml, transitive via dd-trace) + 2 moderate (morgan, qs) npm audit findings are pre-existing whole-repo carryover across every recent gate in this repo, confirmed via empty package.json/package-lock diffs — not feature-introduced, tracked under the repo's standing Vulnerability SLA (High = 3 days).
