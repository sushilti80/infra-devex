# PRD: Ship From Repo (GitHub repo → Buildpacks image → ACR → flux-config PR → preview)

## 1. Title and Metadata

| Field        | Value                                                                                       |
|--------------|---------------------------------------------------------------------------------------------|
| Feature Name | Ship From Repo                                                                              |
| Author       | Product Manager Agent                                                                       |
| Date         | 2026-10-21                                                                                  |
| Status       | `review` (Revision 2 after PRD Challenger Round 1; **not `approved`** while OQ-1 is open — see §10. The `ORCHESTRATOR-READY` marker's `status: approved` is only the validator's "ready for Challenger Round 2" signal, not sign-off) |
| Stakeholders | Platform Engineering, DevOps Team, Security (Wiz owners), App Developers (self-service consumers) |
| Repository   | `organization/self-service-infra` (with dependencies on `organization/flux-config`)        |
| PRD Slug     | `ship-from-repo`                                                                            |

---

## 2. Problem Statement

### User Personas

**Sam — App Developer with limited platform knowledge (primary).** Builds an app in Node, Python, Java,
Go or .NET and keeps it in a GitHub repository in one of the enterprise's GitHub orgs. Sam can write
application code but does not know Docker, does not own a CI pipeline, and does not know how ACR tags,
Flux or Helm work. Sam wants to say "run this repo on AKS and give me a URL to try". Sam's first follow-up
question is: *"I have no CI — how do my future code changes get deployed?"* (answered in §9, "Shipping
Future Changes").

**Priya — Platform Engineer (secondary).** Owns flux-config, the AKS clusters, the `ubuntu-latest` runner
pool and the Wiz policy. Priya wants every image that reaches ACR to be traceable to a commit and a
requesting user, scanned, and promoted only through the existing flux-config PR review (CODEOWNERS).

### Current Pain

Today, shipping an app to AKS requires, in order: (1) writing a Dockerfile, (2) owning a CI pipeline
that builds and pushes to ACR with a Flux-compatible semver tag, and (3) using the AKS deploy page
(`srcV2/pages/AKSDeployPage.vue`) and supplying `image_name` / `image_tag` by hand. Steps 1 and 2 are
the blockers for users with limited platform knowledge; they stall or go to the platform team as tickets.

### Why Now

The downstream half already exists and works: `POST /api/aks-deploy` dispatches flux-config
`generate-webapp-config.yaml`, which opens a stable PR; flux-config preview-on-PR (fixed in
organization/flux-config#1984) renders a per-PR preview; Flux image automation auto-rolls new semver
tags. The only missing piece is *producing the image from source*. A local spike confirmed Cloud Native
Buildpacks (Paketo `ubuntu-noble-builder`) auto-detect the common languages without a Dockerfile.

### Expected Business Value

- Removes the Dockerfile + CI prerequisite for onboarding to AKS (target: time from "ship clicked" to
  "flux-config PR opened" ≤ 30 min at p95 for a supported-language repo; provisional until the Phase 1 spike
  confirms cold-cache build times, OQ-16).
- Cuts platform-team onboarding tickets for "help me containerize".
- Every image has traceable provenance (commit, requester, correlation ID) and a security gate.

---

## 3. Goals, Success Metrics, and Non-Goals

### Goals and Success Metrics

| # | Goal | Success Metric (quantifiable) |
|---|---|---|
| G1 | A user ships a repo+branch to devsand with no Dockerfile and no CI file in their repo. | ≥ 90% of first-time ships of supported-language repos reach "flux-config PR opened" without platform-team help, over the first 60 days. **Source:** ship-workflow run conclusions/job summaries by correlation ID (outcome) + pilot survey (help needed). Owner: Platform Eng. |
| G2 | Builds are fast enough for an interactive flow. | Build+scan+publish p50 ≤ 12 min, p95 ≤ 20 min (cold builder cache — GitHub-hosted build VMs are throwaway; excludes queue time); trigger-to-PR-opened p95 ≤ 30 min. Provisional until Phase 1 spike (OQ-16). **Source:** workflow run timestamps. |
| G3 | Users can self-diagnose failures. | ≥ 80% of failed ships end with a specific failure code (not `UNKNOWN`), measured from job summaries; Platform Eng records the current "help me containerize" ticket count as a baseline before pilot (OQ-14) and the pilot reports the delta (no numeric ticket-reduction target until a baseline exists). |
| G4 | Every pushed image is secure and traceable. | 100% of pushed images carry `sha-<shortsha>` tag + OCI source/requester labels (checked by a post-publish assertion in the workflow); 100% of pushed images passed the Wiz gate (a push without a recorded PASSED scan result fails the workflow). |
| G5 | Re-shipping is idempotent and stable. | 100% of re-ships for the same app/env reuse the same flux-config PR (`auto/gen-<env>-<app>`) while it is open; 0 tags overwritten (ACR tag lock, FR-007). |
| G6 | User sees the preview URL. | Preview URL displayed within 10 s of the flux-config PR number becoming known, for 100% of successful ships. |

### Non-Goals (explicitly out of scope for MVP)

- In-cluster builds (kpack / Tekton / ACR Tasks). Possible future phase; MVP builds run in a GitHub
  Actions workflow in `organization/flux-config` whose **untrusted** build job runs on a GitHub-hosted
  `ubuntu-latest` VM and whose trusted jobs run on `ubuntu-latest` / GitHub-hosted (FR-004).
- Private build-time dependencies (private npm/NuGet/Maven feeds, build-time secrets/env vars), git
  submodules, Git LFS. The untrusted build job has no secrets by design; such repos fail with `BUILD_FAILED`
  or `CLONE_FAILED` and a hint (FR-011).
- Pushing `latest` or build-cache tags to ACR (never pushed).
- A UI/API override to take over an app name owned by another source repo (platform team resolves
  out-of-band; no override in MVP).
- Environments other than `devsand` (`sand`, `dataopssand`, prod). The UI must still read
  `data/environments.json` feature flags (see FR-002) and must not hardcode an environment list.
- A "Promote" button. Preview → real deploy happens through the existing flux-config PR review; the UI only
  links to the PR.
- Runtime/app logs (Datadog) and preview health/readiness status. Listed as future work.
- Changing port/health path after the flux-config PR is merged (FR-012 AC-012-3); platform team handles it
  out-of-band in MVP.
- Cross-device or team-wide ship history; MVP keeps a browser-local recent-ships list (FR-015, OQ-22).
- Automatic ship on `git push` ("auto-ship"). MVP re-ships are one click in the UI (FR-012 AC-012-6).
  Future option that still needs no CI file in the user's repo: a platform-owned trigger on the GitHub App's
  `push` webhook for the shipped branch that dispatches the same ship workflow (OQ-21).
- Users writing/editing a Dockerfile, custom builders, custom buildpacks, or `project.toml` authoring UI.
- Monorepo sub-path builds, multi-container apps, and non-web workloads (agents/jobs) — future.
- Changes to flux-config preview, cleanup, or CODEOWNERS behavior. This PRD only *consumes* them.
- Storing ship history in a database (GitHub — workflow runs, job summaries, flux-config PRs, selfserve-metadata
  — and ACR are the only datastores per platform convention; state lives as long as GitHub retains it).

---

## 4. Current State Assessment

### What Exists Today

| Capability | Location (evidence) | Notes |
|---|---|---|
| AKS deploy dispatch | `services/aksService.js`; `routes/api.js:1611` `POST /api/aks-deploy` | Dispatches flux-config `generate-webapp-config.yaml` with envname, appname, namespace, teamLabel, image_name, image_tag, port, health_path, externalSecret_enabled, kv_secrets, env_vars, secret_env_vars, workload_identity_grants, correlation_id, triggered_by. |
| AKS status polling | `routes/api.js:1753` `GET /api/aks-status-by-correlation/:correlationId` (**no `requireAuth`**); `routes/api.js:1785` `GET /api/aks-status/:workflowId` | Correlation-ID lookup exists but `services/aksService.js` `searchWorkflowByCorrelationId` lists 50 `workflow_dispatch` runs, inspects job logs of only the 10 most recent and skips runs older than 60 min — insufficient for ships that queue/build for 30+ min (FR-013). |
| Auth identity | `middleware/auth.js` `requireAuth` | Identity is an Entra ID JWT (`req.user.email`); the platform holds **no** GitHub login for the user today (FR-016, OQ-13). |
| Self-hosted runner `ubuntu-latest` (product-owner-verified) | ARC pool, image `exampleregistry.azurecr.io/githubrunner/devopsrunner` | No container daemon; every pod is injected with `ARM_CLIENT_SECRET`, `GH_APP_PRIVATE_KEY`, an SSH key and is pre-logged into `az` → untrusted code must never run there. |
| ACR `exampleregistry` (product-owner-verified) | Registry | Not publicly reachable (only trusted jobs on `ubuntu-latest` can push). |
| OIDC pattern (product-owner-verified) | `infrastructure-live/.github/workflows/infra-regression-examplecore.yml` | `azure/login@v3` with `AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID` secrets + GitHub environment. |
| Reference build template (product-owner-verified) | ADO `docker-infra-live/.templates/docker-build.yaml` | Key Vault `example-shared-services-kv-1` (`WIZ-CLIENT-ID/SECRET`); `wizcli docker scan --policy e8ef1254-673e-4761-9e85-303ff6a37f17` passes only on `Scan results: PASSED`; tag lock via `az acr repository update --write-enabled false --delete-enabled false`. |
| AKS deploy UI | `srcV2/pages/AKSDeployPage.vue` | Manual image name/tag entry. |
| Async status UX | `srcV2/composables/useWorkflowPolling.ts`, `srcV2/components/modals/StatusModal.vue` | Reusable for ship progress. |
| Default registry | `config.js:129` `config.aks.defaultImageRegistry` = `exampleregistry.azurecr.io` | |
| Dual GitHub Apps | `config.js:110` (`GITHUB_APP_ID`, infrastructure) and `config.js:116` (`GITHUB_CODE_APP_ID`, code-deployment) | Credentials must never be mixed. |
| Environment flags | `data/environments.json` | `devsand` has `features.aks: true`. |
| AKS app metadata | flux-config `selfserve-metadata/<app>-<env>.json` | Read today by AKS installed-apps page. |
| Wiz scan guidance | `.github/skills/wiz-security-scan/SKILL.md` | Image-scan workflow reference. |
| flux-config config PR | flux-config `generate-webapp-config.yaml` | Renders `.template/webapp` to `clusters/<env>/<env>-wus3-aks-1/apps/<app>/`; PR on fixed branch `auto/gen-<env>-<app>` (label `automation`, no auto-merge); re-run updates the same PR. |
| flux-config preview | `preview-on-pr.yaml` → `deploy-preview.yaml`; `cleanup-preview.yaml` | Preview at `pr-<N>-<app>` where `<N>` = source flux-config PR number; only apps on chart `helm/app-workload-deployment`. |
| Flux image automation | flux-config webapp template | Auto-rolls tags matching `^\d+\.\d+\.\d+$`, `semver >=0.0.0`. |

(flux-config entries are product-owner-verified facts supplied with the request; this repo's entries were
re-verified in the working tree before finalizing.)

### Gaps and Limitations

1. No way to produce an image from source inside the platform; users must bring their own image.
2. No UI to select a GitHub repo/branch accessible to the platform's GitHub App.
3. No automated semver tagging; users type `image_tag` by hand.
4. No surfaced build logs or categorized failure reasons.
5. No flow that connects "image pushed" → "flux-config PR opened" → "preview URL shown".
6. The webapp template defaults `port` 80 and `health_path` `/healthz`; Paketo-built apps listen on
   `$PORT` and many use `/health`, so port/health path must be user-settable in this flow.
7. No authorization model: the platform GitHub App's repo visibility is not the requesting user's, and
   nothing binds an app name to a source repo.
8. The legacy status route is unauthenticated and bounded to a 10-run / 60-minute search window.

---

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed Action |
|---|---|---|---|
| Repo + branch picker | `new-feature` | No GitHub repo-selection UI exists in `srcV2/pages/`. | New page/component + new backend endpoints (FR-001). |
| Build image from source with Buildpacks | `new-feature` | No build workflow or Buildpacks usage in repo/services. | New four-job ship workflow in flux-config: `prepare` (trusted) + `build` (untrusted, GitHub-hosted) (FR-004). |
| Semver auto-bump + sha tag | `new-feature` | `image_tag` is user-typed today (`routes/api.js:1611`). | FR-005, FR-007. |
| Wiz gate before push | `new-feature` | Wiz exists as a skill/CI practice and in the ADO template, not in a GitHub image-push path. | `scan` job (FR-006). |
| Push to ACR + tag lock | `new-feature` | `defaultImageRegistry` is config only (`config.js:129`); ADO template shows lock pattern. | `publish` job (FR-007). |
| Requester/App-ownership authorization | `new-feature` | No GitHub identity or app→repo binding exists (`middleware/auth.js`). | FR-016. |
| flux-config config PR creation | `existing-extend` | `services/aksService.js` + `POST /api/aks-deploy`; new behavior: chained in-workflow dispatch, PR-number capture, retry-without-rebuild, skip after merge. | Chain `generate-webapp-config` from the ship workflow; feed it the built image/tag (FR-008). |
| Progress/status UX | `existing-extend` | `useWorkflowPolling.ts`, `StatusModal.vue`, `aks-status-by-correlation` (unauthenticated, windowed). | Reuse polling pattern; new authenticated ship status route; add `requireAuth` + ownership to the legacy route (FR-013). |
| Build log surfacing | `new-feature` (reuses existing job-log reading) | No log endpoint in `routes/api.js` for AKS flow; `aksService.searchWorkflowByCorrelationId` already reads Actions job logs. | FR-009 (reuse that read code). |
| Preview URL display | `new-feature` (reuses existing flux-config preview) | flux-config `deploy-preview.yaml`. | FR-010. |
| Re-ship same PR / post-merge auto-roll | `existing-extend` | flux-config fixed branch `auto/gen-<env>-<app>`; Flux image automation. | FR-012. |
| Environment gating | `existing-extend` | `data/environments.json` `features.aks`; a **new** `shipFromRepo` flag is required (FR-002). | FR-002. |
| Failure categorization | `new-feature` | None. | FR-011. |
| Ship audit trail | `new-feature` | `triggered_by` / `correlation_id` inputs exist on the flux-config dispatch only. | FR-014. |
| Post-merge visibility | `new-feature` | No backend read; browser-local **Recent ships** list on the Ship from Repo page, statuses via the ship status endpoint (not `AKSInstalledAppsPage.vue`). | FR-015. |

No `unknown-needs-discovery` classifications; unverified facts are tracked as Open Questions with owners
(Section 10).

---

## 6. Functional Requirements (FR)

### FR-001 — Ship Page and Repository/Branch Selection

**Description**: A new authenticated page ("Ship from Repo") where the user selects a GitHub repository
and branch from those **the requesting user can read** (and that the platform GitHub App installation can
also read), across the allowlisted enterprise orgs.

**Priority**: `must`

**Rationale**: Primary entry point; users must not need to know exact repo URLs or give credentials.

**Acceptance Criteria**:
- AC-001-1: The page is reachable only when authenticated (`requireAuth` pattern) and only when the
  selected environment has the relevant feature flag enabled (FR-002).
- AC-001-2: The repo selector lists only repositories on which the **requesting user has at least read
  permission AND the App installation can read** (FR-016); it is searchable by `org/name` and implements the
  ARIA combobox pattern (keyboard navigation, `aria-activedescendant`).
- AC-001-3: After a repo is chosen, the branch selector lists its branches, defaulting to the repo's
  default branch; a branch may also be typed if not in the first page of results.
- AC-001-4: Repos the user cannot read, or the App cannot read, do not appear; if the user pastes a repo
  URL/`org/name` that fails either check, the UI shows the same generic "repo not accessible" message
  (FR-011) — it does not reveal whether the repo exists — and the steps to request access/App installation.
- AC-001-5: Repo/branch lists load within 3 s at p95 for ≤ 500 accessible repos (see NFR-002) and are cached
  per user for 5 min (NFR-011).
- AC-001-6: Owner/org values are restricted to the configured allowlist of enterprise orgs (configuration
  value; the initial allowlist is a deployment-time setting owned by Platform Eng, OQ-2).
- AC-001-7: **Ship from Repo is its own page, separate from the AKS playground.** It has its own
  navigation entry (new `PageId` `'ship'` in `srcV2/stores/navigation.ts`) and a "Ship an app from GitHub"
  card on the home page. It is not a tab, mode or section of `AKSDeployPage.vue` or
  `AKSInstalledAppsPage.vue`, and no ship UI is added to those pages. The whole ship lifecycle — ship,
  progress, result, ship new version, and the user's recent ships (FR-015) — happens on this page. Backend
  AKS services (`services/aksService.js`) are reused behind the new ship endpoints.
- AC-001-8: **Simple by default.** The first view shows repo, branch and app name, the environment as
  read-only text when only one environment is enabled for ship-from-repo (a select otherwise, AC-002-1), and
  a **Ship** button. Port (default 8080), health path, version bump (default patch), namespace (default = app
  name) and team label (default `software-engineering`, the existing `aksService` default) are under a
  collapsed **Advanced** section. The main flow uses only these user-facing labels: **Build**, **Security
  check**, **Publish**, **Review PR**, **Preview**, **Version**. Other technical terms (image, tag, digest,
  namespace, Flux, buildpack, correlation ID) may appear only inside **Advanced**, the **Details** toggle
  (logs, correlation ID, buildpack errors) and the result page's collapsed **Technical details** block
  (AC-013-4). Testable by asserting the rendered text of the default (collapsed) views.

**Dependencies**: FR-003 (backend), GitHub App installation scope (Section 10).

---

### FR-002 — Ship Configuration Inputs and Environment Gating

**Description**: A configuration step collects the inputs needed to build and deploy: app name,
namespace, team label, listen port, health path, optional bump type, and environment.

**Priority**: `must`

**Rationale**: The webapp template defaults (`port` 80, `health_path` `/healthz`) do not fit most
Paketo-built apps (`$PORT`, `/health`).

**Acceptance Criteria**:
- AC-002-1: Environment choices are derived from `data/environments.json` (enabled, `features.aks` true
  **and** a new `features.shipFromRepo` true); no environment id is hardcoded in Vue. For MVP only
  `devsand` has `shipFromRepo: true`. `POST /api/ship` rejects any environment lacking the flag.
  Enabling another environment is a data change, not a Vue change.
- AC-002-2: App name and namespace are validated as DNS-1123 labels
  (`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`), consistent with `POST /api/aks-deploy`; invalid values show inline
  errors and block submit.
- AC-002-3: Port accepts integers 1024–65535 (Paketo images run non-root) and defaults to 8080; health path
  must start with `/`, is user-configurable, and defaults to `/healthz`, with helper text noting many apps
  use `/health`.
- AC-002-4: Bump type defaults to "patch"; the user may select "minor" or "major" (FR-005).
- AC-002-5: The UI states in plain language that the app must listen on the port given by the `$PORT`
  environment variable, and shows the configured port to the user.
- AC-002-6: The form pre-fills app name from the repo name (sanitized to DNS-1123) and remains editable.
- AC-002-7: If an app with the same name already exists, the form shows (as an early, advisory hint using
  the same check as FR-016 AC-016-3) that the name is owned by another source repo and blocks submit; the
  authoritative rejection is `APP_OWNED_BY_OTHER` in FR-016 (no "warn and confirm" path).

**Dependencies**: `data/environments.json`, existing AKS metadata read path.

---

### FR-003 — Ship Trigger API and Backend Orchestration

**Description**: A new backend endpoint accepts a ship request, validates it, authorizes the requester
(FR-016), mints a `correlation_id`, and **dispatches the flux-config ship workflow exactly once**. The
workflow chains itself (prepare → build → scan → publish → `generate-webapp-config`, FR-004–FR-008); the
backend never advances stages, so closing the browser or restarting/scaling the backend cannot break a ship.
The backend only reads status afterwards (FR-013). There is no database.

**Priority**: `must`

**Rationale**: Keeps the browser a thin client, enforces trust-boundary validation server-side, and makes
the pipeline restart-safe without a worker or datastore.

**Acceptance Criteria**:
- AC-003-1: The endpoint is protected by `requireAuth` and validated with express-validator on every
  field (repo `org/name` pattern + org allowlist, branch against git-ref rules with a length cap and
  rejection of `..`, spaces, control characters and leading `-`, app name, namespace, port, health
  path, bump type, environment).
- AC-003-2: Responses use `{ success, data | error, correlationId }`; invalid input returns 400 with
  field-level errors and no workflow dispatched. This contract is authoritative for the ship API; the
  frontend does not reuse the legacy `{ success, status }` parser of `aks-status-by-correlation`.
- AC-003-3: The dispatch carries `correlation_id` and `triggered_by`; **`triggered_by` and the requester's
  GitHub login are set server-side from the authenticated identity, never from the request body**. The ship
  API returns the correlation ID within 2 s at p95 (NFR-002). The workflow sets
  `run-name` to include the correlation ID (FR-013).
- AC-003-4: The branch is passed as a ref; the trusted `prepare` job resolves and pins the commit SHA
  (FR-004) and every later stage uses that SHA, never the moving branch tip.
- AC-003-5: **Concurrent ships of the same app do not get a 409 and do not run concurrently**: the workflow
  `concurrency: ship-<app>` group with `cancel-in-progress: false` serializes the `publish` stage (FR-007);
  the second ship queues and receives the next patch version. (Known GitHub limit: a concurrency group holds
  one running + one pending run; see OQ-18 for a third simultaneous ship.)
- AC-003-6: If the repo/branch cannot be read by the requester or the App, the API returns a typed error
  `REPO_NOT_ACCESSIBLE` (FR-011) without dispatching; a name owned by another repo returns
  `APP_OWNED_BY_OTHER` (FR-016).
- AC-003-7: Backend credentials for repo listing/access checks and for dispatching flux-config are selected per
  NFR-003 and never mixed.

**Dependencies**: FR-004, FR-008, FR-016, `routes/api.js`, new service module.

---

### FR-004 — Ship Workflow (flux-config): `prepare` and `build` Jobs with Trust Separation

**Description**: A ship workflow lives in `organization/flux-config` and has four jobs (FR-004, FR-006,
FR-007; the `publish` job chains to FR-008). This FR specifies the first two:

1. `prepare` — on `ubuntu-latest` (**trusted; runs no user code**): verifies the requester's repo access
   (FR-016), mints a short-lived, read-only token scoped to the single source repo, checks out the requested
   ref, pins the commit SHA, and uploads the source as a workflow artifact.
2. `build` — on GitHub-hosted `ubuntu-latest` (**UNTRUSTED**; a throwaway VM): packs the source with `pack`
   and Paketo `paketobuildpacks/ubuntu-noble-builder` (linux/amd64) and exports the image as a tar
   artifact. No Dockerfile or CI file is required in the user's repo.

**Priority**: `must`

**Rationale**: Core capability. Verified facts: `ubuntu-latest` has no container daemon and every pod holds
`ARM_CLIENT_SECRET`, `GH_APP_PRIVATE_KEY`, an SSH key and an `az` login, so user build code must never run
there; ACR is not publicly reachable, so the untrusted job cannot reach it anyway.

**Acceptance Criteria**:
- AC-004-1: A repo containing only application source for a supported language (Node, Python, Java, Go,
  .NET) and no Dockerfile builds successfully into an image tar artifact.
- AC-004-2: The builder reference is pinned (by digest or explicitly reviewed tag) and recorded in the
  job summary; changing it requires a reviewed change.
- AC-004-3: The built image is `linux/amd64` (GitHub-hosted runner architecture) and the `build` job asserts
  the exported image's architecture.
- AC-004-4: If the repo contains a Dockerfile, it is ignored (Buildpacks are always used) and the build log
  states so.
- AC-004-5: When no buildpack group detects the repo, the workflow fails with `UNSUPPORTED_LANGUAGE` and
  lists the supported languages (FR-011).
- AC-004-6: **`prepare` trust rules**: it never executes repo content (no package-manager, build, `pack`,
  `docker`, or repo-provided script); clones with submodules, hooks and LFS smudge disabled; the minted token
  is read-only, single-repo, short-lived and is not persisted in the artifact (`.git` is excluded from the
  uploaded source); the requester access check (FR-016 AC-016-2) and the commit-SHA pin are recorded in the
  job summary; source artifact size is capped (provisional 500 MB, OQ-16) and over-limit fails
  `CLONE_FAILED`.
- AC-004-7: **`build` isolation rules**: `permissions: {}`; no `secrets.*` referenced; no OIDC (`id-token`
  not granted); no GitHub `environment:` attached; source obtained only from the `prepare` artifact (no
  checkout/credential helper in this job); no cache or state reused across ships (fresh VM per run);
  hard timeout (default 30 min) → `BUILD_TIMEOUT`; exported image tar capped (provisional 2 GB) and
  over-limit fails `BUILD_FAILED`.
- AC-004-8: The `build` job's only outputs are the image tar artifact and its logs. Anything the build
  writes (including image labels) is treated as untrusted input by later jobs (FR-006 AC-006-1, FR-007 AC-007-3).
- AC-004-9: The negative-test matrix in NFR-005 passes for the `build` job.

**Dependencies**: `ubuntu-latest` runner (trusted jobs only); GitHub-hosted `ubuntu-latest` with Docker for
`pack`; Paketo builder reachable from GitHub-hosted runners (public registry); the single source-repo
read token (App choice per NFR-003).

---

### FR-005 — Semantic Version Calculation

**Description**: Each build computes a plain `X.Y.Z` tag from the highest existing `X.Y.Z` tag for that app
repository in ACR.

**Priority**: `must`

**Rationale**: The Flux ImagePolicy filter is `^\d+\.\d+\.\d+$` with `semver >=0.0.0`; tags with a `v`
prefix or pre-release suffix would be ignored.

**Acceptance Criteria**:
- AC-005-1: Tags are exactly `^\d+\.\d+\.\d+$`; no `v` prefix, no suffixes.
- AC-005-2: Default bump is PATCH on the highest existing `X.Y.Z` tag (e.g., `1.4.7` → `1.4.8`). Highest is
  determined by semver ordering (not lexical or push-time).
- AC-005-3: Selecting "minor" yields `X.(Y+1).0`; "major" yields `(X+1).0.0`.
- AC-005-4: The first build for an app with no existing `X.Y.Z` tag in `selfserve/<app>` yields `0.1.0`
  (the ACR repository is per app, so other apps' tags cannot influence it).
- AC-005-5: Non-semver tags in the repository (e.g., `sha-*`, `v1.2.3`) are ignored when
  computing the highest version; `latest` is never created.
- AC-005-6: The computed version is shown in the progress view once `publish` starts and in the final summary.
- AC-005-7: Version computation and push happen **only inside the serialized `publish` section**
  (`concurrency: ship-<app>`, FR-007), so two ships of the same app never compute the same version; the
  second ship computes after the first has pushed and locked its tag and receives the next patch. If the
  computed tag nevertheless exists (should be impossible) the job fails `VERSION_COLLISION` without
  overwriting; there is no retry loop.

**Dependencies**: ACR read access from `publish` (`ubuntu-latest`); FR-007.

---

### FR-006 — Security Gate: `scan` Job (Wiz) Before Push

**Description**: A `scan` job on GitHub-hosted `ubuntu-latest` loads the image tar produced by `build`
(loading a tar does not execute it; **no user code runs in this job**) and scans it with Wiz CLI. Wiz
credentials come from Key Vault `example-shared-services-kv-1` (`WIZ-CLIENT-ID`/`WIZ-CLIENT-SECRET`) via OIDC
(`azure/login@v3`, dedicated GitHub environment). A gate failure blocks publish.

**Priority**: `must`

**Rationale**: Prevents unscanned or policy-violating images from reaching ACR and therefore Flux; mirrors
the existing ADO `docker-build.yaml` gate.

**Acceptance Criteria**:
- AC-006-1: The scan runs `wizcli docker scan --policy e8ef1254-673e-4761-9e85-303ff6a37f17` against the
  exact tar artifact from `build`; the job passes **only** when the output contains `Scan results: PASSED`
  (any other output, error or timeout fails). The job emits the tar's SHA-256; `publish` verifies it pushes
  the same bytes (FR-007 AC-007-2). Nothing is pushed to ACR when the scan fails.
- AC-006-2: On failure the user sees `SECURITY_GATE_FAILED` with severity counts and top findings (package,
  version, fixed-in) and the Wiz scan ID (no raw secrets). The Wiz link is labelled "requires Wiz access".
- AC-006-3: The policy is fixed in the workflow; users cannot override it from the UI.
- AC-006-4: **Fail closed**: if Wiz or Key Vault is unavailable or credentials cannot be fetched, the ship
  fails with `SECURITY_SCAN_UNAVAILABLE` and a clear message ("security scanning is unavailable; nothing was
  published; retry later"). No push occurs.
- AC-006-5: The scan result reference is written to the job summary (FR-014).
- AC-006-6: Semgrep / Dockerfile lint (`p/docker`) is not part of this flow (there is no Dockerfile).

**Dependencies**: OIDC identity with Key Vault secret read on `example-shared-services-kv-1` (NFR-003);
federated credential scoped to flux-config + dedicated environment. Whether policy e8ef1254 includes secrets
detection is confirmed by Security (OQ-19, non-blocking).

---

### FR-007 — `publish` Job: Push to ACR with Semver Tags, Lock, and Config Hand-off

**Description**: A `publish` job on `ubuntu-latest` (the only job that can reach private ACR) logs in with
OIDC, computes the next `X.Y.Z`, pushes `selfserve/<app>:<X.Y.Z>` and `selfserve/<app>:sha-<shortsha>` to
`exampleregistry.azurecr.io` using a daemonless tool (crane or skopeo), locks the tags, then triggers the
flux-config config generation (FR-008). It runs under `concurrency: ship-<app>` with
`cancel-in-progress: false`.

**Priority**: `must`

**Rationale**: Semver triggers Flux automation; sha tag gives traceability; lock + serialization guarantee a
tag is never overwritten.

**Acceptance Criteria**:
- AC-007-1: Image is pushed as `exampleregistry.azurecr.io/selfserve/<app>:<X.Y.Z>` and `…:sha-<shortsha>`
  (`<shortsha>` = first 7 characters of the pinned commit SHA). `latest` and build-cache tags are never
  pushed.
- AC-007-2: `publish` downloads the `build` tar, verifies its SHA-256 equals the digest emitted by `scan`
  (mismatch → fail, nothing pushed), and runs no user code (no `docker run`/`docker load`, no repo scripts).
- AC-007-3: **Trusted provenance labels** are applied by `publish` (daemonless label mutation) after the
  scan, overwriting anything the build supplied: `org.opencontainers.image.source` (repo URL),
  `org.opencontainers.image.revision` (full SHA), `org.opencontainers.image.version` (X.Y.Z), plus
  `correlation_id` and requester. The pushed digest and the scan reference are recorded together in the
  job summary.
- AC-007-4: Auth is OIDC (`azure/login@v3`; secrets `AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID`, GitHub
  environment dedicated to ship-from-repo) — no long-lived registry credentials. The identity has only
  AcrPush + repository/tag metadata-write on `exampleregistry` (NFR-003).
- AC-007-5: After a successful push each newly created tag is locked with
  `az acr repository update --write-enabled false --delete-enabled false` (ADO-template pattern). An existing
  `X.Y.Z` tag is never overwritten. If `sha-<shortsha>` already exists (re-ship of the same commit) it is
  left untouched (not overwritten, not an error); the revision label still identifies the commit.
- AC-007-6: On success the workflow outputs the final image reference, digest and version to the next step.
- AC-007-7: **Serialization**: two ships of the same app never execute `publish` (version computation, push,
  lock, config dispatch) at the same time; the second queues (not cancelled, not rejected) and computes the
  next patch afterwards. Image/ACR repository naming is `selfserve/<app>`.
- AC-007-8: A cancelled/failed run never leaves a partial tag: tags are pushed then locked within `publish`,
  and a user cancel request is not honored once `publish` has started (FR-013 AC-013-5). Orphaned images
  after a later `CONFIG_PR_FAILED` remain in ACR (tags are locked; cleanup policy is OQ-15).

**Dependencies**: FR-005, FR-006, FR-016, ACR permissions, OIDC federated credential (NFR-003).

---

### FR-008 — Chained Hand-off to flux-config Config PR (Reuse Existing AKS Deploy Flow)

**Description**: As the last step of the serialized `publish` section, the ship workflow triggers flux-config
`generate-webapp-config.yaml` (same repo) with the built image and user config so the PR on
`auto/gen-<env>-<app>` is created or updated. The mechanism (`workflow_call` vs. a dispatch) is an Architect
decision constrained by AC-008-5.

**Priority**: `must`

**Rationale**: Reuses the existing, trusted deploy path and its review gate; chaining inside the workflow
keeps the pipeline independent of the browser and the backend.

**Acceptance Criteria**:
- AC-008-1: Inputs include `envname`, `appname`, `namespace`, `teamLabel`, `image_name`
  (`selfserve/<app>`), `image_tag` (the `X.Y.Z` tag), `port`, `health_path`, `correlation_id`, and
  `triggered_by`. **`workload_identity_grants`, `kv_secrets`, `env_vars` and `secret_env_vars` are always
  empty in this flow** (Key Vault secrets, env vars and workload identity for shipped apps are not
  supported in MVP), so preview workloads of
  arbitrary user code get no Key Vault/workload-identity access.
- AC-008-2: The same correlation ID spans prepare → build → scan → publish → config (run-name and inputs)
  so the UI shows one end-to-end timeline.
- AC-008-3: The flux-config PR number and URL are captured deterministically (by the fixed branch
  `auto/gen-<env>-<app>`, written to the job summary) and shown in the UI within 2 min of the config step
  completing at p95. If the PR cannot be found, the ship ends `CONFIG_PR_FAILED` (image remains).
- AC-008-4: No auto-merge is requested; promotion remains subject to flux-config CODEOWNERS review.
- AC-008-5: **The mechanism must still let the resulting PR trigger `pull_request` workflows** (PRs created
  with `GITHUB_TOKEN` do not fire `preview-on-pr`): either `workflow_call` into a config workflow that
  already opens the PR with a non-`GITHUB_TOKEN` credential, or a dispatch using a token that triggers
  downstream workflows. Acceptance test: after a ship, `preview-on-pr` runs for the PR.
- AC-008-6: **No downgrade**: the config step compares the requested `image_tag` with the tag currently on
  the open PR branch (or main) and never writes a lower version; this is guaranteed by running inside the
  serialized section (AC-007-7) and verified by the step.
- AC-008-7: If the config step fails, the image remains in ACR, the UI reports `CONFIG_PR_FAILED`, and a
  "retry PR creation" action re-runs only the config step with the existing image/tag (no rebuild,
  no re-tag).
- AC-008-8: When the app already exists on flux-config's default branch with no open PR (post-merge), the
  workflow skips `generate-webapp-config` by default (FR-012 AC-012-2) and marks the Config PR stage
  `skipped`.

**Dependencies**: `services/aksService.js` (reused by the retry action and status), flux-config
`generate-webapp-config.yaml`, FR-007.

---

### FR-009 — Build Log Surfacing

**Description**: The UI shows GitHub Actions build logs for the ship's `build` job (and `prepare`/`scan`/
`publish` step summaries), live where feasible and complete after completion. **Logs are fetched
incrementally and only on demand** (log panel open), never on every status poll.

**Priority**: `must`

**Rationale**: Users with limited platform knowledge must see why a build failed without GitHub access to the flux-config repo.

**Acceptance Criteria**:
- AC-009-1: While the build runs and the log panel is open, the UI refreshes log output every 15 s
  (same cadence as status, FR-013) using the server-side cache (NFR-011); the backend returns only new
  content since the client's offset; on completion the complete log is available.
- AC-009-2: Logs are retrieved by the backend via the GitHub API (reusing the existing job-log reading in
  `aksService`) and proxied; the browser never receives GitHub tokens or direct artifact/blob URLs.
- AC-009-3: Log lines are redacted server-side for known secret patterns (tokens, passwords in URLs,
  `Authorization` headers) before display (NFR-012). The workflow does not enable `ACTIONS_STEP_DEBUG`.
- AC-009-4: Logs are grouped by stage (prepare, build, scan, publish, config PR) with the current stage
  highlighted.
- AC-009-5: The log viewer supports scrolling, copy, and "download full log"; very large logs (> 5 MB) are
  truncated in-view with a notice and still downloadable.
- AC-009-6: Only the user who triggered the ship, a user authorized for the app (FR-013 AC-013-6), and
  platform team members can read its logs (authorization by correlation ID).
- AC-009-7: MVP scope is **build logs only**; runtime/app logs are not part of this feature.

**Dependencies**: FR-003, FR-013, GitHub Actions logs API (OQ-10 on in-progress log availability).

---

### FR-010 — Preview URL Display

**Description**: Once the flux-config PR exists, show the user the flux-config PR link and the expected preview
URL `<scheme>://pr-<N>-<app>.${CLUSTER_DNS_SUFFIX}`, where `<N>` is the flux-config PR number and the host is
derived from the ingress host that flux-config's preview deploy produces — never a hardcoded domain.

**Priority**: `must`

**Rationale**: The preview URL was the original ask.

**Acceptance Criteria**:
- AC-010-1: The preview URL is displayed only after the flux-config PR number is known; before that the UI shows
  "Preview URL available after the config PR is created".
- AC-010-2: The URL host equals the ingress host pattern `pr-<N>-<app>.${CLUSTER_DNS_SUFFIX}` used by
  flux-config; the suffix and scheme (http vs https) come from platform configuration populated from the
  actual flux-config value for the environment (not hardcoded in Vue, and no `.k8s.com` literal). The exact
  value is the only blocking open question (OQ-1), scoped to this FR.
- AC-010-3: Next to the URL the UI shows plain-language text that the preview may take several minutes to
  become reachable after the config PR is created; no health/readiness status is shown in MVP.
- AC-010-4: The URL has "Copy" and "Open in new tab" actions; the flux-config PR link is shown beside it and
  labelled "Request production deploy via this PR".
- AC-010-5: If the app's chart is not `helm/app-workload-deployment` (no preview support), the UI shows
  "Preview isn't available for this app" instead of a URL.
- AC-010-6: The UI states that the preview is served by flux-config's preview ingress and its reachability
  (internal-only vs. wider) is whatever flux-config provides; this feature adds no public exposure and passes no
  secrets/identities to the preview workload (FR-008 AC-008-1). Confirmation of flux-config preview exposure is
  OQ-20 (non-blocking).

**Dependencies**: FR-008, flux-config preview workflows, OQ-1.

---

### FR-011 — Failure Categories and Failure UX

**Description**: Every failed ship ends in a categorized, plain-language failure state with a recommended
next step and a log tail.

**Priority**: `must`

**Rationale**: Target users cannot debug CI output unaided.

**Acceptance Criteria**:
- AC-011-1: Failure categories exist and are returned by the API as stable codes:
  `BUILD_FAILED`, `UNSUPPORTED_LANGUAGE`, `REPO_NOT_ACCESSIBLE`, `APP_OWNED_BY_OTHER`, `CLONE_FAILED`
  (private submodules, LFS, oversize repo), `SECURITY_GATE_FAILED`, `SECURITY_SCAN_UNAVAILABLE`,
  `BUILD_TIMEOUT`, `PUBLISH_FAILED` (ACR auth/quota/lock/push error), `VERSION_COLLISION` (integrity
  failure, should not occur), `CONFIG_PR_FAILED` (incl. PR not found), `RUNNER_UNAVAILABLE`, `CANCELLED`,
  `SUPERSEDED` (displaced from the concurrency group's pending slot, OQ-18), `PLATFORM_RATE_LIMITED` (GitHub
  API limit/outage when triggering or reading), `UNKNOWN`. Preview-deploy failure after PR creation is out of
  scope (no readiness status in MVP).
- AC-011-1a: Retry matrix: safely retryable by re-shipping — `RUNNER_UNAVAILABLE`, `PLATFORM_RATE_LIMITED`,
  `SECURITY_SCAN_UNAVAILABLE`, `PUBLISH_FAILED`, `SUPERSEDED`, `CANCELLED`; retry-config-only —
  `CONFIG_PR_FAILED`; fix-then-ship — all others.
- AC-011-2: `BUILD_FAILED` shows a plain-language summary ("The build failed — see what went wrong below")
  and the extracted buildpack error message at the top of the failure panel; the failing buildpack id and the
  last 50 log lines are in the panel's **Details** toggle (AC-001-8).
- AC-011-3: `UNSUPPORTED_LANGUAGE` lists the supported languages and links to platform documentation.
- AC-011-4: `REPO_NOT_ACCESSIBLE` states generically that the repo could not be read with the requester's
  access and the platform GitHub App, explains how to request access/App installation (naming the org), and
  never reveals whether a private repo exists. `APP_OWNED_BY_OTHER` states the app name is already owned by a
  different source repo and to choose another name (it names the owning repo only if the requester can read it).
- AC-011-5: `SECURITY_GATE_FAILED` shows severity counts and top findings (package, version, fixed-in)
  without exposing secrets, and states that nothing was pushed.
- AC-011-6: `VERSION_COLLISION` is reported as a platform integrity error (tag lock should make it
  impossible) with the correlation ID for the platform team; no automatic retry.
- AC-011-7: `RUNNER_UNAVAILABLE` is reported when the `prepare` or `publish` job (`ubuntu-latest`) is not
  picked up within 10 min (queue timeout), with a "Retry" action and a message to contact the platform team.
  Time spent queued behind another ship of the same app (concurrency group) is reported as "Queued behind
  another ship", not as `RUNNER_UNAVAILABLE`.
- AC-011-8: Every failure panel has a "copy details" action for support; the correlation ID is shown inside
  the panel's **Details** toggle and included in the copied details (AC-001-8).
- AC-011-9: No failure state exposes secrets, tokens, or internal stack traces.
- AC-011-10: `BUILD_FAILED` includes a hint that private dependency feeds, build-time secrets, submodules and
  LFS are not supported (non-goals).

**Dependencies**: FR-004, FR-006, FR-007, FR-009.

---

### FR-012 — Re-ship Flow

**Description**: Shipping the same app/env again produces a new version and updates the same flux-config PR
(and thus the same preview `<N>`) while the PR is open; after merge, new versions auto-roll via Flux.

**Priority**: `must`

**Rationale**: Iterating on a preview is the main usage pattern; stable URL and PR avoid clutter.

**Acceptance Criteria**:
- AC-012-1: A re-ship while flux-config PR `auto/gen-<env>-<app>` is open results in the same PR number
  (updated), a new `X.Y.Z` (higher than before), and an unchanged preview URL.
- AC-012-2: After the flux-config PR is merged and the app exists on flux-config's default branch (the workflow
  decides this by reading flux-config — app directory present and no open `auto/gen-<env>-<app>` PR; the UI
  merely displays the result), a re-ship builds, scans and publishes a new `X.Y.Z` and does NOT run
  `generate-webapp-config` by default (to avoid overwriting Flux-updated tags; OQ-3 default assumption); the
  UI states "Version X.Y.Z will roll out automatically in a few minutes".
  **Accepted trade-off (devsand-only scope):** after merge, re-ships roll out via Flux without a new
  CODEOWNERS review; this must be re-evaluated before enabling any non-`devsand` environment.
- AC-012-3: Port and health path are inputs of every ship (FR-002); there is no separate settings action.
  **Before merge**, a **Ship new version** with changed port/health path regenerates the flux-config PR config
  as part of the normal serialized ship (FR-008, AC-008-6, `ship-<app>` concurrency). **After merge**, a
  re-ship keeps the merged config (AC-012-2); the Advanced port/health-path fields are read-only with the text
  "Settings are fixed after your app is approved. Ask the platform team to change them." `POST /api/ship`
  enforces this server-side (changed port/health path for a merged app are ignored and the response says so).
  Changing settings after merge is a Non-Goal for MVP. The user is never sent to the AKS playground pages.
- AC-012-4: The UI detects and displays whether the PR is open, merged or closed (GitHub PR state read of
  `auto/gen-<env>-<app>`) on the result page; if the PR was closed without merge (preview cleaned up), a
  re-ship opens a new PR and the UI says a new preview URL was issued.
- AC-012-5: Two re-ships of the same app cannot publish concurrently; the second queues and gets the next
  patch (AC-003-5, AC-007-7).
- AC-012-6: The ship result page shows a **Ship new version** action that starts a new ship with the same
  repo, branch, app name and settings pre-filled from that ship's workflow inputs (user may change branch or
  bump type); if the inputs cannot be read, it pre-fills repo, branch and app name only and uses defaults for
  the rest. Next to it, plain language explains: "Your changes are not deployed automatically. Push your code
  to `<branch>`, then click Ship new version." No CI file or other repository change is required.

**Dependencies**: FR-003, FR-008, FR-010, OQ-3.

---

### FR-013 — End-to-End Progress and Status

**Description**: A ship progress view shows each stage's state and updates automatically using the
existing async pattern.

**Priority**: `must`

**Rationale**: Consistency with platform async UX and correlation-ID convention.

**Acceptance Criteria**:
- AC-013-1: Stages tracked: Queued → Prepare → Build → Scan → Publish → Config PR → Preview URL; each with
  `pending | running | succeeded | failed | skipped`. The main progress view shows them with the AC-001-8
  labels: Queued + Prepare + Build → **Build**, Scan → **Security check**, Publish → **Publish**, Config PR →
  **Review PR**, Preview URL → **Preview**. Internal stage names appear only in **Details**.
- AC-013-2: The page uses `useWorkflowPolling` and the status modal pattern; **the UI polls every 15 s**
  (backoff on errors), and stops on terminal state. The backend serves polls from a short-lived cache keyed
  by correlation ID (NFR-011) so multiple viewers/tabs do not multiply GitHub calls.
- AC-013-3: **Deterministic correlation lookup**: the workflow `run-name` contains the correlation ID; the
  status API resolves the run by that name (or an equivalent deterministic mechanism, e.g. capturing the run
  ID at dispatch) and caches the run ID. Lookup is NOT limited to the "last 10 runs / 1 hour" window and works
  for ships queued/running up to the workflow timeout and after browser refresh/reopen (correlation ID in the
  URL), for as long as GitHub retains the run. The workflow run, job summary and flux-config PR are the only
  state; no database.
- AC-013-4: Final state summary shows version, PR link, preview URL and duration; repo@sha, image reference
  and digest are in its collapsed **Technical details** block (AC-001-8).
- AC-013-5: `should`: a user can navigate away and return without cancelling the ship (`must`); an explicit
  "Cancel" action cancels the GitHub run while queued or building, and is rejected with a clear message once
  `publish` has started (AC-007-8).
- AC-013-6: **Authorization**: status and logs for a correlation ID are returned only to (a) the user who
  triggered the ship (`triggered_by`, read from server-set workflow inputs), (b) a user who is authorized for
  the app under FR-016 (can read the app's owning source repo), or (c) platform team members; otherwise 403
  (404 if the run cannot be found).
- AC-013-7: **Add `requireAuth` to the legacy `GET /api/aks-status-by-correlation/:correlationId`**
  (currently unauthenticated, `routes/api.js:1753`) and apply the same ownership rule as AC-013-6 (ships the
  user triggered, apps they own/are authorized for, or platform team). Its only frontend caller,
  `srcV2/services/api.ts`, already attaches the bearer token via its request interceptor, so no AKS page
  change is needed; the new ship status route is separate and uses the
  `{ success, data | error, correlationId }` contract.

**Dependencies**: `useWorkflowPolling.ts`, FR-003, FR-009, FR-016.

---

### FR-014 — Ship Audit Record

**Description**: Each dispatched ship leaves a GitHub-resident record of who shipped what, from where,
and with what outcome. The audit record is the combination of: the workflow run (inputs, run-name), its job
summary, the flux-config PR, and flux-config `selfserve-metadata`, plus ACR tags/labels. State lives only as long
as GitHub retains it (Actions run retention); this is documented, not promised beyond.

**Priority**: `must`

**Rationale**: Auditability; GitHub is the only datastore.

**Acceptance Criteria**:
- AC-014-1: The workflow run records inputs: repo, branch, pinned SHA (job summary), requesting user
  (`triggered_by`, server-set), env, app, bump type, correlation ID, builder reference.
- AC-014-2: The job summary records: version, digest, Wiz scan reference, final status and failure code.
- AC-014-3: Records are retrievable by correlation ID (AC-013-3) and by app name (flux-config PR branch /
  `selfserve-metadata`) via the platform backend without a database.
- AC-014-4: The image in ACR can be traced back to the run through the OCI labels (FR-007 AC-007-3) and the
  `sha-<shortsha>` tag.
- AC-014-5: Retention equals the flux-config repository's Actions run/log/artifact retention setting; the actual
  configured value is documented in the runbook (OQ-11); the PRD makes no retention claim beyond it.
- AC-014-6: Audit scope = **dispatched ships**. Requests rejected before dispatch (400, `REPO_NOT_ACCESSIBLE`,
  `APP_OWNED_BY_OTHER`) have no workflow run; they appear only in backend API logs (correlation ID, requester).

---

### FR-015 — Recent Ships

**Description**: The Ship from Repo page lists the ships the user started from this browser, so the user can
get back to a ship's result page (PR state, preview URL, **Ship new version**) without visiting the AKS
playground.

**Priority**: `should`

**Rationale**: Closes the loop on the same page with zero new GitHub list calls and no datastore. A
server-side "all my apps" list is not feasible within NFR-011: workflow runs cannot be filtered by run-name or
requester (the actor is the platform App), and selfserve-metadata on `main` has no open-PR apps and no
requester marker.

**Acceptance Criteria**:
- AC-015-1: When `POST /api/ship` returns success, the frontend stores `{ correlationId, app, env, repo,
  branch, startedAt }` in browser `localStorage` (key scoped to the signed-in user's object ID), keeping the
  20 newest entries. No tokens or secrets are stored.
- AC-015-2: The **Recent ships** list shows each entry's app, branch, start time and status. On page load it
  refreshes status only for entries not yet terminal, via the existing ship status endpoint (FR-013, auth and
  ownership per AC-013-6, served from the status cache, NFR-011); terminal status is stored with the entry
  and not re-fetched. Each row opens that ship's result page (AC-012-4, AC-012-6, FR-010).
- AC-015-3: If a status refresh fails, the row shows "Couldn't load status — try again" with a retry link and
  is not removed; a 403/404 shows "No longer available" and offers **Remove**. An empty list shows "Ships you
  start will appear here."
- AC-015-4: `AKSInstalledAppsPage.vue` and `AKSDeployPage.vue` get no code changes for this feature.
  Because they read the same flux-config metadata, merged shipped apps may still appear there as ordinary AKS
  apps; that is accepted.
- AC-015-5: No runtime logs or health indicators are added (out of scope for MVP). Cross-device or
  team-wide ship history is future work (OQ-22).

**Dependencies**: FR-013 (status endpoint), FR-012.

---

### FR-016 — Requester Authorization and App-Name Ownership

**Description**: A ship is allowed only if the **requesting user's own GitHub access** permits reading the
source repo (not merely the App's), and an app name is owned by the first source repo that shipped it.

**Priority**: `must`

**Rationale**: Prevents a confused-deputy path (a user shipping a private repo they cannot read) and
cross-team overwrite of a running app by Flux auto-rolling a higher `X.Y.Z` pushed from an unrelated repo.

**Acceptance Criteria**:
- AC-016-1: The platform maps the authenticated Entra identity to a verified GitHub login by a mechanism
  chosen by the Architect (OQ-13). If no verified mapping exists the ship is rejected (`REPO_NOT_ACCESSIBLE`);
  the GitHub login is never taken from client input.
- AC-016-2: The requester's read permission on the repo is verified at list time (FR-001), at ship time
  (API, fast-fail) and again in the trusted `prepare` job (authoritative, closes the time-of-check gap). A
  failed check ends the ship with `REPO_NOT_ACCESSIBLE` and no source is cloned.
- AC-016-3: **App ownership**: the first source repo to ship an app name owns it. The binding is the
  `org.opencontainers.image.source` label on the `selfserve/<app>` tags in ACR (set by `publish`, FR-007
  AC-007-3). A ship of the same app name from a different source repo is **rejected** (not "warn and
  confirm") with `APP_OWNED_BY_OTHER`: pre-checked by the API (403) and enforced in `prepare` and again in
  `publish` inside the serialized section. An app that exists on flux-config but has no `selfserve/<app>` ship
  history (e.g. bring-your-own-image) is also rejected as `APP_OWNED_BY_OTHER`.
- AC-016-4: The same source repo may re-ship its own app (any user with read access to that repo); the same
  source repo may own more than one app name.
- AC-016-5: A different source repo can never push into `selfserve/<app>` (publish checks the label of the
  highest existing tag before pushing; mismatch → fail, nothing pushed).
- AC-016-6: Forks and repos outside the org allowlist are rejected (AC-001-6).

**Dependencies**: FR-001, FR-003, FR-004, FR-007; GitHub identity mapping (OQ-13); App installation scope
(OQ-2).

---

## 7. Non-Functional Requirements (NFR)

### NFR-001 — Performance: Build and End-to-End Duration

**Target**: Build+scan+publish p50 ≤ 12 min and p95 ≤ 20 min for a typical app (≤ 200 MB source, **cold
builder cache — the GitHub-hosted build VM is throwaway**), excluding queue time; trigger-to-"flux-config PR
opened" p95 ≤ 30 min including queue. Provisional until the Phase 1 spike (OQ-16).
**Measurement**: Durations from workflow run/job timestamps per correlation ID, reported weekly.
**Rationale**: Interactive expectation for a "ship" action.

### NFR-002 — Performance: API Latency

**Target**: Ship trigger, repo list, branch list and status endpoints respond in ≤ 2 000 ms at p95 under
≤ 50 concurrent users (status endpoints served from cache are ≤ 500 ms at p95); log fetch ≤ 3 000 ms at p95
for logs ≤ 5 MB.
**Measurement**: Backend request-duration metric via `logger.logMetric` (the server-side pattern used in
`routes/api.js`), not the frontend `trackEvent` composable.

### NFR-003 — Security: Credential Separation and Least Privilege

**Target**: 100% of operations use exactly one designated credential per operation class: repo
listing/user-access checks and the `prepare` source token use the App designated by the Architect (expected:
code-deployment app, single-repo read-only short-lived token); flux-config dispatch and flux-config reads use the
infrastructure app; credentials are never mixed within a single call, and neither app is granted new write
scope to user repos. The workflow OIDC identity (`azure/login@v3`, GitHub environment dedicated to
ship-from-repo, federated credential scoped to flux-config + that environment) has exactly: AcrPush and
repository/tag metadata-write on `exampleregistry`, and Key Vault secret read on `example-shared-services-kv-1`
(Architect may split into scan-only and publish-only identities). No static ACR/Wiz credentials exist.
**Measurement**: Architecture review checklist; unit test asserting the credential used per service
function; role-assignment/federated-credential manifest diff review.

### NFR-004 — Security: Input Validation and Injection Resistance

**Target**: 100% of API inputs validated with express-validator (repo, branch, app, namespace, port, health
path, bump type, env); 0 user-supplied values interpolated unquoted into shell commands in the build
workflow (passed via environment variables or `with:` inputs and quoted); fuzz/negative tests cover repo
names and branch names containing `;`, `$()`, backticks, newlines, `..`, leading `-`.
**Measurement**: Unit tests + code review checklist; Wiz IaC/SAST scan on the workflow with 0 high findings.

### NFR-005 — Security: Build Isolation and Supply Chain

**Target**: Untrusted user code runs **only** in the GitHub-hosted `build` job (throwaway VM); `prepare`,
`scan` and `publish` execute no user code; the `build` job has `permissions: {}`, no secrets, no OIDC, no
environment (AC-004-7); builder image pinned (AC-004-2); Wiz gates 100% of pushes (FR-006); the scanned tar
is the pushed tar (SHA-256 verified, AC-007-2); provenance labels are set by the trusted job (AC-007-3);
repos outside the allowlist are rejected (AC-001-6). Required negative-test matrix for the `build` job —
every case must fail/return nothing: (1) read any env var/secret (none present); (2) obtain an OIDC token or
call Azure/Key Vault; (3) use a `GITHUB_TOKEN`/credential to write to flux-config, other runs or artifacts;
(4) reach ACR `exampleregistry` (not publicly reachable/no credential); (5) read another ship's workspace or
cache (fresh VM); (6) find a clone token in the source artifact (`.git` excluded).
**Measurement**: Workflow review (no `ubuntu-latest` step runs repo content); a sample "hostile" repo whose
build executes each matrix case, run in CI before GA and after workflow changes.

### NFR-006 — Traceability

**Target**: 100% of pushed images carry `sha-<shortsha>` tag and OCI labels (source, revision, version,
correlation_id, requester); a given image digest can be mapped to the repo+SHA and workflow run in ≤ 2
lookups.
**Measurement**: Post-push assertion in the workflow; QA spot-check of 10 images.

### NFR-007 — Auditability

**Target**: 100% of **dispatched** ships (success and failure) have an audit record per FR-014 retrievable by
correlation ID, containing requester identity, for as long as flux-config's GitHub Actions retention keeps the
run (configured value documented, AC-014-5). Pre-dispatch rejections are in API logs only (AC-014-6).
**Measurement**: Weekly reconciliation of backend `ship_started` metrics (`logger.logMetric`) against
workflow runs by correlation ID within the retention window; must match 100%.

### NFR-008 — Reliability: Concurrency, Idempotency, Runner Health

**Target**: At most 1 `publish` per app at a time (workflow `concurrency: ship-<app>`,
`cancel-in-progress: false`); a concurrent ship queues and receives the next patch (no 409); no tag is ever
overwritten (ACR tag lock); a ship queued for a trusted `ubuntu-latest` job > 10 min is failed as
`RUNNER_UNAVAILABLE`; ≥ 95% of ships whose failures are not caused by user code or policy (monthly)
complete successfully.
**Measurement**: Workflow success-rate dashboard excluding `BUILD_FAILED`, `UNSUPPORTED_LANGUAGE`,
`SECURITY_GATE_FAILED`, `APP_OWNED_BY_OTHER`, `REPO_NOT_ACCESSIBLE`; concurrency test (§12).

### NFR-009 — Observability: Correlation and Telemetry

**Target**: A single `correlation_id` is present in 100% of API logs, workflow inputs, workflow run names,
OCI labels, flux-config config dispatch/PR, and UI polling requests; backend metrics (`logger.logMetric`) for
`ship_started`, `ship_stage_completed`, `ship_failed` (with code), `ship_succeeded`, each with duration.
**Measurement**: Log query by correlation ID reconstructs the full timeline in a single query.

### NFR-010 — Usability and Accessibility

**Target**: Ship flow meets WCAG 2.1 AA (ARIA combobox repo/branch pickers, visible focus, status changes
announced via `aria-live`, color not sole indicator); all error messages are plain-language and contain a next step;
≥ 85% task completion in usability test with 5 users with limited platform knowledge, without assistance.
**Measurement**: Automated a11y checks in Vitest/Playwright; moderated usability test before GA.

### NFR-011 — Scalability

**Target** (GitHub API budget; baseline REST limit 5 000 requests/hour per App installation; the binding
installation is the one used for flux-config run/log/PR reads, shared with every other platform feature —
conservatively assume no enterprise uplift):
- UI polls every 15 s; backend uses single-flight server-side caching per correlation ID (TTL 10 s while
  running, 60 s once terminal, 5 min for per-user repo/branch lists) so N viewers/tabs of one ship cost one
  GitHub call per refresh; logs are fetched incrementally and only while the log panel is open; conditional
  (ETag) requests are used but are conservatively counted as full calls.
- Per-ship ceiling **≤ 200 GitHub API calls**, computed for a 20-min ship: trigger + access checks + pickers
  ≤ 15; run lookup ≤ 5; status refresh 1 call × 80 cycles = 80; terminal PR/run/metadata reads ≤ 10; logs
  1 call × ≤ 50 cycles while open ≤ 50; late re-opens ≤ 5; retry reserve ≈ 35 → ≈ 200. Concurrent viewers add 0.
- Recent ships list (FR-015): 0 GitHub list calls; on page load ≤ 1 status refresh per non-terminal entry
  (≤ 20), served from the status cache and counted within the per-ship "late re-opens" and status budget.
- **Ship-start target ≤ 12 ships/hour sustained** → ≤ 2 400 calls/h = 48% of 5 000, leaving > 50% for other
  platform features. A burst of up to 10 concurrent ships is permitted (≈ 10 × 200 = 2 000 calls over ~20 min,
  < 50% of one hour) provided the hour's starts stay ≤ 12.
- Guard: when `x-ratelimit-remaining` < 1 000 (20%), cache TTLs extend to 60 s and new ship triggers fail
  `PLATFORM_RATE_LIMITED` with Retry-After.
- Also: ≥ 10 concurrent ships across different apps with ≤ 5 min additional queue time at p95 on the
  `ubuntu-latest` pool (trusted jobs are short).
**Assumption**: the cache is per backend process; budget holds for one replica or sticky routing by
correlation ID (OQ-17). Number of replicas multiplies polling cost otherwise.
**Measurement**: Load test with 10 parallel ships; GitHub rate-limit headers and per-correlation call counts
logged via `logger.logMetric`; weekly report of calls/h vs. 2 500 (50% of limit).

### NFR-012 — Log Hygiene

**Target**: Known-pattern redaction: 0 leaks across redaction unit tests on ≥ 10 secret patterns, plus GitHub's
secret masking for platform secrets (the untrusted build job holds none), `ACTIONS_STEP_DEBUG` disabled, and
a manual review of 20 sampled build logs before GA with 0 findings. (Redaction cannot prove a universal
negative; user-committed secrets in the repo are a Wiz-policy matter, OQ-19.)
**Measurement**: Unit tests + manual review of a sampled 20 build logs before GA.

---

## 8. API and Data Impact

### New Endpoints (names are proposals; the Architect finalizes)

| Endpoint | Purpose |
|---|---|
| `GET /api/ship/repos` | List repos readable by **both the requesting user and the App** (allowlisted orgs); cached per user. |
| `GET /api/ship/repos/:org/:repo/branches` | List branches for a repo (same access rule). |
| `POST /api/ship` | Validate, authorize (FR-016) and dispatch the flux-config ship workflow once; returns `correlationId`. |
| `GET /api/ship/status/:correlationId` | `requireAuth` + ownership (AC-013-6). Stage-by-stage status, version, image ref, PR link, preview URL, failure code — from the workflow run, job summary and flux-config PR via a per-correlationId cache. |
| `GET /api/ship/logs/:correlationId` | `requireAuth` + ownership. Redacted build logs, incremental by offset (optionally `?stage=`). |
| `POST /api/ship/:correlationId/cancel` | Cancel a run before `publish` starts (`should`). |
| `POST /api/ship/:correlationId/retry-config-pr` | Re-run only the flux-config config step with the existing image/tag (FR-008 AC-008-7). |

All new responses use `{ success, data | error, correlationId }`.

### Modified Behavior

- **`GET /api/aks-status-by-correlation/:correlationId` gains `requireAuth` and ownership enforcement**
  (FR-013 AC-013-7) — a deliberate, security-motivated behavior change; its frontend caller(s) must send the
  auth token. `POST /api/aks-deploy` and `GET /api/aks-status/:workflowId` are unchanged.
- `services/aksService.js` is reused/extended (retry-config dispatch, run lookup by run-name) — the legacy
  10-run/60-minute window is not relied on for ships.
- `data/environments.json`: **new required per-environment flag `features.shipFromRepo`** (true for `devsand`
  only); `features.aks` alone does not expose the feature.
- Configuration: new settings for allowed orgs, ship workflow repo/ref (flux-config), preview host suffix/scheme.
- New flux-config workflow (ship workflow, four jobs) and a dedicated GitHub environment + OIDC federated
  credential (NFR-003); flux-config ownership of the workflow is a cross-repo dependency.

### Data Contracts and Datastore

- No database. Ship state lives in GitHub (workflow run inputs/run-name/job summary, flux-config PR,
  `selfserve-metadata`) and ACR (tags, OCI labels, locked tags); it persists as long as GitHub's Actions
  retention allows (documented, AC-014-5). flux-config metadata `selfserve-metadata/<app>-<env>.json` may gain
  source repo / version fields (FR-015, optional).
- Image naming: `exampleregistry.azurecr.io/selfserve/<app>:<X.Y.Z>` plus `sha-<shortsha>`; registry from
  `config.aks.defaultImageRegistry`. No `latest`/build-cache tags.

### Backward Compatibility

- Existing AKS deploy page and endpoints keep working for bring-your-own-image users (the legacy status route
  now requires auth).
- Apps shipped via this feature are managed from the Ship from Repo page. The AKS playground pages
  (`AKSDeployPage.vue`, `AKSInstalledAppsPage.vue`) are unchanged; shipped apps may appear in the AKS
  installed-apps list because the metadata source is shared (AC-015-4).
- Tags are fully compatible with the existing Flux ImagePolicy (`^\d+\.\d+\.\d+$`, `semver >=0.0.0`).

---

## 9. UX and Workflow Impact

### User Journey (Happy Path)

1. Sam opens **Ship from Repo**, picks `org/repo` and branch (FR-001).
2. Sam confirms app name, namespace, port, health path; environment is `devsand` (FR-002).
3. Sam clicks **Ship**; the progress view opens with a correlation ID (FR-003, FR-013).
4. The platform dispatches the flux-config ship workflow once; the workflow clones at a pinned SHA (trusted
   job), builds with Buildpacks on a throwaway GitHub-hosted VM, scans with Wiz, and publishes
   `X.Y.Z` + `sha-<shortsha>` to ACR while the UI shows build logs on demand (FR-004–FR-009).
5. The same workflow opens/updates the flux-config PR and the UI shows the PR link and preview URL (FR-008, FR-010).
6. Sam tests the preview; after fixes Sam ships again — same PR, same preview URL, new version (FR-012).
7. Platform team reviews and merges the flux-config PR (existing CODEOWNERS); subsequent ships roll out
   automatically via Flux (FR-012, FR-015).

### Shipping Future Changes (No CI Required)

Sam's question — *"I have no CI; how do my future changes get deployed?"* — is answered in the product,
not in Sam's repository:

| Stage | What Sam does | What the platform does |
|---|---|---|
| Before the flux-config PR is merged (preview) | Push code to the branch, click **Ship new version** (AC-012-6). | Builds, scans, publishes the next `X.Y.Z`; updates the same flux-config PR; same preview URL (AC-012-1). |
| After the flux-config PR is merged | Push code to the branch, click **Ship new version**. | Builds, scans, publishes the next `X.Y.Z`; Flux image automation rolls it out with no new PR (AC-012-2). |
| Port / health-path change | Before approval: change them in **Advanced** and click **Ship new version** (AC-012-3). After approval: ask the platform team (MVP). | Before approval the ship regenerates the PR config; after approval settings stay as merged. |

The **Ship from Repo** workflow in flux-config *is* Sam's CI: it is owned and run by the platform, so Sam never
writes or maintains a pipeline. MVP is deliberately manual (one click per release) so every deployed version
is an explicit user action. Automatic ship on `git push` is a future option (Non-Goals, OQ-21).

### Status and Error Handling

- Every stage shows state; terminal failures show the category panel (FR-011) with log tail, next step,
  correlation ID, and Retry where safe.
- Failure messages never expose secrets or stack traces.
- Empty states: no accessible repos → explanation and App-access request instructions.

---

## 10. Risks, Assumptions, and Open Questions

### Known Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Runner capacity/queueing on `ubuntu-latest` (trusted jobs) slows or blocks ships. | Trusted jobs are short; queue timeout (FR-011), capacity test (NFR-011). |
| R2 | Untrusted user code execution. | Only the throwaway GitHub-hosted `build` job runs it, with no secrets/OIDC/permissions; trusted jobs never run user code; negative-test matrix (NFR-005). Security review before GA. |
| R3 | GitHub App not installed on all enterprise orgs/repos, or no GitHub identity mapping for users → users blocked. | Clear access-request UX (FR-011); org allowlist; OQ-2, OQ-13. |
| R4 | Preview host suffix/scheme mismatch yields a wrong URL. | No hardcoded domain; value from config; OQ-1 gate before FR-010 acceptance. |
| R5 | Re-ship after merge overwrites Flux-updated tag via config regeneration. | Default to publish-only after merge (FR-012 AC-012-2); OQ-3. |
| R6 | Buildpack builds fail for apps not honoring `$PORT` or with unusual structure, producing support load. | In-UI `$PORT` guidance (FR-002), categorized errors (FR-011). |
| R7 | GitHub API rate limits. | Cache + 15 s polling + guard + stated budget (NFR-011). |
| R8 | Image architecture mismatch with AKS nodes. | `linux/amd64` asserted in `build` (AC-004-3). |
| R9 | Name collisions/hijack of existing apps. | FR-016 ownership binding and hard rejection. |
| R10 | GitHub concurrency groups keep one running + one pending run; a third simultaneous ship of one app displaces the pending one. | `SUPERSEDED` code + retry (FR-011); OQ-18. |
| R11 | Anonymous pulls of the public Paketo builder from GitHub-hosted runners may be rate-limited. | Pin by digest; Architect may mirror/authenticate without adding secrets to `build` (OQ-16 spike). |

### Explicit Assumptions

- A1: Trusted jobs on `ubuntu-latest` have network access to GitHub, ACR, Key Vault and can run a daemonless
  registry tool (crane/skopeo) and `az`; GitHub-hosted `ubuntu-latest` has Docker and `pack` available.
- A2: The flux-config/runner/ACR/OIDC/Wiz facts in Section 4 (provided by the product owner) are accurate.
- A3: `devsand` is the only environment in MVP; the `shipFromRepo` flag allows adding more later.
- A4: Users authenticate to the self-service app via Entra ID; their identity is `req.user` / `triggered_by`.
  Mapping to a GitHub login is not yet available (OQ-13).
- A5: Chart `helm/app-workload-deployment` is the default for apps created by `generate-webapp-config.yaml`.
- A6: Resolved defaults (no longer open): Wiz policy `e8ef1254-673e-4761-9e85-303ff6a37f17`, fail closed
  (including Wiz outage); registry `exampleregistry`; image arch `linux/amd64`; ACR repo `selfserve/<app>`;
  workflow repo `flux-config`; build runner GitHub-hosted; publish on `ubuntu-latest`; default port 8080,
  health path configurable; first build `0.1.0`.

### Open Questions

| ID | Question | Owner | Blocking? |
|---|---|---|---|
| OQ-1 | What is the actual `CLUSTER_DNS_SUFFIX` value for `devsand` and the scheme (http vs https) of the preview host `pr-<N>-<app>.${CLUSTER_DNS_SUFFIX}`? (No hardcoded `.k8s.com`.) | Platform Eng (flux-config) | **Yes — FR-010 only** (blocks PRD `approved` status; all other FRs unaffected) |
| OQ-2 | Initial org allowlist, and which GitHub App(s) are installed on those orgs (all vs selected repos) and used for repo listing and the `prepare` single-repo token (code-deployment App expected; `config.js:114` scopes it to organization)? | Platform Eng / Architect | No — resolved in the architecture spec; deployment-time config |
| OQ-3 | Confirm the default that, after the flux-config PR is merged, re-ship publishes only and does not run config generation (FR-012 AC-012-2). | Platform Eng (flux-config) | No — default assumption stands |
| OQ-4 | ~~Workflow repo~~ **Resolved**: `organization/flux-config`; capacity owner for `ubuntu-latest` = SRE. | — | Closed |
| OQ-5 | ~~Default port~~ **Resolved**: 8080, overridable. | — | Closed |
| OQ-6 | ~~Image architecture~~ **Resolved**: `linux/amd64`. | — | Closed |
| OQ-7 | ~~Builder reachability~~ **Resolved**: public Paketo builder from GitHub-hosted runner, pinned. Registry rate-limit handling → R11/OQ-16. | — | Closed |
| OQ-8 | ~~Wiz threshold~~ **Resolved**: policy `e8ef1254-673e-4761-9e85-303ff6a37f17`, pass only on `Scan results: PASSED`, fail closed incl. outage. | — | Closed |
| OQ-9 | ~~ACR naming~~ **Resolved**: `selfserve/<app>` on `exampleregistry`. Non-goal: `latest`/buildcache. | — | Closed |
| OQ-10 | Can GitHub Actions in-progress job logs be retrieved reliably via the API, or must logs only be shown after job completion? | Architect | No — fallback is poll-then-complete |
| OQ-11 | What is flux-config's configured Actions run/log/artifact retention, and is it sufficient for audit? (PRD makes no retention claim beyond it.) | Security/Compliance | No |
| OQ-12 | Should preview readiness be shown in MVP, or strictly only the URL? (Health status is out of scope.) | PM / Product Owner | No |
| OQ-13 | How is an Entra user mapped to a verified GitHub login (e.g., GitHub App user-to-server token, org membership by verified email)? Must support the requester-permission check in FR-016. | Architect | No — spec decision; ships fail closed until defined |
| OQ-14 | Baseline count of current "help me containerize" tickets (for G3). | Platform Eng | No |
| OQ-15 | ACR cleanup/retention policy for locked, orphaned images (locked tags block deletion). | Platform Eng | No |
| OQ-16 | Phase 1 spike: confirm cold-cache build/scan/publish timings (NFR-001), artifact size caps (500 MB source / 2 GB tar), and Paketo builder pull limits. | SRE | No |
| OQ-17 | Backend replica count / sticky routing for per-process cache assumption (NFR-011). | SRE | No |
| OQ-18 | A concurrency group keeps one running + one pending run; confirm GitHub behavior for a 3rd simultaneous ship of one app (displaced run → `SUPERSEDED`) or an alternative queue mechanism. | Architect | No |
| OQ-19 | Does Wiz policy e8ef1254 include secrets detection (user-committed `.env`/keys baked into images)? | Security | No |
| OQ-20 | Who can reach flux-config preview ingress (internal-only/SSO)? Confirm no new exposure. | Platform Eng (flux-config) | No |
| OQ-21 | Post-MVP: should shipped branches auto-ship on `git push` via a platform-owned GitHub App `push` webhook (no CI file in the user's repo)? Needs: who is the requesting user for audit/FR-016, debounce of rapid pushes, opt-in per app, and API budget impact (NFR-011). | PM / Product Owner | No — MVP is manual re-ship (AC-012-6) |
| OQ-22 | Post-MVP: cross-device "my apps" list. Candidate: publish job writes `source_repo`, `shipped_by` and `ship_from_repo: true` into selfserve-metadata, read with a cached server-side index. | Architect / PM | No — MVP uses browser-local recent ships (FR-015) |

---

## 11. Delivery Plan

### Phases

- **Phase 1 — Ship workflow spike to contract (Sprint 1):** the four-job flux-config workflow
  (FR-004, FR-006, FR-007), OIDC identity/environment, trust-separation negative-test matrix (NFR-005),
  cold-cache timing baseline (OQ-16).
- **Phase 2 — Backend (Sprint 2):** ship API, validation, authorization/ownership (FR-016), status/log
  endpoints with caching, `requireAuth` on the legacy status route, chained config hand-off
  (FR-003, FR-008, FR-009, FR-013, FR-014).
- **Phase 3 — Frontend (Sprint 2–3):** pages and components (FR-001, FR-002, FR-009–FR-013, FR-015).
- **Phase 4 — Hardening and pilot (Sprint 4):** security review, load test, usability test, pilot with
  3–5 teams on `devsand`.

### Definition of Done

- All `must` FRs pass acceptance criteria; NFR targets verified or waived by named owner.
- Delivery-contract PRD/spec gates pass; Wiz scan of new workflow and service code passes.
- Pilot teams ship ≥ 5 distinct supported-language repos end-to-end to a working preview.
- Runbook for platform team (runner, Wiz outage, tag lock/orphan images, GitHub retention value) published.
- OQ-1 closed and PRD status moved to `approved` by the Product Owner (not before).

### Rollout and Rollback

- Rollout behind the `features.shipFromRepo` environment flag (devsand only); pilot users first.
- Rollback: disable the flag (hides the feature and rejects `POST /api/ship`); existing images, PRs and
  deployed apps are unaffected because they use existing flux-config flows. Pushed tags remain (locked) in ACR.
  The `requireAuth` change on the legacy status route is not rolled back with the flag.

---

## 12. Test and Validation Strategy

### Backend Unit/Integration

- express-validator tests for every field including injection and git-ref edge cases (NFR-004).
- Semver calculation tests: empty repo, mixed tags, `v` prefixes, `sha-*`, minor/major bumps, no `latest`
  (FR-005); two queued ships get consecutive patches.
- Credential-selection test per service function (NFR-003).
- Log redaction tests ≥ 10 patterns (NFR-012); authorization by correlation ID for owner / app-authorized
  user / platform team / other user, on both the ship status route and the legacy route (AC-013-6/-7).
- Run lookup by run-name for a ship older than 60 min and beyond the 10 most recent runs (AC-013-3).
- Rate-limit budget test: N simulated viewers of one correlation ID produce one upstream call per refresh
  (NFR-011).
- Failure categorization tests mapping workflow outputs → codes (FR-011).
- Authorization: requester without repo read → `REPO_NOT_ACCESSIBLE`; second source repo for an existing app
  name → `APP_OWNED_BY_OTHER` (FR-016).

### Workflow Validation

- Sample repos for Node, Python, Java, Go, .NET (no Dockerfile) build and run on `$PORT`.
- Negative repos: no detectable language, failing build, vulnerable dependency (Wiz gate), Wiz outage
  (fails closed), repo not accessible, Dockerfile-present repo (ignored), hostile repo exercising the
  NFR-005 matrix.
- Trust-separation review: no `ubuntu-latest` step executes repo content; `build` job has `permissions: {}`,
  no secrets/OIDC/environment; scanned tar SHA-256 equals pushed tar.
- Concurrency tests (one expected outcome each): (a) two simultaneous ships of the same app → both run, the
  second queues in `publish` and gets the next patch, no 409, no overwritten tag; (b) same app from a
  different source repo → `APP_OWNED_BY_OTHER`; (c) ten parallel ships of different apps (NFR-011); (d) a
  re-ship's config step never lowers the PR's `image_tag` (AC-008-6); (e) the config-created PR triggers
  `preview-on-pr` (AC-008-5).

### Frontend (Vitest + Vue Test Utils)

- Pickers, config validation, environment gating from `data/environments.json`, progress states, failure
  panels, preview URL display rules, polling stop conditions, accessibility assertions (NFR-010).
- Default-view text uses only the AC-001-8 labels (AC-013-1 mapping, AC-011-8 correlation ID in Details).
- Recent ships: entry written on ship success (AC-015-1), only non-terminal entries refreshed, error/403/404/
  empty states (AC-015-2/-3), 20-entry cap, key scoped to the signed-in user.
- Post-merge: port/health-path fields read-only (AC-012-3); backend test that `POST /api/ship` ignores changed
  port/health path for a merged app (enforced server-side, not only in the UI).

### E2E (Playwright / staging)

- Happy path to flux-config PR + preview URL in `devsand`; re-ship updates same PR and same URL; merge then
  re-ship auto-rolls via Flux; failure scenarios for each category.

### NFR Validation

- Timing from workflow timestamps (NFR-001), latency telemetry (NFR-002), image label inspection
  (NFR-006), audit reconciliation (NFR-007), security review and secrets-in-build test (NFR-005).

---

## 13. Summary Table

| Metric | Count |
|---|---|
| Total Functional Requirements (FR) | 16 |
| Total Non-Functional Requirements (NFR) | 12 |
| `new-feature` (FRs) | 12 (FR-001, 003, 004, 005, 006, 007, 009, 010, 011, 014, 015, 016) |
| `existing-refine` (FRs) | 0 |
| `existing-extend` (FRs) | 4 (FR-002, FR-008, FR-012, FR-013) |
| `unknown-needs-discovery` | 0 (open items tracked as OQ-1, OQ-3, OQ-10 … OQ-20; only OQ-1 is blocking) |

Priority split: FR `must` = 15 (FR-013 AC-013-5 cancel is an AC-level `should`), `should` = 1 (FR-015).

---

## 14. Next Decisions Needed

1. **OQ-1** (blocking, FR-010 only) Actual `CLUSTER_DNS_SUFFIX` value and http vs https for `devsand` — owner
   Platform Eng (flux-config). Required before PRD status can move to `approved`.
2. **OQ-13** How an Entra user maps to a verified GitHub login (Architect, spec-time).
3. **OQ-18** GitHub concurrency-group behavior for a third simultaneous ship (Architect).
4. **OQ-16 / OQ-17** Cold-cache timing/size caps and backend replica model (SRE).
5. Confirm OQ-3 default (publish-only after merge) and OQ-19/OQ-20 with Security / Platform Eng.

---

## 15. Revision log (Round 1 → 2)

| Finding | Resolved in |
|---|---|
| B-1 Untrusted-code isolation | FR-004 (four-job split; AC-004-6/-7/-8), FR-006, FR-007 (AC-007-2/-3 trusted labels, tar SHA-256), NFR-003 (OIDC identity), NFR-005 (negative-test matrix), R2, §12 |
| B-2 Authorization | New FR-016 (requester GitHub access, first-repo ownership, `APP_OWNED_BY_OTHER`); FR-001 AC-001-2/-4; FR-002 AC-002-7; FR-011 AC-011-4; OQ-13 |
| B-3 Concurrency | FR-003 AC-003-5 (no 409), FR-005 AC-005-7, FR-007 AC-007-5/-7 (lock + serialization), FR-008 AC-008-6 (no downgrade), NFR-008, §12 single-outcome tests; OQ-18/R10 caveat |
| B-4 Orchestration/state/audit | FR-003 (dispatch once, workflow self-chains), FR-008, FR-013 AC-013-3 (run-name lookup) / -6 / -7 (`requireAuth` on legacy route), FR-014 + NFR-007 (audit = run + summary + PR + metadata; retention = GitHub's), §8 |
| B-5 Open questions / FR-010 / status | FR-010 description + AC-010-2 (no `.k8s.com`), §10 OQ table (resolved defaults A6, only OQ-1 blocking, FR-010 only), metadata Status `review` |
| B-6 API budget | NFR-011 (numbers: ≤ 200 calls/ship, ≤ 12 ships/h = 48% of 5 000), FR-013 AC-013-2 (15 s poll + cache), FR-009 AC-009-1 (on-demand incremental logs) |
| Major M-1…M-8 | M-1 NFR-012/OQ-19; M-2 FR-008 AC-008-1, FR-010 AC-010-6/OQ-20; M-3 FR-012 AC-012-2; M-4 FR-011 AC-011-1/-1a, FR-007 AC-007-8, OQ-15; M-5 §3 metric sources, OQ-14; M-6 §5 reclassification; M-7 AC-002-1 + §8; M-8 Non-Goals + AC-011-10 |
| Minor m-1…m-8 | m-1 NFR-002/009; m-2 AC-002-3; m-3 AC-003-2; m-4 AC-001-2/NFR-010; m-5 AC-006-2; m-6 AC-004-1; m-7 AC-005-4; m-8 §13 |
| Product owner (post Round 2) | Primary persona renamed to "App Developer with limited platform knowledge" (§2, FR-011, NFR-010); "no CI — how do future changes ship?" answered in §9 "Shipping Future Changes", FR-012 AC-012-6 (**Ship new version**), Non-Goals (auto-ship), OQ-21 |
| Product owner (post Round 2) | Ship from Repo is a dedicated page separate from the AKS playground; reuses AKS backend services only: FR-001 AC-001-7/-8, FR-008 AC-008-1, FR-012 AC-012-3 (**Update settings**), FR-015 rewritten (**My shipped apps**, AC-015-4), §5, §8 Backward Compatibility, §9, §13 — *Update settings and My shipped apps superseded by the Round 3 rows below* |
| Round 3 B-1/B-2 (Update settings) | Removed. Settings are ship inputs; before merge they change via **Ship new version** (serialized, AC-008-6); after merge fixed (AC-012-3, Non-Goals). |
| Round 3 B-3/B-4 (My shipped apps) | FR-015 replaced by browser-local **Recent ships** (AC-015-1..-5): 0 list calls, statuses via cached, authorized status endpoint; NFR-011 line added; cross-device history → OQ-22. |
| Round 3 B-5 (jargon) | AC-001-8 fixed label set + where technical terms may appear; AC-012-2 message reworded; environment read-only, team label in Advanced with default. |
| Round 3 advisories | AC-012-6 prefill fallback; AC-015-3 error/empty states. |
| Round 4 B-5 remainder | AC-013-1 stage → label mapping; AC-011-8 correlation ID moved into **Details**; §12 frontend tests for labels, Recent ships and server-side post-merge settings enforcement. |

---

<!-- ORCHESTRATOR-READY
feature: ship-from-repo
prd_path: docs/prd/ship-from-repo.md
status: approved
fr_count: 16
nfr_count: 12
-->
