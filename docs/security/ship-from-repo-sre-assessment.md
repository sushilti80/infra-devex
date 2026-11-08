# ship-from-repo — SRE/DevOps assessment (implemented slice) — REFRESH 2026-10-22

- Feature: `ship-from-repo` · Branch `feature/ship-from-repo-prd` · Re-scanned at HEAD `068ba28` (Dev `0268ff6` + QA `068ba28`); code observability last re-verified at `6bc72af`, O-7 fix taken from Dev `0268ff6` / QA verification (first assessment at `75b0bee`)
- Inputs: spec §3.9 / §7 / §8 / §11, `docs/readiness/ship-from-repo-dev-status.json` (`rework_round_2`/`3`), `tests/results/ship-from-repo-results.json` (QA r4: QA-012 and O-7 verified; new low QA-013 is QA-owned)
- Terminal artifact: `docs/security/wiz-ship-from-repo-report.json` — **gate `warn`** (Wiz directory scan at `068ba28`: verdict WARN_BY_POLICY, criticals 0, highs 0, 1 INFO; the former HIGH Git Credentials is gone; 4 library findings still unlisted; image scan still outstanding)
- Scope: observation only for product code. The only repo change by SRE is the new CI workflow `.github/workflows/wiz-scan.yml` and docs. Every code gap below is routed to the Developer.

## 0. Refresh summary
| Area | Previous | Now |
|---|---|---|
| O-1 `github_api_call` on Infra-App calls | ❌ missing | ✅ fixed (one low residual) |
| O-2 `ship_rate_limited{limit:user_misses}` | ❌ missing | ✅ fixed |
| O-3 `requestId` on status/cancel/retry logs | ⚠ partial | ✅ fixed |
| O-4 duplicate `ship_succeeded/failed` (QA-008) | ⚠ open | ✅ fixed in code (per-process de-dup only; SLIs keep `count_unique`) |
| O-5 `ship_stage_completed.duration_ms` semantics | ⚠ cumulative | ✅ fixed — real stage duration, omitted when unknown (judged acceptable, see §1) |
| O-6 QA-009/010/011 | ⚠ open | ✅ fixed; residual QA-012 (LOW) escalated to the human |
| O-7 `findPullRequestForBranch` `github_api_call` | ❌ missing (low) | ✅ fixed in `0268ff6` via `_infraCall` (QA verified at `068ba28`); low residual: production callers pass 3 args, so correlation id is `unknown` (see §1) |
| Wiz gate | `fail` — not run | `warn` — dir scan at `068ba28`: criticals 0, highs 0, 1 INFO (HIGH Git Credentials removed); libraries unlisted; image scan not run |

## 1. Observability: spec vs. implemented code (re-verified by SRE against code at `6bc72af`)

Metrics are `logger.logMetric(event, fields)` → Winston JSON log lines (`event`, `correlation_id` (snake_case, mapped from `correlationId`), `requestId` (camelCase, passed through), extras, plus `service/env/version`). They are **log events, not StatsD metrics**; Datadog log-based metrics/facets must be created from them (see §3).

