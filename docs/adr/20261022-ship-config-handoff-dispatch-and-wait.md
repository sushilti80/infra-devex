# ADR: Config Hand-Off by Dispatch-and-Wait From Inside `publish`

**Date**: 2026-10-22 | **Status**: Accepted (pending V-1) | **Feature**: `ship-from-repo`

## Context

After an image is published, the existing flux-config flow must run: `generate-webapp-config.yaml` opens PR
`auto/gen-<env>-<app>` using `secrets.SVC_GITHUB_TOKEN` (not `GITHUB_TOKEN`), which fires `preview-on-pr`. A PR opened with
`GITHUB_TOKEN` would not trigger `pull_request` workflows, so the ship pipeline must keep that credential property. It must
also never lower an existing PR's `image_tag` (AC-008-6), i.e. the config step must sit inside the per-app serialised section.

## Decision

`publish` (which holds `concurrency: ship-<app>`, `cancel-in-progress: false`) runs `gh workflow run generate-webapp-config.yaml
--ref <fluxBranch>` with `GITHUB_TOKEN` (`actions: write`; `workflow_dispatch` is exempt from the no-recursion rule), waits for
that run (poll every 10 s, ≤10 min, early "config run not started" signal after 3 min), then resolves the PR by head branch.
The config workflow's own `SVC_GITHUB_TOKEN` step opens the PR, so `preview-on-pr` fires exactly as for `POST /api/aks-deploy`.
A retry (`mode=config_only`) re-dispatches the **ship** workflow (same correlation ID), preserving serialisation.

## Alternatives considered

| Option | Why rejected |
|---|---|
| `workflow_call` of the config workflow | The called job cannot live inside the `publish` job → outside the serialised section (downgrade race); forces `secrets: inherit` of `SVC_GITHUB_TOKEN`. |
| Un-awaited dispatch | Same downgrade race; no way to report `CONFIG_PR_FAILED`. |
| Backend dispatches config after reading ship success | Needs a worker/state (DD-1) and breaks browser-closed resilience. |

## Consequences

- `publish` holds one `ubuntu-latest` slot while waiting for a job that needs another slot on the same pool (the config workflow is `runs-on: ubuntu-latest`). Under saturation N waiting `publish` jobs can starve their own config runs until the 10-min timeout → correlated `CONFIG_PR_FAILED` (A-3). Mitigations: global active-ship cap (`SHIP_MAX_ACTIVE_GLOBAL`, default 10) below pool size minus headroom (runbook), early-signal at 3 min, LT-01 saturation case, retry via `config_only`.
- Verified by V-1 (extended: the `deploy-preview` run used the shipped tag) before the flag is enabled.

## References
spec DD-2/DD-10, §3.4 `Config PR:` steps, WT-10, LT-01, R-A2.
