# Quick Start Guide

## Overview

Self-Service Infrastructure Catalog is a **Vue 3 + Node.js/Express** web platform for provisioning,
deploying, and managing Azure infrastructure. GitHub is the single source of truth — all state and
metadata are stored as JSON files in GitHub repositories (no database).

---

## 1. Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18+ (20+ recommended) |
| npm | 8+ |
| Podman / Docker | Any recent version |
| GitHub Apps | Infrastructure App + Code Deployment App |
| Azure subscription | With appropriate permissions |
| Microsoft Entra ID | App registration for authentication |
| Datadog account | US3 site (`us3.datadoghq.com`) — for observability dashboards |

---

## 2. First-Time Setup

```bash
# Clone and install
git clone <repository-url>
cd self-service-infra
npm install

# Create your environment file
cp .env.example .env
```

Edit `.env` and fill in the required values:

```
# Infrastructure GitHub App
GITHUB_APP_ID=
GITHUB_INSTALLATION_ID=
GITHUB_PRIVATE_KEY_PATH=./secrets/github-key.pem

# Code Deployment GitHub App
GITHUB_CODE_APP_ID=
GITHUB_CODE_INSTALLATION_ID=
GITHUB_CODE_APP_PRIVATE_KEY_PATH=./secrets/github-code-key.pem

# GitHub repos
GITHUB_SERVICE_REPO=organization/service-catalog
GITHUB_INFRA_LIVE_REPO=organization/example-infra-live
GITHUB_AKS_REPO=organization/flux-config

# Entra ID (authentication)
AZURE_AD_CLIENT_ID=
AZURE_AD_TENANT_ID=
VITE_ENTRA_CLIENT_ID=
VITE_ENTRA_TENANT_ID=
VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>

# Datadog APM (optional locally, required in sand/prod)
# Set DD_TRACE_ENABLED=false to disable tracing in local dev
DD_ENV=development
DD_TRACE_ENABLED=true
```

---

## 3. Running the App

### Option A — Single process (simplest)

```bash
npm run build:client   # Build Vue frontend once
npm start              # Serve everything on http://localhost:3000
```

### Option B — Two-process dev mode (hot reload)

```bash
# Terminal 1: Express API
npm run dev

# Terminal 2: Vite dev server with HMR
npm run dev:client
# Open http://localhost:5173
```

Use Option B when actively developing Vue components — changes reload instantly without rebuilding.

---

## 4. Features

After logging in with your Microsoft account you land on the home dashboard with six feature cards.

### Custom Infrastructure

**Card**: Build → Custom Infrastructure

Compose Azure infrastructure by selecting one or more Terraform modules (Key Vault, Storage,
App Service, Function App, SQL, Service Bus, AKS, AI Foundry, etc.). The platform creates a
Pull Request in the `service-catalog` repository which triggers a GitHub Actions Terraform workflow.

- Select environment (devsand, sand, …)
- Pick modules from `data/modules.json` (pulled live from GitHub)
- Submit → PR opened → Terraform plan/apply runs
- Track progress via the status modal (correlationId polling)

### Template Deploy

**Card**: Dashboard → Template Deploy

Deploy a pre-configured template (pre-set module combinations) instead of building from scratch.
Useful for common stack patterns defined in `data/templates.json`.

### Installed Apps

**Card**: Apps → Installed Apps

View all provisioned infrastructure entries read from `service-catalog/docs/metadata/*.json`.
Each entry shows project name, environment, owner, provisioned modules, and current lifecycle status.

- Filter by environment or search by name
- `View in Azure Portal` link per entry
- Delete / Promote to production actions

### AKS Playground

**Card**: Cloud Upload → AKS Playground

Deploy a containerized application to Azure Kubernetes Service via the `flux-config` GitOps repository.
The page title is **Deploy to Sand AKS** — only environments with `aks: true` in `data/environments.json`
appear in the environment dropdown. **Both `devsand` and `sand` are AKS-enabled environments**;
`devsand` is the default selection for teams doing sandbox development.

#### Core fields (all deployment types)

| Field | Description |
|---|---|
| Environment | AKS-enabled environments only (`devsand`, etc.) |
| Application Name | Lowercase alphanumeric + hyphens, Kubernetes-compliant |
| Namespace | Defaults to app name; must be Kubernetes-compliant |
| Deployment Type | **App** (HTTP/HTTPS with ingress) or **Agent** (background service, no ingress) |
| Container Image | Full registry path, e.g. `exampleregistry.azurecr.io/my-app` |
| Image Tag | e.g. `latest`, `v1.0.0`, or a specific commit SHA |

#### Web App Configuration (App deployment type only)

| Field | Description |
|---|---|
| Team Label | Applied to the Kubernetes namespace (e.g. `software-engineering`) |
| Application Port | Port your container listens on (default: `80`) |
| Health Check Path | Liveness and readiness probe endpoint (default: `/healthz`) |