| Spec §3.9 item | Code evidence | Status |
|---|---|---|
| `ship_started` (POST) | `shipService.js:259` (`correlationId, requestId, env, app, repo`) | ✅ |
| `ship_stage_completed` | `shipStatusService.js:557` `emitStageMetrics` (stage, state, `duration_ms`) | ✅ (O-5 fixed) |
| `ship_failed{code}` / `ship_succeeded` + duration | `:567-568` `emitMetrics`, de-duplicated by `markOnce(cid,…)` on the `flags` cache | ✅ (O-4 fixed; per process) |
| `ship_rate_limited{limit}` | start caps `shipService.js:167` (`user_active/user_hourly/global_active/global_hourly/github`) **and** `shipStatusService.js:617` (`user_misses`, with `correlationId`, `requestId`, `actor_oid`) | ✅ (O-2 fixed) |
| `ship_authz_denied` | `:663` (`action`, `actor_oid`, `requestId`) | ✅ |
| `ship_watchdog_cancel` | `:675` (`run_id`, `actor_oid`, `requestId`) | ✅ (flag off by default) |
| `ship_annotation_rejected{reason}` | `:106`, `:587` (warn) | ✅ |
| `ship_run_lookup_pages` (alert p95>3 / page 5) | `:140` field `pages`; `level=warn` at page 5; cache-miss lookups only | ✅ |
| `[correlationId]` prefix + `requestId` | start/dispatch-error/route-error/cancel/retry/watchdog-failed logs all pass `{requestId}`; route passes `req.correlationId` into status, logs, cancel, retry | ✅ (O-3 fixed) |
| Per-correlation GitHub call counts (`github_api_call`) | `githubService.js:1760 _infraCall` wraps `listWorkflowRuns`, `listJobsForRun`, `listJobAnnotations`, `downloadJobLogs`, `cancelWorkflowRun`; fields `operation, repo, duration_ms, success, correlation_id, status_code`; level `warn` for 4xx, `error` for 5xx/network; callers pass the real `cid` (`shipStatusService.js:131,152,156,674,724`, `shipService.js:285`) | ✅ (O-1 fixed, residual below) |
| Workflow-side correlation (run-name, OCI label, PR body) | flux-config, outside this repo | not assessed |
| Log redaction | `utils/logRedactor.js` on the logs endpoint (`redactText`) and failure-classifier lines (`redactLine`); QA round 3 verified QA-009/010/011 fixed; residual QA-012 | ✅ with open LOW QA-012 |
| Health/readiness | No ship code touches `/health` or the container `HEALTHCHECK`; ship config is read at call time and fails closed | no impact |

### O-1..O-6 verdicts (SRE independent code verification)
| ID | Verdict | Evidence / judgement |
|---|---|---|
| O-1 | **FIXED** (low residual) | All five named Infra-App calls emit `github_api_call` on success and failure with the correlation ID. Residual (low, Developer) — now addressed, see O-7: `findPullRequestForBranch` (`githubService.js:~1823`, cached 15 s per env/app, called from `shipStatusService.js:398`) previously bypassed `_infraCall`; it now emits via `_infraCall` (`0268ff6`). Dashboard note: routine 404/410 on `downloadJobLogs` (log not ready) is recorded as `success:false, level:warn, status_code:404`; any success-rate or error-budget query over `github_api_call` MUST exclude `@status_code:(404 OR 409 OR 410 OR 422)` or filter `level:error`. |
| O-2 | **FIXED** | `recordMiss` emits `ship_rate_limited{limit:user_misses}` right before the 429 (`:617`). It is emitted on every rejected request after the threshold (>30 misses/min/user), so alert on a count threshold or distinct `@actor_oid`, not on "any". |
| O-3 | **FIXED** | `requestId` is propagated route → service → status for start, status, logs, cancel, retry, authz-denied, miss-cap and watchdog. By design `ship_stage_completed/ship_succeeded/ship_failed/ship_annotation_rejected/ship_run_lookup_pages` are emitted from the shared status cache (one compose serves several requesters), so they carry `correlation_id` but not `requestId`; join through `correlation_id`. Start-cap `ship_rate_limited` has neither (no ship ID exists yet). |
| O-4 | **FIXED in code** | Fresh-ID miss markers moved to their own `freshMarks` cache (`:58`, `:629`), so a lookup flood can no longer evict the de-dup flags in `flags` (`markOnce`, `:74`). Caveats: de-dup is per process (a multi-replica deployment or restart can still re-emit once per replica) and `flags` is a 2000-entry bounded cache (≈250 ships/day at ~8 keys each; the start cap of 12/h = 288/day is just at that limit). **SLI rule retained as defence in depth: always `count_unique(@correlation_id)`, never raw event counts.** |
| O-5 | **FIXED — acceptable for dashboards/SLIs** | `duration_ms` is now `completedAt − startedAt` of the stage from GitHub's own step/job timestamps (`stageDurationMs`, `:551`); the field is **omitted** (undefined) when GitHub provides no timestamps (queued, preview/rollout stages). Judgement: omission is the right choice — emitting 0 or a fabricated value would corrupt percentiles, while an absent attribute is ignored by Datadog measures. Requirements for consumers: (1) compute stage latency only over `@duration_ms:*` (exists), grouped by `@stage` and filtered `@state:succeeded` so failed-fast stages do not skew p95; (2) do not alert on stage-latency absence — a stage with no timestamps is expected; (3) the overall ship duration SLI uses `ship_succeeded.duration_ms` (= sum of run durations, `durationSec`, which excludes queue time between runs), not the sum of stages; (4) the config_pr/preview stage has no duration and must not appear in latency panels. Note `ship_succeeded/ship_failed.duration_ms` is `(durationSec||0)*1000`, so a ship with no timing data reports 0 — exclude `@duration_ms:0` from percentile queries. |
| O-6 | **FIXED; residual QA-012 escalated** | QA round 3 verified QA-009/010/011 (escaped-quote JSON secrets, glued quoted tails, per-line fail-closed on huge lines). QA-012 (secrets nested ≥3 JSON-escaping levels are not redacted, LOW) is NOT SRE-owned and is with the human; alert R6 (5xx on `/api/ship/logs/*`) stays as the availability guard. |

