# ADR: Five Trust Zones and Untrusted-Build Isolation for Ship From Repo

**Date**: 2026-10-22 | **Status**: Accepted (pending Architecture Challenger approval) | **Feature**: `ship-from-repo`

## Context

Ship From Repo executes **arbitrary user code** (Paketo buildpack lifecycle, build scripts of any repo) and then publishes
the result to the private registry that runs on AKS. The platform's self-hosted runner pool (`ubuntu-latest`) holds broad
credentials (every pod is injected with `ARM_CLIENT_SECRET`, `GH_APP_PRIVATE_KEY`, an SSH key and a pre-existing `az`
login). Nothing in this codebase previously ran user-supplied code.

## Decision

Split the pipeline into five trust zones (spec §3.2): Z0 browser, Z1 backend, Z2 `prepare`/`publish` (trusted, self-hosted,
never runs user code), Z3 `scan` (GitHub-hosted, only parses the tar, Wiz credentials via OIDC), Z4 `build`
(GitHub-hosted throwaway VM, `permissions: {}`, no secrets/OIDC/environment, runs user code).

Rules adopted with the zones:

- Trusted jobs never read `needs.build.outputs.*`; trusted→trusted data uses job outputs only; the single artifact a trusted
  job consumes is the image tar after SHA-256 equality and structural validation.
- Trusted jobs treat repo/image-derived **text** as untrusted (workflow-command injection; see ADR `ship-status-via-annotations`).
- Steps touching attacker bytes on Z2 run under the **Z2 hygiene wrapper** (`env -i`, no global/system git config, https-only,
  token via `GIT_ASKPASS` file, no SSH) — spec §3.2.1; **the existing Code App** (the code-deployment App) is reused by `prepare` to mint a single-repo, `contents:read` + `metadata:read`, short-lived token (H-9, decided by the product owner 2026-10-22; its key is held as a `ship-prepare` environment secret — accepted residual risk R-A6, compensating control = the hygiene wrapper; DD-15).
- Two Azure OIDC identities plus one read-only: `ship-scan` (Key Vault read) and `ship-publish` (registry AcrPush on the existing `exampleregistry`, push target limited to `selfserve/<validated-app>` by a **code-enforced allowlist** in `publish`, DD-16 / H-10 decided 2026-10-22; registry-wide AcrPush is the accepted residual risk R-A7); plus a read-only `ship-prepare` identity (registry read) used only by the ownership step, kept because AC-016-3 requires the check in `prepare` and no existing identity can serve it without weakening the untrusted-bytes boundary (spec DD-19).

## Alternatives considered

| Option | Why rejected |
|---|---|
| Build on `ubuntu-latest` in a container | User code on a runner holding broad ambient credentials; docker-in-pod exposure. |
| Single job, single identity | A parser bug on an untrusted tar would yield registry write. |
| Build in ACR Tasks | Not in current platform footprint; new service and cost; kept as a future option behind the same contract. |
| Reuse the code-deployment Code App key in flux-config | **Originally rejected, now ACCEPTED for the devsand pilot (product owner, 2026-10-22, H-9).** The key is not read-only (only the minted token is down-scoped to one repo, `contents:read` + `metadata:read`), so storing it in an flux-config environment widens its exposure; the product owner judged a new Ship Reader App too heavy for the pilot and accepted the residual risk (R-A6) with the Z2 hygiene wrapper as compensating control. A dedicated Ship Reader App (HO-1) and runner group (HO-2) remain documented post-pilot hardening options. |
| Registry-side repository scoping (ABAC) or a separate registry for `ship-publish` | **Deferred, not a Phase-1 blocker (product owner, 2026-10-22, H-10).** The existing `exampleregistry` is used with registry-wide AcrPush; a code-enforced `selfserve/<validated-app>` allowlist in `publish` (negative test WT-09b, gate V-8) is the guard; the residual risk (R-A7) is accepted for the pilot; ABAC is the recommended follow-up (HO-3). |

## Consequences

- **Positive**: compromise of user code is contained to a credential-less throwaway VM; a tar-parser bug in Z3 yields only Wiz Key Vault read; no new GitHub App or registry to operate.
- **Negative**: four jobs and three OIDC identities to operate; cold-cache builds (no shared cache by design); file-level ambient credentials on shared pods and the Code App key in an flux-config environment are **accepted** residual risks (R-A6, H-9) mitigated only by the hygiene wrapper until HO-1/HO-2; registry-wide AcrPush on `ship-publish` is an accepted residual risk (R-A7, H-10) mitigated by the code guard until HO-3.
- **Cost of reversal**: high — contracts (run-name, annotations, environments) assume the split.

## References
`docs/architecture/ship-from-repo-architecture.md` §2, spec §3.2/§3.2.1/§7.1, tests WT-04b/WT-05/WT-09b, gates V-8/V-12.