#### Environment Variables — set by you

Static key-value pairs injected into the container at runtime. Click **Add Env Var** to add rows.
**You define all environment variables yourself** — no platform team involvement needed.

| Column | Description |
|---|---|
| NAME | Environment variable name (uppercased automatically) |
| value | Plaintext value |

> These are for **non-sensitive** config only. Use Secret Env Vars for sensitive values.

#### Secret Env Vars — set by you, sourced from Kubernetes Secret

Environment variables sourced from an existing Kubernetes secret. Click **Add Secret Var** to add rows.
**You specify both the env var name and the Kubernetes secret key yourself.**

| Column | Description |
|---|---|
| Env Var Name | Name injected into the container (e.g. `GITHUB_APP_ID`) |
| Secret Key | Key inside the Kubernetes secret that holds the value |

#### Key Vault Integration (ExternalSecret)

Toggle **Key Vault Integration** on to create an `ExternalSecret` resource that syncs secrets from
Azure Key Vault into a Kubernetes secret. Click **Add KV Secret** to map secrets.

| Column | Description |
|---|---|
| KV Secret Name | Secret name as it exists in Azure Key Vault (e.g. `github-app-id`) |
| k8s Secret Key | Key name in the resulting Kubernetes secret (e.g. `GITHUB_APP_ID`) |

> **Important**: All KV Secret Names listed must already exist in the Azure Key Vault for the
> selected environment **before the PR is merged**. Missing secrets will prevent pods from starting.

Submitting dispatches a workflow in `flux-config` which writes Kubernetes manifests and deployment
metadata to `selfserve-metadata/{appname}-{envname}.json`.

### AKS Apps

**Card**: DNS → AKS Apps

Read-only view of all applications deployed via the AKS Playground. Metadata is read from
`flux-config/selfserve-metadata/*.json` (written by the flux-config workflow, never directly by this app).

Table columns: **App / Namespace** · **Environment** · **Image** · **Owner** · **Deployed At / Commit**

- Search by app name, namespace, owner, or image
- Filter by AKS-enabled environment
- Refresh button to re-fetch latest data
- Empty state links back to AKS Playground

> **Note for flux-config workflow owners:** The workflow must write metadata to
> `selfserve-metadata/{appname}-{envname}.json` using the schema documented in
> `docs/Architecture.md`. The `deployment_type` input passed by this app (`app` or `agent`)
> identifies which template was used.

### Existing Infrastructure Change

**Card**: Edit Square → Existing Infrastructure Change

Three-step wizard to request infrastructure modifications using specialized AI agents. **This flow
is fully implemented** and dispatches real GitHub Actions workflows via the agentic dispatch system.

1. **Select Agent** — choose the agent type that matches your change request (populated from `data/agents.json`)
2. **Fill Inputs** — agent-specific form fields validated before proceeding to the next step
3. **Review & Submit** — confirm all details; submitting opens a PR in `service-catalog` and triggers the agent workflow

- `triggeredBy` is auto-populated from your authenticated Microsoft Entra ID email — no manual entry needed
- Navigation between steps requires valid input; you can go back to a completed step at any time
- Track workflow progress via the status modal (correlationId polling)

### Secrets

**Card**: Key → Secrets *(only visible when at least one environment has `secrets: true` in
`data/environments.json`)*

Submit new or updated Key Vault secret values for your application through the same PR-and-review
process used for infrastructure changes. Values are encrypted server-side and are **never
displayed again** after submission — the form only tracks whether the confirmation matches, not
the value itself.

1. **Infrastructure target** — choose **Live** or **Sandbox**. This determines which app/environment
   list and Key Vaults are queried.
2. **Application** — pick the app you're submitting secrets for. Changing this resets your
   environment selection.
3. **Environments** — multi-select checkboxes, grouped into **Production**, **Non-Production**, and
   **Other**. Up to 10 environments per submission.
   - With exactly one environment selected, the page resolves its Key Vault (and sub-application
     qualifier, if the app has more than one) automatically.
   - With more than one environment selected, each is resolved independently — an environment with
     an ambiguous or unresolvable Key Vault is marked **excluded** with a reason and is simply left
     out of the submission; it never blocks the other environments.
4. **Key Vault** — shown once resolved. Auto-selected and disabled when only one vault exists;
   choose manually if the app resolves to more than one.
5. **Sub-application** — only appears when an app has multiple qualifiers (e.g. an app with `notif`
   and `autobk` sub-apps under the same Key Vault). Required before a vault can be chosen.
6. **Jira/CR Number** — required, format `JIRA-1234` or `CR-5678`.
7. **Secrets** — add up to 20 rows. Each row needs a **name** (1-127 letters/numbers/hyphens, unique
   within the submission), a **value**, and a **confirm value** that must match exactly. Click
   **Add Secret** for more rows.