### Open observations (not blockers; route to Developer)
| ID | Sev | Finding | Owner |
|---|---|---|---|
| O-7 | **FIXED** (low residual) | `findPullRequestForBranch` now emits `github_api_call` through `_infraCall` (Dev `0268ff6`; QA-verified at `068ba28`). Observed by QA: production callers pass 3 arguments, so live PR-lookup `github_api_call` metrics carry correlation id `unknown` until a caller passes it. Consequence for dashboards: PR-lookup quota is now visible but not attributable per ship; group such panels by `operation` and do not join them on `correlation_id`. Low residual for the Developer in a later round, not this one. | Developer |
| O-8 | low | `flags` de-dup cache is 2000 entries/per process; consider raising or documenting a per-replica expectation. SLIs already de-duplicate. | Developer / SRE |

## 2. SLIs / SLOs (provisional — require product-owner confirmation before use as policy)

| SLI (decision it drives) | Query basis | Provisional SLO |
|---|---|---|
| Ship completion success, excluding user-attributable codes (go/no-go for widening the `shipFromRepo` flag) | `count_unique(@correlation_id){event:ship_succeeded}` / (`ship_succeeded` + `ship_failed` where `@code` not in user-fix codes) | ≥ 90 % / 28 d during pilot (assumption A) |
| API availability of `/api/ship/*` (non-5xx) (rollback trigger) | existing `api-health` dashboard filtered `@http.url_details.path:/api/ship/*` | ≥ 99.5 % / 28 d |
| Run lookup cost (protects GitHub quota; spec NFR) | `ship_run_lookup_pages` p95 | ≤ 3 (spec) |
| Trusted-result integrity (security signal) | count `ship_annotation_rejected` | 0 sustained; any is investigated |
| GitHub quota cost per ship (protects the Infra-App rate limit; spec NFR ≤3 pages / bounded calls) — NEW, enabled by O-1 | `count{event:github_api_call @correlation_id:<id>}` grouped by `@operation`; errors = `@success:false` **excluding** `@status_code:(404 OR 409 OR 410 OR 422)` (routine) | p95 calls/ship ≤ N set after the first pilot week (assumption B); error share < 1 % / 28 d |
| Stage latency by stage (capacity / queue planning; replaces the old cumulative misreading) — NEW, enabled by O-5 | p50/p95 `@duration_ms` of `event:ship_stage_completed @state:succeeded` by `@stage`, only where `@duration_ms:*` exists | observe only during pilot (assumption B); no SLO until 4 weeks of data |

Assumption A: pilot target is SRE-proposed, not in the spec. Assumption B: thresholds cannot be derived until real traffic exists (V-10 is `not_assessed`).

## 3. Alert rules (documentation only — not deployed; no dashboard JSON added)

