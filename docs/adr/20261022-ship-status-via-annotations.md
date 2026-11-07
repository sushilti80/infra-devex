# ADR: Ship Status Is Read From Run-Name and Check-Run Annotations (Hardened Channel)

**Date**: 2026-10-22 | **Status**: Accepted (pending Architecture Challenger approval) | **Feature**: `ship-from-repo`

## Context

The backend is stateless and the repository is the database. Workflow **inputs, job outputs and `$GITHUB_STEP_SUMMARY` are not
exposed by the Actions REST API**, so the PRD's "read the inputs/summary" needs a retrievable channel. Annotations
(`GET /check-runs/{job_id}/annotations`) are retrievable, cheap (1 call per completed job, immutable) and need no new
infrastructure. Round-1 review showed the naive form is forgeable: the runner executes any `::notice title=ship.result::…`
line printed by any step, so repo- or Wiz-derived text echoed by a trusted job could spoof results; and gating on a
substring of Wiz output can be satisfied by a hostile package name.

## Decision

1. `run-name` carries identity fields (`cid`, `app`, `env`, `repo`, `by`, `oid`, `mode`, `retry_by`), strict regex, built only from validated inputs.
2. Each trusted **stage** emits **exactly one** `ship.result` annotation from a dedicated emit step (`emit-result.sh`) — one per stage tag, not one per job: `prepare` and `scan` jobs carry one each; the `publish` job carries one per stage tag it owns (`publish`, then `config`), i.e. two in `mode=full` and one (`config`) in `mode=config_only` (N-1). The emit steps are separate from the work steps so a failed work step still yields a failure annotation. Payload built with `jq -n --arg`/`jq -c`, **base64url-encoded** (no `%`, CR, LF or `:` in the message), form `ship.result.v1:<stage>:<b64url>`; ≤4 KB raw.
3. Any step that echoes untrusted text runs through `emit-untrusted.sh`: strips ESC/CR, neutralises `::` and `##[`, and wraps output in `::stop-commands::<random>` … `::<random>::` (token generated at runtime, never in logs).
4. **Consumer validation** (`shipStatusService`): only the check run of the expected trusted job; exactly one `ship.result` annotation **per expected stage tag** (≥2 with the same tag ⇒ tamper ⇒ that stage's result discarded, failure `UNKNOWN`, never success; a tag not expected for the job/mode is ignored); strict base64url + JSON parse with size cap; `v:1`; `stage`, `cid`, `runId`, `runAttempt` must equal the resolved run's; schema with unknown fields dropped; format checks (`digest`, semver, sha); `ok:true` is accepted **only if the step group that produced that stage concluded `success`** — the job conclusion for `prepare`/`scan`, the `Publish:` work steps (1–4) for stage `publish`, the `Config PR:` work steps (6–9) for stage `config`, groups matched by **exact step names** (not a prefix) and the stage's own `Emit:` step must also have concluded `success` (N3-A4; a step skipped by `if:` is `skipped`, never `success`, N3-A3; annotations can downgrade, never upgrade); failure `code` must be in the stage's allowed set.
   *Why per step group (N-1):* `publish` runs the image steps and the config-PR steps in one job, so a failed config step concludes the job `failure`. Judging `ok:true` by job conclusion would discard a genuine `publish` result and leave no image-bearing run for `retry-config-pr` (AC-008-7). `continue-on-error` on the **config** steps was rejected: it changes the job's fail-fast semantics and hides failures from the Actions UI (the one exception is the housekeeping `Publish: cleanup` step, which is `continue-on-error: true` so its failure cannot skip the config group, N3-A2). The fold's image-bearing run `I` is defined from the `publish`-stage annotation + `Publish:` group (spec §3.5).
5. The **Wiz gate does not use text**: pass requires `wizcli` exit status 0 **and** a JSON verdict parsed with `jq -e` from the CLI's structured output file (field path pinned by V-7). Anything else fails closed.
6. Build-job annotations are display hints (escaped, ≤300 chars), never decisions.
7. Fallback if V-3 fails: per-stage `ship-result-<stage>.json` artifact + zip reader (adds a dependency; changes §3.5/§4.3/BT-11).

## Alternatives considered

| Option | Why rejected |
|---|---|
| Job summary / outputs | Not retrievable via REST. |
| Artifacts for all stages | Extra download + zip dependency per stage; a compromised build can overwrite run artifacts (kept only as fallback). |
| Backend-side state (DB/Redis/Blob) | Violates "GitHub as database"/stateless; new infra. |
| HMAC-signed payloads | Needs a shared secret in the backend and workflow; the structural controls above remove the forgery path without key management. Revisit if V-3 shows annotation injection is still possible. |
| Percent-encoding only | Defends the command syntax but not duplicate/forged annotations; base64url + single-annotation-per-stage rule covers both. |
| Judge `ok:true` by whole-job conclusion | Breaks the `CONFIG_PR_FAILED` → `retry-config-pr` path (N-1); replaced by per-step-group validity. |

## Consequences

- **Positive**: no new infrastructure; 1 call per completed job; forged text cannot become a decision.
- **Negative**: reliance on annotation retention/readability (V-3 hard gate); `emit-untrusted.sh` discipline must be enforced by lint (WT-13) and review.
- Tests: BT-11 (forgery matrix), WT-08b, WT-11b, §7.4 cases 8, 10–12.

## References
spec DD-3, §3.2 rule 4, §3.4 `scan`/`emit-result`, §3.5 "Trusted results", §4.5, T9/T19; architecture doc §3.
