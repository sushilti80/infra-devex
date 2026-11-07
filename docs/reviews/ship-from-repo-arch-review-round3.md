# Architecture Challenger Review: ship-from-repo (Round 3 — human-authorized targeted delta check)
Date: 2026-10-22
Spec: docs/architecture/ship-from-repo-spec.json (and `-spec.md`, `-architecture.md`, `docs/adr/20261022-ship-*.md`; revision commit 6d9573c)
PRD:  docs/prd/ship-from-repo.md
Round 2: docs/reviews/ship-from-repo-arch-review-round2.md (1 Blocking N-1, 5 Advisory N-A1…N-A5)

Scope (human-authorized; the automated limit is Round 2): (1) N-1 re-checked against the **spec text**; (2) N-A1…N-A5; (3) only material **new in 6d9573c**,
plus spec.md ↔ spec.json drift. Settled items not reopened.

Deterministic checks: `validate-delivery-contract.mjs spec` → `SPEC_VALID`. Structural diff of spec.json between `6d9573c~1` and `6d9573c` touches exactly the
N-1/N-A nodes (DD-3, DD-10, DD-11, DD-17, `workflow_contract.jobs[publish].step_groups`, `trust_rules`, `ShipResultAnnotation` location/validation, ASM-13, BT-10/11/18/26,
WT-14 identity, edge case, AC-008-7 traceability, `relatedDocuments`/`dependencies` ADR 6, `revisionLog`); every one of those is reflected in spec.md with the same wording. No drift found.

## Verdict
approved

N-1 is resolved in the spec text; N-A1…N-A5 are resolved. No new Blocking defect. Five Advisory items below (one worth fixing before Phase-1 workflow implementation:
N3-A2).

