# Feature Readiness Report: ship-from-repo

Date: 2026-10-22 (updated after human acceptance of QA-014 as L-2 with explicit QA waiver)
Branch / PR: `feature/ship-from-repo-prd` / PR #143 (not merged)
Orchestrator decision: **NO-GO** - the code-side QA gate is **waived by human decision** (QA-014 accepted as L-2 + QA waiver, product owner 2026-10-22), but the feature remains NO-GO on the **non-code gates** listed in section 8a (H-6, H-8, pilot H-items, V-gates, Wiz container-image scan, flag stays `false`). Mechanical `phase2` validator still returns `PHASE2_NOT_READY` because QA's own artifact says `fail`; the Orchestrator does not edit or reinterpret it.

## 1. Governing artifacts

| Item | Path | Gate evidence |
|---|---|---|
| PRD | `docs/prd/ship-from-repo.md` | `prd` validator `PRD_VALID`/CONTINUE |
| PRD Challenger reviews | `docs/reviews/ship-from-repo-prd-review-round{1..4}.md` | R1 changes_requested, R2/R3/R4 escalated to human; approved after human-authorized extra rounds (per product owner) |
| Architecture spec | `docs/architecture/ship-from-repo-spec.json` / `.md` | `spec` validator `SPEC_VALID`/CONTINUE (status field `ready_for_challenger`, see waiver W-1) |
| Deep-dive / ADRs | `docs/architecture/ship-from-repo-architecture.md`, `docs/adr/20261022-ship-*.md` | — |
| Approved architecture review | `docs/reviews/ship-from-repo-arch-review-round3.md` | verdict `approved`, 0 blocking, 5 advisories. `review --round 3` validator = `ESCALATE/EXTRA_ROUND_REQUIRES_HUMAN` **by design** (rounds >2); continuation authorized by explicit human decision (D-1) |

## 2. Explicit human decisions and waivers (recorded, not created by the Orchestrator)

| ID | Date | Decision (product owner) |
|---|---|---|
| D-1 | 2026-10-22 | Round 3 architecture review is human-authorized and the spec is treated as the approved implementation contract. |
| W-1 | 2026-10-22 | The post-Round-3 delta (commit `4b1a9c1`; H-9/H-10 + N3-A1..A5) leaves spec.json `status: ready_for_challenger`; no further Challenger round requested. Waiver quote: "I approve reasonable recommendation but keep it simple for initial implementation and reuse what we have". |
| H-9 | 2026-10-22 | Reuse existing Code Deployment GitHub App for `prepare` (single-repo, `contents:read`, short-lived). R-A6 accepted for devsand pilot; Z2 hygiene is the compensating control (V-12 still gates). |
| H-10 | 2026-10-22 | Reuse existing registry `sharedwus3acr2` with code-enforced `selfserve/<validated-app>` allowlist. R-A7 accepted for devsand pilot; ACR ABAC is post-pilot (HO-3). V-8 and WT-09b still gate. |
| D-3 | 2026-10-22 | One additional rework round authorized (final) after QA round 2 exhausted the automatic budget. No further rework rounds. |
| D-4 | 2026-10-22 | SRE directed to add a minimal Wiz CI workflow (`.github/workflows/wiz-scan.yml`) and run it for real instead of leaving the scan as a human action. |
| D-5 | 2026-10-22 | Narrow final rework authorized: QA-012, O-7 (if tiny), runtime-built credential fixtures (no Wiz ignore rules), QA delta, Wiz re-run. **No further rework.** |
| D-6 | 2026-10-22 | One-line QA-013 fix + QA delta authorized, nothing else; **L-1 (JSON-in-JSON nesting >=5 / >=8 backslashes not redacted) accepted by the human as a documented limit**; SRE re-scan skipped unless Wiz-relevant strings change. **No further rework.** |
| D-7 | 2026-10-22 | **QA-014 ACCEPTED as documented limit L-2 (alongside L-1) with an explicit human QA waiver** (product owner). Do not fix. L-2 = a multi-word secret that itself contains a double quote leaks the words after that quote when the log line is JSON inside a JSON string at nesting levels 2-4 (level 1 correct; pre-existing, not worsened by the QA-013 fix). L-1 = JSON-in-JSON nesting >=5 / >=8 backslashes not redacted (accepted earlier the same day). |
| D-2 (Orchestrator-resolved spec contradiction, needs human ack) | 2026-10-22 | Spec §5.1 says `devsand.features.shipFromRepo: true` but §2.4 G-FLAG/§11 forbid enabling before Phase 4 gates. Implemented as **`false`**. Flip to true is a human action after gates. |

