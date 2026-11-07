# Bug Diagnosis: redundant-deploy-pipeline

## Report
- Observed behavior: `.github/workflows/deploy-vue.yaml` defines a full build-and-deploy-to-AKS pipeline on push to `main` using GitHub Actions (Docker build → ACR push → `kubectl set image` → rollout → smoke tests → rollback).
- Expected behavior: Per `CLAUDE.md` and `.github/copilot-instructions.md`, image build/push is owned by the Azure DevOps pipeline at `.pipeline/self-service.yaml` (uses shared `docker-build.yaml` template, `docker-vg` + `azdevopsterraform` variable groups, `podman-pool-1` agent). The GitHub Actions `qa-pipeline.yml` already owns the full test pyramid (smoke, unit + coverage gate, integration), Trivy image scan, and ACR build/push on `main`/`develop`. AKS rollout is handled outside these files by FluxCD/Kustomize (see `GET /config.js` runtime endpoint note in CLAUDE.md).
- Environment: CI (GitHub Actions + Azure DevOps)
- Correlation ID: unavailable

## Evidence
- Reproduction: Compare triggers and jobs across the three pipeline files.
  - `deploy-vue.yaml` (`on: push: branches: [main]`): `test` (type-check + `npm test` + `build:client`) → `build-and-push` (Docker build → ACR `sharedwus3acr2.azurecr.io`) → `deploy` (`az login` → `aks-set-context` → `kubectl set image`/`rollout` → smoke tests → `rollout undo` on failure).
  - `qa-pipeline.yml` (`on: push: main, develop, feat/**, fix/**; pr: main, develop`): dependency-audit → smoke-tests → unit-tests (+coverage gate 80%) → integration-tests → test-summary → build-and-push (ACR via `secrets.ACR_REGISTRY`, Trivy scan, SARIF upload). E2E runs in `e2e-sand-tests.yml` on `workflow_run` after QA success.
  - `.pipeline/self-service.yaml` (Azure DevOps, `trigger: main` + path filters; `pr: main` on Dockerfile): builds `self-service-infra` image via shared `docker-build.yaml@docker` template with `docker-vg`/`azdevopsterraform` variable groups on `podman-pool-1`.
- Existing contract:
  - `CLAUDE.md` — "Pipeline Ownership: Azure DevOps pipeline definition lives in `.pipeline/self-service.yaml`. Pipeline is scoped to core app changes … and builds/pushes `self-service-infra` container image using shared templates."
  - `copilot-instructions.md` — same statement under "Pipeline Ownership".
  - `qa-pipeline.yml` — already implements the test gates and the ACR build/push + Trivy scan on `main`/`develop`.
- Affected paths: `.github/workflows/deploy-vue.yaml` (candidate for removal); `.github/workflows/qa-pipeline.yml` (stays — testing); `.pipeline/self-service.yaml` (stays — canonical build/push); `kubernetes/` is not owned by this workflow.

## Overlap Matrix

| Capability | `deploy-vue.yaml` (GH) | `qa-pipeline.yml` (GH) | `.pipeline/self-service.yaml` (ADO) |
|---|---|---|---|
| type-check | ✅ test job | ✅ unit-tests job | ❌ |
| `npm test` (jsdom) | ✅ test job | ✅ unit-tests job (coverage) | ❌ |
| `build:client` | ✅ test job | ✅ smoke-tests + unit-tests | (inside Docker image) |
| smoke / integration tests | ❌ | ✅ | ❌ |
| coverage gate (80%) | ❌ | ✅ | ❌ |
| Trivy image scan | ❌ | ✅ | (governed by shared template) |
| Docker build + ACR push | ✅ build-and-push | ✅ build-and-push | ✅ (canonically) |
| AKS `kubectl set image` + rollout | ✅ deploy job | ❌ | ❌ (FluxCD owns rollout) |
| Rollback on failure | ✅ deploy job | ❌ | ❌ (FluxCD reconciles) |

## Classification
- Classification: confirmed_bug (redundant/divergent CI path violating the documented pipeline-ownership contract)
- Rationale: `deploy-vue.yaml` duplicates the build/push already owned by Azure DevOps and the tests already owned by `qa-pipeline.yml`, and adds a `kubectl set image`/rollout path that conflicts with the documented FluxCD/Kustomize AKS rollout model. Keeping it active risks racing the ADO image build, deploying an unscanned image (no Trivy gate), and bypassing the coverage gate.
- Scope owner: SelfService Debugger (CI workflow file removal — not a deployment manifest or k8s edit; this is a dead GitHub Actions workflow, not `Dockerfile`, `kubernetes/`, `.pipeline/`, or auth code)

## Root Cause
- Hypothesis: `deploy-vue.yaml` is a pre-ADO/pre-QA-pipeline prototype that was never retired. Its test/build jobs are a strict subset of `qa-pipeline.yml`, its registry reference (`sharedwus3acr2.azurecr.io` hardcoded) diverges from `qa-pipeline.yml`'s `secrets.ACR_REGISTRY`, and its `deploy` job performs imperative `kubectl set image` against what is documented as a FluxCD-managed cluster.
- Discriminating check: Does any documented contract or runtime requirement depend on `deploy-vue.yaml`'s `deploy` job (kubectl rollout / smoke / rollback) that `qa-pipeline.yml` + `.pipeline/self-service.yaml` + FluxCD do not already cover?
- Result: No. `qa-pipeline.yml` already runs smoke/unit/integration/coverage on push to `main` and builds+scans the image; `e2e-sand-tests.yml` runs post-deploy E2E; `.pipeline/self-service.yaml` is the documented owner of image build/push; AKS rollout is FluxCD-owned per CLAUDE.md. The only `deploy-vue.yaml`-unique steps are imperative kubectl rollout + rollback — exactly the path the docs say to avoid. → Hypothesis confirmed: the file is redundant and actively divergent.

## Resolution
- Status: ready_for_reproduction
- Changed paths: (proposed) delete `.github/workflows/deploy-vue.yaml`
- Focused validation:
  - `grep -rn "deploy-vue" .github workflows .pipeline docs` → expect no references after removal (pre-check: none found outside the file itself).
  - Confirm `qa-pipeline.yml` still triggers on push to `main` (it does) — testing is preserved.
  - Confirm `.pipeline/self-service.yaml` still builds/pushes the image (it does) — build/deploy is preserved via the canonical owner.
- QA results: tests/results/redundant-deploy-pipeline-results.json | not_run
- Residual risk:
  - If a human is currently relying on the imperative `kubectl set image` rollout from `deploy-vue.yaml` (e.g., FluxCD not yet wired for `self-service-test` namespace), removing the file will silence that path. Mitigation: confirm with SRE DevOps that FluxCD reconciles `self-service-test` before deletion, or keep the workflow disabled via a `conclusion: disabled` guard until confirmed. Per Debugger ownership, I do not edit k8s/FluxCD manifests — this residual must be owned by SRE DevOps.
  - Removing the file forfeits the `rollback on failure` step. This is safe because FluxCD reconciliation + the ADO image promotion path is the documented deployment model; imperative rollback in a GH Action is not a contract.