No `docs/dashboards/` JSON was added: dashboards auto-deploy to the Datadog org on merge to `main`, the ship metrics only exist once log-based metrics/facets are created, and nothing could be validated against the sand Datadog API here. Prerequisite for all rules: create facets `@event`, `@correlation_id`, `@requestId`, `@pages`, `@code`, `@limit`, `@reason`, `@operation`, `@success`, `@status_code`, `@duration_ms`, `@stage`, `@state`, and a distribution log-based metric on `@pages` for `event:ship_run_lookup_pages`. Refresh impact: R4 widened, R9/R10/R11 added; R1–R3, R5, R7, R8 unchanged; R6 note updated.

| # | Rule (logs query → condition) | Severity | Runbook action |
|---|---|---|---|
| R1 | `event:ship_run_lookup_pages` p95(`@pages`) > 3 over 30 min, **or** any `@pages:5` (`level:warn`) | page | cap-bypass signal (fixture-CI/direct dispatches uncapped, WT-14); check start caps `SHIP_MAX_STARTS_PER_HOUR`; flip `features.shipFromRepo=false` if runaway |
| R2 | `event:ship_annotation_rejected` count > 0 in 15 min | ticket (page if `@reason:runs_identity_mismatch` repeats) | possible spoofed/malformed trusted result; inspect `@reason` + correlation ID |
| R3 | `event:ship_failed @code:UNKNOWN` count > 0 in 1 h | ticket | trusted-result missing → workflow/annotation regression (V-3) |
| R4 | `event:ship_rate_limited @limit:(github OR global_*)` ≥ 3 in 15 min | ticket | GitHub quota pressure or pool saturation; see A-3. (`user_*` start-cap breaches and `user_misses` are separate: R9) |
| R5 | `event:ship_authz_denied` > 20 / 10 min per `@actor_oid` | ticket | probing of other users' ships |
| R6 | 5xx on `/api/ship/logs/*` > 1 % / 15 min | ticket | former QA-009 RangeError class (fixed); keep as the availability guard for the logs endpoint and for QA-012-class regressions |
| R7 | Weekly reconciliation: `ship_started` unique `correlation_id` count vs. workflow runs for `ship-from-repo.yaml` (RC-01) | weekly report | mismatch ⇒ lost dispatch or run-name regression |
| R8 | `event:ship_watchdog_cancel` > 0 while `SHIP_GATE_V4_PASSED` ≠ true | page | flag misconfiguration; cancel must be off until V-4 |
| R9 (new, O-2) | `event:ship_rate_limited @limit:user_misses` ≥ 5 in 10 min, or ≥ 2 distinct `@actor_oid` in 15 min | ticket (page if > 100 / 15 min) | DD-14 unknown-ID enumeration / abusive polling of non-existent ship IDs; inspect `@actor_oid`, `@requestId`, the user's source; the 429 itself already throttles, so this is detection, not mitigation |
| R10 (new, O-1) | `event:github_api_call level:error` (5xx / network) count ≥ 5 in 10 min, or `@success:false` share excluding `@status_code:(404 OR 409 OR 410 OR 422)` > 5 % in 15 min, by `@operation` | ticket (page if `@operation:listWorkflowRuns` since status would degrade for all ships) | GitHub outage / Infra-App auth or rate-limit failure (`@status_code:(401 OR 403)` ⇒ App permission/key issue; check the GitHub App) |
| R11 (new, O-1) | per-ship fan-out: `event:github_api_call` count per `@correlation_id` > 60 in 15 min | ticket | runaway polling or cache bypass (cache TTLs in `shipStatusService.js`); correlates with R1 |

Caveat for R10: `github_api_call` is a pre-existing event also emitted by other GitHub paths (`getFileContent`, `triggerWorkflow`, `createMultiFileCommit`, `getRepoTree`); scope ship rules to the five ship `@operation` values (`listWorkflowRuns, listJobsForRun, listJobAnnotations, downloadJobLogs, cancelWorkflowRun`) so the other features' errors do not page the ship owner. The existing `docs/dashboards/dependency-health.json` widgets query StatsD-style metrics (`github_api_duration_ms`, `github_api_requests_total`) that the app does not emit; the log events above do not feed them. No dashboard JSON is changed here; a follow-up should create log-based metrics from `github_api_call` before any dashboard consumes it.

