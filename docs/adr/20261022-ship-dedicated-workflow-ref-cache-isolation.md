# ADR: Ship Workflow Runs From a Dedicated Protected Ref (Actions-Cache Isolation, Fail-Closed Default)

**Date**: 2026-10-22 | **Status**: Accepted (pending Architecture Challenger approval; ref choice is **H-5**) | **Feature**: `ship-from-repo` | **Spec**: DD-11

## Context

`ship-from-repo.yaml` runs an untrusted `build` job (Zone Z4: user code on a GitHub-hosted VM). That VM holds
`ACTIONS_RUNTIME_TOKEN`, which can write Actions caches scoped to the ref the run was dispatched on. A cache written in
**default-branch scope** can be restored by any other workflow in `flux-config` that uses `actions/cache` or a setup-action
`cache:` input. If ship were dispatched on `main`, a compromised build could therefore poison a cache consumed by a trusted
workflow (user code → platform workflow escalation) — a path that Z4 isolation inside the build cannot close.

Round-1 evidence (2026-10-22): none of the 16 `flux-config` workflow files on `main` used `actions/cache` or a `cache:` input,
so the surface is empty today. It would not stay empty without a guard.

## Decision

1. **Dedicated protected ref.** `SHIP_WORKFLOW_REF` is **required** configuration; the design default is a protected ref used
   only by the ship workflow. GitHub environments `ship-prepare`, `ship-scan`, `ship-publish` restrict deployment branches to
   that ref, so a dispatch on any other ref fails at the environment gate (gate **V-11**).
2. **Fail closed in the backend.** If `SHIP_WORKFLOW_REF` equals `config.aks.fluxBranch` (the default branch), the backend refuses
   to dispatch and the page shows the S2-style "temporarily unavailable" state, **unless** `SHIP_ALLOW_DEFAULT_REF=true` is set
   explicitly (a Security waiver recorded in the runbook).
3. **Keep the cache surface empty.** CODEOWNERS plus a `no-actions-cache` lint in flux-config forbid `actions/cache` and setup-action
   `cache:` inputs in every workflow. The ship `build` job never uses a cache itself.
4. **Human gate H-5** (Security / Platform Eng) confirms the ref and the V-11 outcome before the feature flag is enabled
   (Phase 4 security sign-off).

## Alternatives considered

| Option | Why rejected |
|---|---|
| Dispatch on `main`, rely on "no workflow uses a cache today" | The guarantee is accidental and unenforced; any future cache adoption silently opens the path. Only allowed with an explicit waiver (`SHIP_ALLOW_DEFAULT_REF`). |
| Clear/disable Actions caches for the repo | Breaks legitimate caching for other flux-config workflows now or later; does not protect against a cache written and restored within a single run window. |
| Run `build` in a separate repository | Strong isolation but needs a second workflow home, artifact hand-off across repos and another identity; deferred as a hardening option, not required if the ref + lint controls hold. |

## Consequences

- **Positive**: closes the build→trusted-workflow cache path with config + lint, no new infrastructure; fail-closed if misconfigured.
- **Negative**: flux-config needs a protected ref to maintain (merge/promotion discipline for the ship workflow) and a CI lint; a dedicated ref can drift from `main` unless promoted deliberately.
- **Depends on**: H-5 (ref choice), V-11 (verification), H-6 (flux-config ownership of the lint/CODEOWNERS).
- **Tests / gates**: V-11, hostile-matrix case 7 (§7.4), backend config-validation test (fail-closed default).

## References

spec DD-11, §1.3 (evidence), §2.4 (V-11), §3.2 (trust zones), §7.4 case 7; deep-dive `ship-from-repo-architecture.md` §4a;
ADR `20261022-ship-trust-zones-and-untrusted-build-isolation.md`.
