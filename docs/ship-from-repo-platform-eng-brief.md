# Ship from Repo: Platform Eng decision brief

**Ask:** answer **H-6** so flux-config work can start. Then settle the pilot items H-1 to H-5, H-7 and H-8.
**Feature:** a user with limited platform knowledge picks a GitHub repo and branch in the portal. The platform builds it with Cloud Native Buildpacks, scans it with Wiz, pushes a semver image to `exampleregistry`, and opens the flux-config config PR with a preview URL.
**State:** the portal and backend slice is built, but the feature is off (`features.shipFromRepo=false`) and every ship fails closed. Nothing exists in flux-config yet.
**Pilot scope:** devsand only. Direction from the product owner: keep it simple and reuse what exists.

**Source of truth:** `docs/architecture/ship-from-repo-spec.md` on PR #143 (branch `feature/ship-from-repo-prd`).
**Full flux-config work brief for your agent:** the spec's §3.4 (workflow contract), §5.2 (file list) and §6 (identities).

## 1. H-6: the one decision that blocks all flux-config work

Do you approve these **additive** changes in `organization/flux-config`? Nothing merges until you answer.

| # | Change | Risk |
|---|---|---|
| 1 | Add `run-name` to `generate-webapp-config.yaml` and `generate-agent-config.yaml`. No behaviour change. | Low |
| 2 | New workflow `ship-from-repo.yaml`, `workflow_dispatch` only, with helper scripts under `.github/scripts/ship/`. | Medium: it handles untrusted repo content |
| 3 | CODEOWNERS entries for the ship workflow, scripts, aliases file and lint. | Low |
| 4 | New `no-actions-cache` lint workflow. | Low |
| 5 | Three GitHub environments: `ship-prepare`, `ship-scan`, `ship-publish`. | Medium: each is an OIDC subject |
| 6 | `ship-fixtures-ci.yaml` plus ~14 private `ship-fixture-*` repos and a read-only `ship-ci-bot`. | Low |

**Design points to review**
- **Untrusted code runs only on `ubuntu-latest`.** The build job has `permissions: {}` and no secrets. It never runs on `ubuntu-latest`.
- **`ubuntu-latest` runs two jobs, `prepare` and `publish`.** These touch attacker-controlled bytes (a repo clone and an image tar). Compensating controls are a scrubbed environment (`env -i`, git config disabled, token via a file) and tar validation. The pool's ambient credentials remain. The product owner has accepted this risk for the devsand pilot (R-A6).
- **Registry:** the existing `exampleregistry`. The `publish` job can only push to `selfserve/<validated-app>`. The code enforces this, but the OIDC identity has registry-wide AcrPush. The product owner accepted that for the pilot (R-A7). ACR repository-scoped ABAC is a post-pilot follow-up.
- **GitHub Apps:** no new App. It reuses the Code App, with a token scoped to one repo, plus the Infrastructure App with `Checks: read` added.

**Needed from you:** `Approved`, `Approved with changes: <list>`, or `Rejected: <reason>`, plus the owner who will review the flux-config PRs.

## 2. Pilot decisions (H-1 to H-5, H-7). Proposed answers, please confirm or override

| ID | Question | Proposed answer | Who |
|---|---|---|---|
| **H-1** | What is `CLUSTER_DNS_SUFFIX` on devsand, and is the preview host http or https? The ingress has `tls: []`, so http is likely. The suffix is not in git. | Run `kubectl get cm cluster-config -n flux-system -o yaml` on devsand and paste the value. Until then the UI shows the PR link without a preview URL. Blocks only the preview-URL acceptance test. | Platform Eng |
| **H-2** | How does an Entra user map to a GitHub login? | **Option A**, GitHub App user-to-server authorization. It is the only option that meets the repo-picker call budget. It needs a small spec addition and one more architecture review pass before the pilot. If you want to avoid that for now, say so, and Architect will propose B or C. | Architect, Security, Platform Eng |
| **H-3** | Can the backend read ACR (network path and AcrPull on `selfserve/*`) to pre-check app ownership? | **Waive for the pilot.** Ownership is still enforced in `prepare`, about 1 to 2 minutes into the run. The only loss is an instant HTTP 403 from the API. The waiver needs the Security reviewer and the Platform Eng lead to both sign it. | Platform Eng and SRE, plus the two signers |
| **H-4** | Which Entra app role or group object ID identifies platform-team members? They can see and manage other users' ships. | Name the role (preferred) or group ID. If left empty, nobody qualifies, which is a safe default. | Platform Eng |
| **H-5** | Run the ship workflow from a dedicated protected ref, or from `main`? | **Use `main` for the pilot** (`SHIP_ALLOW_DEFAULT_REF=true`) with the `no-actions-cache` lint and CODEOWNERS. No flux-config workflow on `main` uses `actions/cache` today. Security signs off after gate V-11 passes. A dedicated ref is post-pilot. | Security, Platform Eng |
| **H-7** | Which GitHub orgs may users ship from, and which orgs is the Code App installed on? | Proposed: `organization` only for the pilot. Confirm the org list and the installation scope. | Platform Eng |

## 3. H-8: PM / product owner

**Question:** accept a dedicated `useShipPolling` composable for the Ship page, instead of reusing `useWorkflowPolling`?
**Proposed answer: accept.** The shared composable polls every 10 s and parses the legacy AKS status shape. Ship needs 15 s polling with backoff and a different status shape. Changing the shared composable would put every existing page at risk and cost about one extra sprint. The departure from the CLAUDE.md status-modal rule is recorded in an ADR, and the intent is kept: never block the UI, poll to a terminal state, clean up on navigation.

## 4. Other items to confirm

- **ASM-10 (PM):** config-PR retry is available for 24 hours after a ship. The PRD set no limit, but UUIDv7 run lookup needs a bound.
- **ASM-11 (Platform Eng):** complete the reserved-namespace list (`kube-*`, `flux-*`, `default`, and so on) before the flag is enabled.

## 5. Order of work after your answers

1. **Phase 1, flux-config:** workflow, scripts, environments, identities, fixtures. Needs H-6.
2. **Evidence:** run gates V-1 to V-12 and record them in `docs/SHIP-FROM-REPO-RUNBOOK.md`. A gate fails closed. A failure needs an Architect spec change, not a workaround.
3. **Pilot:** needs H-1 to H-5 and H-7, the V-gates, and the Wiz container-image scan. The flag then flips on devsand.

## 6. Reply template

```
H-6: Approved | Approved with changes: ... | Rejected: ...   Reviewer: <name>
H-1: suffix=<value> scheme=<http|https>
H-2: Option A | B | C
H-3: Waive (signers: <Security>, <Platform Eng lead>) | ACR read enabled
H-4: role/group = <name or object id>
H-5: main + lint | dedicated ref <name>
H-7: orgs=<list>  Code App installed on: <list>
H-8: Accept | Reject
ASM-10: 24h OK | change to <n>
ASM-11: owner=<name>, date=<date>
```
