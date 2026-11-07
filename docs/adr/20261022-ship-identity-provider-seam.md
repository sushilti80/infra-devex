# ADR: Entra→GitHub Identity Behind a Provider Seam (Default `none`, Fail Closed)

**Date**: 2026-10-22 | **Status**: Accepted for the seam; mechanism **open (H-2)** | **Feature**: `ship-from-repo`

## Context

The platform authenticates users with Entra ID (`{id: oid, email, roles[], groups[]}`); there is no GitHub login in the
token. Ship From Repo must list repos the **user** can read and prove the requester may read a repo before the platform's
GitHub App clones it (confused-deputy control, AC-016-1/-2). OQ-13 (which mechanism) is unresolved and must not be guessed.

## Decision

Introduce `ShipIdentityProvider` (`getLink`, `listAccessibleRepos`, `getRepoPermission`) selected by `SHIP_IDENTITY_PROVIDER`,
default **`none`** = fail closed (`REPO_NOT_ACCESSIBLE` with hint `IDENTITY_NOT_LINKED`, UI state S2). The requester login is
always server-set; `prepare` re-verifies it authoritatively with the single-repo token minted from the **existing Code App** (H-9 decided 2026-10-22; spec DD-15 — no separate Ship Reader App). Candidates: **A** GitHub App user-to-server
authorization (recommended — only option meeting the ≤15-call picker budget), **B** GHEC SAML external identity, **C** reviewed
identity map file (interim).

## Scope limits (updated after Round 1, A-4)

The seam isolates *list-time* behaviour only. Choosing **A** is **not** "mechanism-independent": it requires a browser-facing
contract (connect/callback/disconnect endpoints, signed `state` + PKCE, a sealed httpOnly Secure SameSite cookie holding the
user-to-server token — stateless backend, nothing in `sessionStorage` because the spec's own T11 makes it XSS-reachable —, and a
"Connect GitHub" CTA in S2). That contract is **deliberately not specified yet**: selecting A triggers a **spec delta and a
delta re-challenge** before Phase 4. B and C need no browser contract.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Guess a mapping (e.g. e-mail local part = GitHub login) | Spoofable/incorrect; confused-deputy risk. |
| Only trust the App's own access (no user check) | Any user could ship any repo the App can read. |
| Client-supplied login | Forgeable. |

## Consequences
Dev/QA proceed with the contract and a test double; every real ship fails closed until H-2 is answered; pilot/GA blocked on H-2.

## References
spec DD-4, §3.6.1, H-2, BT-04, E2E-06.