8. **Submit secrets** — if any selected environment is production-tier, a confirmation dialog lists
   the production environment(s) and requires an explicit **Confirm production write** click before
   any request is sent; **Cancel** makes no API call.

On submit, the backend encrypts each value and opens (or updates) a pull request per environment in
the `service-catalog` repository — the same status modal + correlationId pattern used elsewhere
tracks progress. Submitting to a single environment shows one PR link; submitting to multiple shows
a per-environment result list, and a partial success (some environments succeed, others fail) is
reported as its own outcome rather than a page-level error — failed environments can be resubmitted
without resubmitting the ones that already succeeded.

### Request Feature / Bugfix

**Nav bar**: top-right → **Request Feature/Bugfix**

Raises a GitHub issue in this repository directly from the UI. Three request types are supported.
**Agent requests are backed by the platform's agentic teams** — issues labeled `agent-request` are
picked up by the agentic orchestration workflow for triage, scope, and delivery.

#### Bug Report

| Field | Description |
|---|---|
| Title | Short summary (max 120 characters) |
| Observed Behaviour | What is actually happening |
| Expected Behaviour | What should happen instead |
| Steps to Reproduce | Numbered steps to trigger the bug |
| Severity | `Critical` / `High` / `Medium` / `Low` |

#### Feature Request

| Field | Description |
|---|---|
| Title | Short summary (max 120 characters) |
| Pain Point | Current problem or limitation |
| Desired Outcome | What the feature should achieve |
| Business Justification | Why this is valuable |
| Priority | `High` / `Medium` / `Low` |

#### Agent Request

| Field | Description |
|---|---|
| Title | Short summary (max 120 characters) |
| Agent Type | Which agent or automation this relates to |
| Desired Agent Behaviour | What the agent should do differently |
| Business Justification | Why this agent change is needed |

On submission the backend creates a GitHub issue in `organization/self-service-infra` and returns
a direct link to the issue. Your Entra ID email is automatically attached as the reporter.
Issues are automatically labeled (`bug`, `feature-request`, or `agent-request`) and are visible
in the repository's issue tracker for the platform team to triage.