Rollback (spec §11): set `features.shipFromRepo=false` in `data/environments.json` / config; existing images, PRs and apps are unaffected.

## 4. Pipeline and Docker impact
- **New: `.github/workflows/wiz-scan.yml`** (SRE-added, commits `56ad1ca`, `4fa6f58`, `6bc72af`): minimal Wiz directory scan. Triggers: `workflow_dispatch` and `pull_request` on `services/** routes/** srcV2/** utils/** package*.json Dockerfile` (no `pull_request_target`; fork PRs are skipped because they get no secrets). `permissions: contents: read`; `actions/checkout` pinned to the full SHA `3d3c42e5…` (v7.0.1); wizcli 1.77.0 downloaded from `downloads.wiz.io` and verified against sha256 `609ce7bb…` (same pin as `docker-infra-live`); `wizcli auth` and `wizcli scan dir .` with credentials only via masked env; a non-gating AUDIT pass lists warn hits; nothing is uploaded (JSON stays in `/tmp`). The job fails on a Wiz BLOCK policy hit. Policy choice: no `--policy` flag, so the service account's default CI/CD policies apply (this run evaluated `example-iac-cicd`, `example-eol-policy-deny`, `example-vb-policy-deny` and the Default policies). Policy `e8ef1254-673e-4761-9e85-303ff6a37f17` is the `docker-infra-live` template policy used with `wizcli docker scan` (container-image type); it is the reference for a future image-scan job, not applied to a directory scan. Image scan is not included.
- `Dockerfile`: unchanged; release stage already copies `routes/ services/ middleware/ utils/ data/ config.js`; no new npm dependency (`uuid ^11.1.1` already declared, lock 11.1.1); no new build args.
- `.pipeline/self-service.yaml`: push-trigger path filters already cover every changed product path; PR trigger is Dockerfile-only (pre-existing). No edit made.
- New `SHIP_*` runtime vars (documented in `.env.example`, no secrets) have fail-closed defaults; `features.shipFromRepo` is `false` in `data/environments.json`, so the deploy is inert until enabled.
- Secrets: `gitleaks detect --log-opts main..HEAD` — no leaks at first assessment; the repo pre-commit gitleaks hook ran on every SRE commit (passed). Wiz Secrets scanner flags one HIGH Git-credentials pattern in the synthetic fixture `tests/integration/service/shipUtils.spec.ts` (false positive, see §5).
- Pre-existing, unrelated: `npm audit --omit=dev` shows 1 high (`follow-redirects` 1.16.0). `package.json`/`package-lock.json` carry unrelated uncommitted edits in the working tree and were not touched or staged.

## 5. Wiz gate — `warn` (sand)
The credentials ARE available to Actions: `WIZ_CLIENT_ID`/`WIZ_CLIENT_SECRET` are org-level (not repo-level) secrets and are visible to this repo's runs (`wizcli auth` → "Authenticated successfully."). The new workflow ran three times on PR #143:

| Run | Head | Result |
|---|---|---|
| https://github.com/organization/self-service-infra/actions/runs/39813443894 | `56ad1ca` | success, `Verdict: WARN_BY_POLICY` (default BLOCK-only output: "No results found", filtered: Libraries 4, Sensitive data 1, Secrets 2) |
| https://github.com/organization/self-service-infra/actions/runs/39813679187 | `4fa6f58` | failure — my workflow defect (`--by-policy-hits=BLOCK,AUDIT` invalid; value must be one of `DISABLED|BLOCK|AUDIT`); wizcli exited before scanning; fixed once in `6bc72af` |
| https://github.com/organization/self-service-infra/actions/runs/39813950967 | `6bc72af` | success, exit 0, `WARN_BY_POLICY`; AUDIT pass lists: Secrets HIGH "Git Credentials" in `tests/integration/service/shipUtils.spec.ts` (synthetic redaction-test fixture, false positive); Sensitive data INFO PII/Name in `docs/readiness/ship-from-repo-dev-status.json` |