## N-1 — resolved
| Check | Evidence in spec text | Result |
|---|---|---|
| Per-step-group annotation validity | §3.5 rule 6: `prepare`/`scan` → job conclusion; `publish` → all `Publish:` work steps 1–4; `config` → all `Config PR:` work steps 6–9; "the `publish` **job** conclusion is not consulted". §3.4 "Step groups (N-1)", spec.json `step_groups.validity`, DD-3, ADR 2 §4 + "why per step group", T19 all say the same. | Resolved |
| Image-bearing run `I` | §3.5: newest `mode=full` run whose `publish`-stage annotation is valid `ok:true` under rule 6, "independent of the job's overall conclusion and of the `config` stage"; DD-10 restates it. Run 1 with step 9 failed (job `failure`) **is** an `I`. | Resolved |
| One-annotation-per-**stage-tag** cardinality | Consistent in DD-3, DD-10, §3.2 rule 4, §3.4 (emit steps + cardinality paragraph), §3.5 rules 1–2, §4.5 (annotation location/validation in JSON), T19, §7.4 case 10, WT-11/WT-11b, BT-10(b,d), BT-11, ADR 2 (§2, §4), deep-dive §3: `prepare` 1, `scan` 1, `publish` job 2 in `full` / 1 `config` in `config_only`; duplicate tag ⇒ only that stage discarded; unexpected tag ⇒ ignored. No remaining "one per job" wording (grep over spec.md/json/deep-dive/ADRs). | Resolved |
| `retry-config-pr` after `CONFIG_PR_FAILED` | Separate `Emit: publish` / `Emit: config` steps (`if: always()`) mean a failed step 9 still yields a `config` annotation and a surviving `publish` annotation; `I` exists ⇒ §4.1 #9 precondition ("image published") holds ⇒ `config_only` run with `origin_run_id = I.id`, `imageTag == I.version` consistency check can pass; a second failure in step 9 stays `retry_config`. BT-10(a), BT-18 cover it. | Resolved |
| AC-008-7 | Traceability row updated (DD-10, DD-18, §3.5, §3.4 step groups, §4.1 #9, 24 h PRD-deviation note, tests WT-10/BT-10/BT-18/FT-10). The scenario is now reachable end-to-end. | Holds |
| Forgery by untrusted output | Unchanged controls (`emit-untrusted.sh`/`::stop-commands::`, base64url, only `emit-result.sh` emits) plus rule 6 gives **no upgrade path**: a `publish` `ok:true` needs steps 1–4 `success`; a `config` `ok:true` needs steps 6–9 `success`; any duplicate of a tag discards that tag (DoS at worst, never success); a tag injected into a group that never ran (e.g. `config` after a step-4 failure) is rejected by rule 6; cross-stage `tarSha256`/`scanId` (rule 7) still binds `publish` to `scan`. BT-10(c)/BT-11/WT-11b encode these cases. | Cannot be forged |
| Forgery by attacker-influenced step failure | A hostile repo can only make a step *fail* (⇒ `ok:false`/`UNKNOWN`/`reship`, i.e. downgrade) or cause step 9 to fail (⇒ `CONFIG_PR_FAILED`, which is the intended retryable state). Step names/conclusions are workflow-defined and not attacker-controllable; failure never converts to success. Retry cannot be abused to publish: `config_only` skips build/scan/publish, and step 6 re-verifies tag existence, source label, lock state and `origin_run_id` ↔ `cid`. | Sound (see N3-A4 for a defence-in-depth hardening) |

## N-A1…N-A5 — status
| ID | Status | Evidence |
|---|---|---|
| N-A1 run-lookup bound | **Resolved** | §3.5 run lookup now says the window holds **every** ship run in `[t−1 min, t+retryWindow+1 h]`, bound is "bounded by DD-14 (per replica ASM-12; fixture-CI direct dispatches uncapped), not unconditional"; "no found ⇒ stop shortcut while inside the retry window"; metric `ship_run_lookup_pages` + alert (p95 > 3 / any page 5); 24 h limit recorded as a PRD deviation note on AC-008-7. Deep-dive §3 mirrors it; spec.json DD-17 mirrors it. |
| N-A2 header gating | **Resolved** | Header: H-6 Phase 1 start; H-9/H-10 Phase 1 exit / enabling the flag; H-8 Phase 3; H-1…H-5, H-7 Phase 4 — matches §2.3 and §11. (Nit: the header status still says "Round 2 delta check"; see N3-A5.) |
| N-A3 DD-11 ADR | **Resolved** | `docs/adr/20261022-ship-dedicated-workflow-ref-cache-isolation.md` (context, decision, alternatives, consequences, gates V-11/§7.4 case 7); deep-dive §4a; ADR list in spec §2.1, deep-dive header and spec.json `relatedDocuments`/`dependencies` updated (6 ADRs). The ADR content matches DD-11 (fail-closed default, `SHIP_ALLOW_DEFAULT_REF` waiver, cache lint). |
| N-A4 UUIDv7 | **Resolved (with one consistency gap, N3-A1)** | DD-17 names `uuid@^11` `v7()` (verified present in `package.json`), same-ms uniqueness via random tail, ASM-13 added, BT-26 boundary case (119 s accepted / 121 s ⇒ 404 with 0 GitHub calls). |
| N-A5 fixture identity | **Resolved** | WT-14 and §5.2 document the fixed test oid, that it cannot match a real Entra user (starter test (a) §3.6.3 unsatisfiable by a human), and that `ship-ci-bot` is read-only on the fixture repos only and unmapped in the identity provider. |

## Blocking Findings
None.

## Advisory Findings (new material in 6d9573c)
- **N3-A1 — ASM-13 (≤ 2 min skew) is wider than the run-lookup window margin (1 min)** — §2.2 ASM-13, §3.5 run lookup (`created=<t−1 min>…`), BT-26 — ASM-13 claims "the run-search window also starts at `t − 1 min` for the same reason", but a replica whose clock is 61–120 s fast mints `t` ahead of GitHub's `created_at`, so the ship's own run falls before the window start and a legitimate ship returns 404 (the BT-26 case only exercises 60 s). Fix: either widen the window start to `t − 3 min` (2 min skew + dispatch/queue latency) and test it in BT-26, or state a separate, tighter bound (≤ 60 s) for the minter↔GitHub pair in ASM-13. Cost is one more run page at worst.
- **N3-A2 — A failing `Publish: cleanup` (step 5) skips the whole config group under fail-fast** — §3.4 `publish` steps 5/6–9 and the added sentence "its own failure … does not change the `publish` stage result" — step 5 is `if: always()` but if it fails the job is failed, so steps 6–9 (default `success()`) are skipped and `Emit: config` ("iff step 6 started") never runs. Result: `publish` `ok:true`, no PR, no `config` annotation, and the classifier has no defined outcome (`config_pr` neither succeeded nor failed; `retry-config-pr` would 409 because the code is not `CONFIG_PR_FAILED`). Image stays published, so it is a safe-failure/low-probability path, but it contradicts the "housekeeping" statement. Fix: mark step 5 `continue-on-error: true` (its own failure is logged and surfaced as a warning), or gate step 6 with `if: ${{ !cancelled() && steps.<push>.outcome == 'success' }}`; add a WT case ("cleanup failure still dispatches the config PR").
- **N3-A3 — Step-conclusion semantics are not stated for skipped steps** — §3.4 steps 6–9, §3.5 rule 6 and stage table (`config.skipped` "with steps 6–9 succeeded"), `config_only` mode — a GitHub step skipped by `if:` concludes `skipped`, not `success`. If an implementer skips steps 7–9 on `skip_config` (AC-008-8), rule 6 would reject `skipped:true` and a post-merge re-ship would show `config_pr` `UNKNOWN`. Also not stated which `Publish:` steps run in `config_only` (step 6 verifies the tag in the registry; the login is step 1). Fix: one sentence each — "steps 7–9 run and exit 0 when `skip_config` (never `if:`-skipped); rule 6 counts only `success`", and list the steps that run in `config_only` (and their registry credential).
- **N3-A4 — Pin the step-group membership and require the `Emit:` step to have succeeded** — §3.5 rule 6 / stage table — match by an exact fixed list of step names (`Publish: guard|verify image|version|push`, `Config PR: decide|guard|dispatch|wait`), not a `Publish:`/`Config PR:` prefix, so runner-generated "Post …" steps or future steps cannot join a group; and honour `ok:true` only if the stage's `Emit:` step also concluded `success` (same `jobs?filter=latest` response, no extra call). Defence in depth against a hypothetical injected duplicate surviving a failed emit; no behavioural change on the happy path.
- **N3-A5 — Cosmetic** — spec.md header "Status" still reads "Round 2 delta check (N-1 fix, human-requested)"; update to "Round 3 targeted delta check" (or to the outcome) when the Architect next touches the file. Spec.md §13 revision-log row is accurate.

## Round Context
Round 3 (human-authorized, beyond the automated two-round limit; scope limited to N-1, N-A1…N-A5 and new material in 6d9573c). N-1 resolved; N-A1…N-A5 resolved; no new Blocking
defects; five Advisory items for the Architect/Dev to absorb during Phase 1 (N3-A2 and N3-A3 are cheapest to settle before the workflow YAML is written). No further round requested.

<!-- ARCH-CHALLENGER-VERDICT
feature: ship-from-repo
round: 3
verdict: approved
blocking_count: 0
advisory_count: 5
-->