No waiver exists for any skipped owner; none was skipped.

## 3. Phase 2 owner status

| Owner | Status | Artifact | Validator |
|---|---|---|---|
| Vue.js Developer (backend + frontend slices) | `complete` | `docs/readiness/ship-from-repo-dev-status.json` | `dev` → `DEV_COMPLETE`/CONTINUE |
| QA Engineer | **`fail`** in QA's artifact (round 5: QA-001..013 verified fixed; only open defect QA-014 LOW pre-existing) - **waived by human decision D-7** (QA-014 = accepted limit L-2; L-1 accepted). Artifact verdict unchanged by the Orchestrator. | `tests/results/ship-from-repo-results.json` | `qa` → `QA_FAIL`/STOP |
| SelfServiceInfra SRE DevOps | **`warn`** (not re-dispatched per human direction: the QA-013 diff is one regex line and no credential-shaped literals were added - QA's new fixtures are runtime-built; a `pull_request` Wiz run on HEAD `5635792` (run 39829018966) completed `success`, details not re-assessed by SRE. Last SRE-assessed scan at `068ba28`: criticals 0, highs 0, 1 INFO; Git Credentials HIGH gone; 4 library findings unlisted; image scan NOT run) | `docs/security/wiz-ship-from-repo-report.json` (+ `docs/security/ship-from-repo-sre-assessment.md`) | `sre` → `SRE_WARN`/CONTINUE (remediation plan preserved below) |
| Phase 2 aggregate | **NO_GO (mechanical)** | — | `phase2` -> `PHASE2_NOT_READY` (dev=complete, qa=fail, sre=warn), re-run 2026-10-22 after D-7: unchanged, as expected. The validator cannot consume a waiver; the only blocker it reports (QA `fail`) is the one waived by D-7. Mechanical `GO_ELIGIBLE` would require QA to update its own artifact. |

Stage history (rework budget = one round per stage, honored):
- Dev backend (`d6e0d8b`…`c734ce4`) → Dev frontend (`3ccce49`…`542d8db`) → QA round 1 `fail` (QA-001..007; `37dfe62`) → Dev rework round 1 (`a6fcdc8`, `afb3208`, `8f5b059`; QA-001..007 fixed) → QA round 2 `fail` (QA-001..007 verified fixed; **4 new defects QA-008..011**; `75b0bee`) → rework budget exhausted, escalated → SRE `fail` (`8d6bb4e`) → **human-authorized final rework round 2** (Dev `6bb6b88`, `5c0348f`, `8dca0ff`; QA-008..011 + SRE O-1..O-6 fixed) → QA round 3 `fail` (QA-008..011 verified fixed; **new LOW QA-012**; `8f21d02`) → SRE refresh + Wiz workflow (`56ad1ca`, `4fa6f58`, `6bc72af`, `06cf93d`) → `warn`. -> **final narrow rework round 3** (Dev `0268ff6`, `ea91c45`: QA-012 fixed, O-7 fixed, credential fixtures built at runtime) -> QA round 4 `fail` (QA-012/O-7/fixture verified; **new LOW QA-013**; QA also cleaned its own fixtures; `068ba28`) -> SRE re-scan (`177cafa`) `warn`. -> **one-line QA-013 fix** (Dev `d14279e`, `1b099b2`) -> QA round 5 `fail` (QA-013 verified fixed, L-1 unchanged, ReDoS linear; **new LOW pre-existing QA-014**; `5635792`). **Human then accepted QA-014 as L-2 with a QA waiver (D-7); no fix, no further rework.**

## 4. Executable evidence (QA-run, independent)

- Node project (QA round 5; QA-014 reproduction stays as a documented `it.fails`): 1316 run — 1315 passed, 0 failed, 1 expected-fail (QA-014 reproduction). The 20 live-server health specs passed this time only because a dev server (nodemon `node server.js`) was listening on :3001 (QA confirmed; pointing `API_URL` at an unreachable port restores the baseline 20 failed | 1 passed). They remain a known baseline issue and are not counted as feature evidence either way. The 20 failures are the pre-existing live-server tests (`tests/integration/api/health.spec.ts` 11, `tests/smoke/health.spec.ts` 9; ECONNREFUSED :3001), proven identical at baseline `4b1a9c1` and not counted against the feature. No in-scope failures.
- jsdom project: 794/794 passed (44 files).
- `npm run type-check`: exit 0.
- QA authored 543 adversarial tests (220 + 154 + 32 + 70 + 67 across rounds 1-5). Dev added 10 tests (rework 2) plus an O-7 test (rework 3).
- Fail-closed behavior verified: provider `none` → 403; flag false → 400 on `env`; `SHIP_WORKFLOW_REF` unset → 503; empty org allowlist/platform roles; `requireAuth` on all 9 ship routes and on `GET /aks-status-by-correlation/:correlationId` (B-5); card/page/Docs hidden with real `data/environments.json`.
- `gitleaks` over `main..HEAD`: no leaks (SRE). `npm audit --omit=dev`: 1 pre-existing high (`follow-redirects`), unrelated to this feature (supplementary, not a Wiz substitute).

### 4a. Wiz evidence (real CI runs; org-level secrets are visible to this repo)
- Workflow: `.github/workflows/wiz-scan.yml` (workflow_dispatch + pull_request on filtered paths, `contents: read`, pinned checkout SHA, wizcli 1.77.0 checksum-verified, `wizcli scan dir`, default service-account CI/CD policies, no pull_request_target, fork PRs skipped). `gh workflow run` now works on the branch.
- Earlier run 39813950967 (`6bc72af`): 1 HIGH "Git Credentials" in `tests/integration/service/shipUtils.spec.ts` (synthetic fixture).
- **Re-scan at HEAD `068ba28`:** runs 39823792502 (pull_request) and 39823849217 (workflow_dispatch), both exit 0, `WARN_BY_POLICY`. Secrets: **"No results found"** - the Git Credentials HIGH is **gone**, no new secret hits (incl. QA's spec files). Only finding: 1 INFO "PII/Name" in `docs/readiness/ship-from-repo-dev-status.json` (the sole reason for `WARN_BY_POLICY`). Libraries: still "(4 filtered)" with no severities exposed, so `highs: 0` is a listed-findings count, not a proven maximum. The workflow's jq line prints a misleading `HIGH:2` (counting artifact, also on clean runs; not used for the gate).
- Container-image scan (`wizcli docker scan`, policy `e8ef1254-673e-4761-9e85-303ff6a37f17`): **NOT run** - no Wiz credentials outside Actions on this machine. Human action.
- Gate held at `warn` (sand only): 4 library findings with no visible severity, image scan not done, verdict `WARN_BY_POLICY`. Remediation plan is in the SRE report.

## 5. NFR evidence (owner-produced artifacts only)

| NFR | Evidence | Status |
|---|---|---|
| NFR-001 build/e2e duration | none — requires aya-flux workflow + V-10/LT-03 | NOT_VERIFIED |
| NFR-002 API latency | caches/single-flight unit-tested (QA results `bt_coverage` BT-14/24); no latency measurement/LT | NOT_VERIFIED |
| NFR-003 credential separation | BT-05 passing (QA); aya-flux/OIDC side not assessable | PARTIAL (backend only) |
| NFR-004 input validation/injection | QA `shipQaHostile.spec.ts` (154 hostile cases) pass; workflow re-validation is aya-flux (WT-*) | PARTIAL (backend only) |
| NFR-005 build isolation | aya-flux WT-04b/05/08b/11b, §7.4 matrix, V-12 not run | NOT_VERIFIED |
| NFR-006 traceability | BT-21 backend; WT-09/WT-11 aya-flux not run | PARTIAL |
| NFR-007 auditability | BT-21 metrics/log events; duplicate-emission (QA-008/O-4) fixed and QA-verified round 3 | PARTIAL (aya-flux annotations/run-name not run) |
| NFR-008 reliability | dedupe/caps tested (QA-005/006 fixed); watchdog/SUPERSEDED/queuedBehind fixture-only until V-4 | PARTIAL |
| NFR-009 observability | SRE refresh: O-1..O-7 verified fixed (low residuals: O-7b production callers of `findPullRequestForBranch` pass no correlation id so its `github_api_call` carries `unknown`; O-8 per-process de-dup cache); Datadog log-based metrics/alerts R1–R11 are docs only, not created | PARTIAL |
| NFR-010 usability/a11y | FT-03/07 pass; FT-15 structural audit only (no axe-core); UX-01 not run | PARTIAL |
| NFR-011 scalability | BT-14/24 pass; LT-01 not run | PARTIAL |
| NFR-012 log hygiene | redaction defects QA-001..013 fixed and QA-verified (multi-word and single-word secrets, JSON-in-JSON nesting 1-4, linear time: worst 17 ms at 1 MB); **QA-014 = accepted limit L-2 (human, 2026-10-22)**: a multi-word secret that itself contains a double quote leaks the words after that quote at nesting levels 2-4; **L-1 accepted by human 2026-10-22** (nesting >=5 / >=8 backslashes); SR-01 not run | PARTIAL (L-1/L-2 accepted limits; SR-01 not run) |

## 6. What is implemented vs blocked

Implemented in this repo (committed + pushed, inert: flag `false`, identity provider `none`):
- Backend: `routes/ship.js` (endpoints 1–9), `shipService`, `shipStatusService`, `shipFailureClassifier`, `shipIdentityService` (`none` + test double), `shipId` (UUIDv7), `ttlSingleFlightCache`, `logRedactor`, `shipValidators`, `platformTeam`, `config.ship`, additive `githubService`/`aksService` helpers, `SHIP_*` env templates, `requireAuth`+ownership on legacy status route; V-3/V-4 paths behind `SHIP_GATE_V3_PASSED` / `SHIP_GATE_V4_PASSED` (default false).
- Frontend: nav/env/auth store changes, `stores/ship.ts`, `useShipPolling` (isolated commit `3dc3acd`), `shipRecentStorage`, 8 `components/ship/*`, `ShipFromRepoPage` states S0–S7, flag-gated home card, `?ship=` deep link across login, Docs section, `api.ts` ship client.
- Dev deviations on record (QA judged acceptable unless noted): extra 503 `SHIP_UNAVAILABLE`; `retry-config-pr` requires retrying user to have a linked identity (open Architect/H-2 item); redaction widened beyond §7.3 text (Architect ack pending, non-blocking); dedupe key = user + nine validated fields; frontend own plain-language failure copy; no "Connect GitHub" action until H-2; no server-side repo search (paste `org/name`).

NOT implemented here (blocked-on-human; see §7): all aya-flux work (workflow, scripts, environments, OIDC/Azure identities, GitHub App environment secrets, fixtures, V-gate evidence, runbook), real Entra→GitHub identity provider (H-2), ACR read client (H-3), preview host (H-1), platform role/org allowlist values (H-4/H-7). Handoff list: `aya-flux-ship-from-repo-handoff.md` (session files dir, outside the repo).

## 7. Blockers (owner → evidence)

| # | Blocker | Owner | Evidence | Gates |
|---|---|---|---|---|
| B1 | ~~QA `fail` (QA-014)~~ **RESOLVED BY HUMAN WAIVER (D-7, 2026-10-22, product owner)**: accepted as documented limit L-2, not fixed. QA's artifact still reads `fail`, so the `phase2` validator still says `PHASE2_NOT_READY`; the code-side gate is waived, not passed. | Product owner (decided) | `tests/results/ship-from-repo-results.json` (`QA-014`), section 2 D-7 | None (waived) |
| B2 | SRE `warn` follow-ups: (a) Security to confirm the 4 filtered library findings carry no high/critical (Wiz run link); (b) container-image scan (`wizcli docker scan --policy e8ef1254-...`, needs Wiz auth outside Actions - add an image job to `wiz-scan.yml` or run where auth exists) before any prod recommendation; (c) optionally make "Wiz directory scan" a required PR check. (The earlier Git Credentials HIGH is resolved.) | Security / SRE | `docs/security/wiz-ship-from-repo-report.json`, runs 39823792502, 39823849217 | Prod promotion (not sandbox pilot) |
| B3 | Low residuals: O-7b (pass the ship correlation id from `shipStatusService.getPr` / `aksService.getAppState` into `findPullRequestForBranch`), O-8 (per-process de-dup; SLIs use `count_unique(@correlation_id)`); Datadog log-based metrics/alerts R1-R11 to be created by SRE/Platform. | Vue.js Developer / SRE | `docs/security/ship-from-repo-sre-assessment.md` | NFR-009 completeness |
| B4 | **H-6** aya-flux ownership approvals | Platform Eng (aya-flux) | spec §2.3 | Phase 1 start (all aya-flux work) |
| B5 | **H-8** own `useShipPolling` vs extend `useWorkflowPolling` | PM / Challenger | spec §2.3, ADR `…-ship-own-polling-composable.md` | **Merge** of `useShipPolling` (Phase 3) |
| B6 | **H-1** CLUSTER_DNS_SUFFIX / http vs https | Platform Eng | spec §3.8 | FR-010 acceptance (Phase 4) |
| B7 | **H-2** Entra→GitHub login mapping (Option A needs spec delta + delta re-challenge) | Architect + Security + Platform Eng | spec §3.6.1 | Phase 4 pilot/GA, E2E; until then every ship fails closed |
| B8 | **H-3** ACR read or signed waiver; **H-4** platform role claim; **H-5** workflow ref (default fails closed on `main`); **H-7** org allowlist/App scope | Platform Eng / Security | spec §2.3 | Phase 4 pilot |
| B9 | **ASM-10** (PM confirm 24 h config retry window, AC-008-7 note), **ASM-11** (Platform Eng namespace list) | PM / Platform Eng | spec §2.2 | Phase 4 |
| B10 | V-gates V-1…V-12 evidence (esp. V-3 → `SHIP_GATE_V3_PASSED`, V-4 → `SHIP_GATE_V4_PASSED`, G-FLAG before `features.shipFromRepo=true`) | Platform Eng / Security / SRE | spec §2.4 | Enabling annotation path, watchdog, flag |
| B11 | Not-assessed SRE items: V-8, V-12, A-3 runner headroom, V-7, V-10, Datadog log-based metrics/alerts | per `not_assessed` in SRE report | `docs/security/wiz-ship-from-repo-report.json` | Pilot |
| B12 | `follow-redirects` 1.16.0 high advisory (pre-existing; 3-day SLA) | Dev / dependency owner | SRE report | hygiene |

## 8. Final decision

**NO-GO.**

Code-side gates (this repo): Dev = `complete`; QA = `fail` in QA's artifact with its only open defect (QA-014) **waived by the product owner** as accepted limit L-2 (D-7) and L-1 accepted; SRE = `warn` (sand-valid; remediation plan preserved; image scan not run). Final mechanical validators (2026-10-22): `dev` -> `DEV_COMPLETE`; `qa` -> `QA_FAIL`; `sre` -> `SRE_WARN`; `phase2` -> **`PHASE2_NOT_READY`** (dev=complete, qa=fail, sre=warn). The validator reports PHASE2_NOT_READY solely because QA's artifact says `fail`; that code-side gate is **waived by human decision, not passed**, and the Orchestrator did not edit QA's verdict.

### 8a. Non-code gates that keep this NO-GO (independent of the QA waiver)
1. **H-6** - aya-flux ownership approvals not given; **no aya-flux work exists** (workflow, scripts, environments, OIDC/Azure identities, Code App environment secret, fixture repos). The feature cannot run end to end without it.
2. **H-8** - own `useShipPolling` vs extending `useWorkflowPolling` undecided; gates merge of `useShipPolling` (Phase 3).
3. **Pilot gates** - H-1 (preview DNS suffix/http-vs-https), H-2 (Entra->GitHub identity; provider is `none`, every ship fails closed; Option A needs a spec delta + re-challenge), H-3 (ACR read or signed waiver), H-4 (platform role claim), H-5 (workflow ref; default fails closed on `main`), H-7 (org allowlist/App scope), ASM-10, ASM-11.
4. **V-gates V-1...V-12** - no evidence recorded (runbook not created); V-3 gates `SHIP_GATE_V3_PASSED`, V-4 gates `SHIP_GATE_V4_PASSED`; G-FLAG gates block enabling the feature.
5. **Wiz container-image scan** not run (Wiz directory scan: criticals 0, highs 0 listed, 1 INFO; 4 library findings with no visible severity pending Security review). Required before any prod recommendation.
6. **Feature flag stays `false`** (`data/environments.json` devsand `features.shipFromRepo`; D-2) - flipping it is a human action after G-FLAG gates pass.
7. NFRs largely PARTIAL/NOT_VERIFIED (NFR-001/-005 need aya-flux evidence, E2E, LT-*, SR-01, UX-01 not run).

The feature is inert in code (flag `false`, provider `none`). Phase 4 (Release Manager) was **not** dispatched: no merge/deployment evidence and nothing deployable.

Process note: the QA Engineer reported using `sed -i` once for a trivial fixture rename in its own test file (contrary to the edit-tool convention); content was verified by the subsequent test run and no production code was touched.

## 9. Next concrete human actions (all non-code)

1. Platform Eng: answer **H-6** and take over `aya-flux-ship-from-repo-handoff.md` (session files dir; self-contained brief of spec §3.4/§5.2/§6/§11).
2. PM/Challenger: decide **H-8** before `useShipPolling` merges.
3. Decide H-1, H-2 (Option A => Architect delta + delta re-challenge), H-3 (or sign waiver), H-4, H-5, H-7; PM confirm ASM-10; Platform Eng complete ASM-11.
4. Record V-1...V-12 evidence (create `docs/SHIP-FROM-REPO-RUNBOOK.md`); then, only with evidence, set `SHIP_GATE_V3_PASSED` / `SHIP_GATE_V4_PASSED` and (after all G-FLAG gates) `features.shipFromRepo=true`.
5. Security/SRE: confirm the 4 filtered Wiz library findings have no high/critical; run the container-image scan (`wizcli docker scan --policy e8ef1254-673e-4761-9e85-303ff6a37f17`, needs Wiz auth outside Actions) before any prod recommendation; optionally make "Wiz directory scan" a required PR check.
6. Acknowledge D-2 (flag stays `false`); Architect ack for widened log redaction and the `retry-config-pr` linked-identity deviation (#7, tied to H-2).
7. Dependency PR for the `follow-redirects` 1.16.0 high advisory.
8. Optional/later: if QA artifact should read `pass`, QA may record the waiver in its own artifact; O-7b (correlation id from production callers of `findPullRequestForBranch`); create Datadog log-based metrics/alerts R1-R11.