### Re-scan at `068ba28` (2026-10-22, after Dev `0268ff6` and QA `068ba28`)
| Run | Trigger | Result |
|---|---|---|
| https://github.com/organization/self-service-infra/actions/runs/39823792502 | `pull_request` (PR #143 head) | success, exit 0, `WARN_BY_POLICY`; Secrets: "No results found"; Sensitive data: 1 INFO PII/Name in `docs/readiness/ship-from-repo-dev-status.json`; Libraries 4 filtered. PR check `Wiz directory scan` = pass |
| https://github.com/organization/self-service-infra/actions/runs/39823849217 | `workflow_dispatch` (`gh workflow run wiz-scan.yml --ref feature/ship-from-repo-prd`; accepted, no error) | identical result |

The HIGH "Git Credentials" in `shipUtils.spec.ts` is **gone**, and QA's `shipQaRedaction.spec.ts` / `shipQaRound2Redaction.spec.ts` produce **no** Secrets match (no PEM/userinfo/JWT-shaped hit). The workflow's generic jq tally still prints `HIGH:2`; it is a known artifact of nested metadata (it prints the same in the clean runs) and is not used for the gate.

Gate (sand, non-prod): listed criticals **0**, highs **0**, info 1. The contract formula on listed findings alone would give `pass`; **judgement: hold at `warn`** because (a) the 4 "Libraries (filtered)" findings (likely including the pre-existing `follow-redirects` high) have severities the CLI does not expose, so `highs=0` is the minimum confirmed count; (b) the **container-image scan has not been run** — it was not attempted from this workstation because no Wiz service-account credentials exist locally (only Actions via org-level secrets), so nothing was faked; (c) the run verdict is still `WARN_BY_POLICY` (INFO sensitive-data). A prod gate would fail on any high and requires the image scan. Remaining actions: (1) SRE/Security add or run an image-scan job (`wizcli scan container-image`, policy per `docker-infra-live` convention); (2) Security opens the Wiz Cloud Event link to confirm the 4 library findings' severities; (3) dependency PR for `follow-redirects` and the Wiz library findings. Re-scan: re-run `wiz-scan.yml` after any further product-code change; `pass` needs the image scan clean and library severities confirmed non-high/critical.

Earlier-run history (superseded): run `39813950967` (`6bc72af`) listed the HIGH Git Credentials fixture match (highs=1, `warn`).

## 6. Not assessable now (`not_assessed`)
| Item | Why | Owner |
|---|---|---|
| V-8 flux-config ACR write-guard (DD-16/WT-09b) and `ship-publish` OIDC | flux-config workflow/ACR outside this repo | Platform Eng lead (flux-config) + Security |
| V-12 Z2 hygiene canary on `ubuntu-latest` | needs the workflow and runner pod | Security + Platform Eng |
| A-3 `ubuntu-latest` pool headroom (publish + nested config run) | needs runner-pool capacity metrics | SRE + runner-pool owner |
| H-1 devsand preview DNS suffix/scheme | decision not recorded (backend returns `not_configured`) | Platform Eng (flux-config) |
| V-7 pinned `wizcli` behaviour in the flux-config ship `scan` job | the job is in flux-config; this repo's workflow shows wizcli 1.77.0 exits 0 on WARN_BY_POLICY and `--by-policy-hits` takes one value | SRE + Security |
| V-10 cold-cache timings, `BUILD_TIMEOUT` derivation | needs the workflow on the runner pool | SRE |
| Wiz container-image scan | not executed; workflow is `scan dir` only | SRE + Security |
| Datadog log-based metrics/alerts for `ship_*` and `github_api_call` | no Datadog API access / sand validation here | SRE (needs `DD_API_KEY`/`DD_APP_KEY`) |

## 7. Readiness
**PASS-WITH-WARN for sand (gate `warn`)**; **not sufficient for prod**. Observability O-1…O-7 are fixed in code (low residuals: O-7 correlation id `unknown` on PR-lookup metrics until callers pass it, and O-8; QA-012 verified fixed by QA). Wiz directory scan at `068ba28` completed with no critical, no high listed and no BLOCK hit (only 1 INFO); the unlisted library findings and the outstanding image scan keep this a `warn`, not a `pass`. No blocker for sand with `features.shipFromRepo=false`.