> **Prerequisite**: The Infrastructure GitHub App must have **Issues: Read and write** permission
> granted **and approved on the installation**. See [Common Issues](#7-common-issues) if you get a 500 error.

---

## 5. Observability — Datadog Dashboards

Three Phase 1 dashboards are defined as JSON in `docs/dashboards/` and deployed automatically to
Datadog via GitHub Actions.

### Dashboards

| File | Dashboard | What it shows |
|---|---|---|
| `docs/dashboards/api-health.json` | Self Service Infra — API Health | Availability %, 5xx error rate, p50/p95 latency, slowest endpoints |
| `docs/dashboards/workflow-reliability.json` | Self Service Infra — Workflow Reliability | Trigger/completion success rates, completion time p50/p95, polling timeout rate |
| `docs/dashboards/dependency-health.json` | Self Service Infra — Dependency & Queue Health | GitHub API latency by operation, auth failures, fallback-to-local count |

### Finding dashboards in Datadog

1. Log in at `https://app.us3.datadoghq.com`
2. **Dashboards → Dashboard List** — search for `Self Service Infra`
3. Or filter by tag: `managed-by:github-actions`

### Deploying dashboards

The workflow [`.github/workflows/deploy-dashboards.yml`](.github/workflows/deploy-dashboards.yml)
runs automatically when any file under `docs/dashboards/` is merged to `main`, or can be triggered
manually:

**GitHub → Actions → Deploy Datadog Dashboards → Run workflow → select environment**

### Required GitHub secrets and variables

| Secret / Variable | Where to set | Description |
|---|---|---|
| `DD_API_KEY` (secret) | Repo or Environment | Datadog org API key |
| `DD_APP_KEY` (secret) | Repo or Environment | Datadog Application Key — needs `dashboards_read` + `dashboards_write` scopes |
| `DD_SITE` (variable) | Repo | Datadog site — set to `us3.datadoghq.com` |

> The `prod` GitHub Environment should have **required reviewers** configured to prevent accidental
> production dashboard updates.

### APM instrumentation

`dd-trace` is initialised at the top of `server.js` and auto-instruments Express routes, giving you
request rate, latency histograms, and error rate immediately. Set `DD_TRACE_ENABLED=false` in `.env`
to disable locally if not sending traces to Datadog.

Custom business metrics (workflow counters, GitHub API latency) are emitted via `hot-shots` in the
service layer. Both packages are in `package.json` — install with `npm install --legacy-peer-deps`.

### Adding a new dashboard

1. Create a new JSON file in `docs/dashboards/` following the Datadog Dashboards API v1 schema.
2. Include `"tags": ["managed-by:github-actions"]` in the root object.
3. Commit and push to `main` — the deploy workflow handles the rest.

---

## 6. Environment Configuration

Environments and their feature flags live in `data/environments.json` (loaded from GitHub `main`
branch at runtime via `GET /api/environments`; falls back to local file if GitHub is unreachable).

```json
{
  "id": "devsand",
  "displayName": "IT Sandbox",
  "features": {
    "customInfra": true,
    "templates": true,
    "aks": true
  }
}
```

Feature flags control which environments appear in each feature's dropdown. Only environments with
`aks: true` appear in the AKS Playground / AKS Apps filter.

---

## 7. Architecture Summary

```
Browser (Vue 3 SPA)
       │
       │ /api/*
       ▼
Express Server (:3000)
  ├── routes/api.js          — 30+ REST endpoints
  ├── services/
  │   ├── githubService.js   — Dual Octokit clients (Infra App + Code App)
  │   ├── infrastructureService.js  — Reads service-catalog + flux-config metadata
  │   └── aksService.js      — AKS workflow dispatch
  └── middleware/auth.js     — Entra ID JWT validation

GitHub Repositories (source of truth)
  ├── service-catalog/docs/metadata/   — Custom infra JSON
  └── flux-config/selfserve-metadata/     — AKS deployment JSON
```

All long-running operations follow the **async workflow polling pattern**:

```
User submits → POST /api/... → GitHub workflow dispatched → correlationId returned
                                                                     │
Status modal polls GET /api/workflow-status?correlationId=X  ◄───────┘
until status = success | failure | timeout
```

---

## 8. Common Issues

### "Cannot GET /api/..."
Express backend is not running. In two-process mode make sure Terminal 1 (`npm run dev`) is up.

### "Port 3000 already in use"
```bash
lsof -ti:3000 | xargs kill -9
```

### "Port 3001 / port already in use"
```bash
lsof -ti:3001 | xargs kill -9
```

### "Build failed" or TypeScript errors
```bash
node -v               # Must be 18+
rm -rf dist && npm run build:client
```

### `dd-trace` module not found on startup
```bash
npm install dd-trace hot-shots --legacy-peer-deps
```
Or set `DD_TRACE_ENABLED=false` in `.env` to skip Datadog tracing entirely in local dev.

### Dashboard deploy workflow fails with 403
The Datadog Application Key (`DD_APP_KEY`) is missing the required scopes. Go to
**Datadog → Organization Settings → Application Keys → [your key] → Scopes** and add
`dashboards_read` and `dashboards_write`.

### Dashboard deploy workflow fails with "No JSON files found"
Ensure at least one `.json` file exists under `docs/dashboards/` in the branch being deployed.

### devsand not showing in AKS dropdown
Check `data/environments.json` — `devsand` must have `"aks": true` under `features`. This is
enabled by default. If missing, ensure the file has been pulled from `main` (the environments file
is loaded from GitHub at runtime and falls back to the local copy).

### AKS Apps page shows empty / no data
The `flux-config/selfserve-metadata/` folder does not exist or is empty. Deploy at least one app via
the AKS Playground, and confirm the flux-config workflow writes the metadata file after deployment.

### Authentication redirect loop
Verify `VITE_ENTRA_CLIENT_ID`, `VITE_ENTRA_TENANT_ID`, and the redirect URI registered in Entra ID
matches `http://localhost:5173` (dev) or your production URL.

---

## 9. Useful Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start Express backend (nodemon) |
| `npm run dev:client` | Start Vite dev server with HMR |
| `npm run build:client` | Production build → `dist/` |
| `npm start` | Serve built app on :3000 |
| `npm test` | Run Vitest unit/component tests |
| `npm run test:coverage` | Coverage report |
| `npm run type-check` | TypeScript check (`vue-tsc`) |
| `npm install --legacy-peer-deps` | Install all deps (incl. dd-trace/hot-shots) |

---

## 10. Further Reading

| Document | Description |
|---|---|
| [README.md](README.md) | Full project documentation |
| [docs/Architecture.md](docs/Architecture.md) | System design, GitOps patterns, ADRs |
| [docs/Architecture-Quick-Reference.md](docs/Architecture-Quick-Reference.md) | API & patterns cheat sheet |
| [docs/AUTHENTICATION-GUIDE.md](docs/AUTHENTICATION-GUIDE.md) | Entra ID setup step-by-step |
| [docs/Vue-Architecture-Diagram.md](docs/Vue-Architecture-Diagram.md) | Vue dev modes, HMR setup |
| [CLAUDE.md](CLAUDE.md) | AI agent / coding assistant context |
| [docs/Observability-Implementation-Plan.md](docs/Observability-Implementation-Plan.md) | Full SLI/SLO spec, metric names, alert thresholds |
| [docs/dashboards/](docs/dashboards/) | Datadog dashboard JSON definitions |
