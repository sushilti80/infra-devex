# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Self-service web platform for provisioning, deploying, and deleting Azure infrastructure via standardized Terraform modules. **GitHub is the single source of truth** — there is no database; all metadata lives as JSON in the `docs/metadata/` folder of the service-catalog repo and is read/written through the GitHub API.

- **Frontend**: Vue 3 (Composition API) + TypeScript + Pinia + Tailwind, in `srcV2/` — the sole frontend codebase (the legacy Vanilla JS `public/` was removed; archived at git tag `v2.0.0-pre-vanilla-cleanup`)
- **Backend**: Node.js 20+ / Express 4, in `server.js` + `routes/api.js` + `services/`
- **Build**: Vite bundles `srcV2/` to `dist/`; `server.js` always serves static assets from `dist/` and falls back to `dist/index.html` for SPA routing

## Development Commands

```bash
npm run dev                 # Backend dev server (nodemon, port 3000)
npm run dev:client          # Frontend dev server (Vite HMR, port 5173, proxies /api to :3000)
npm run build:client        # Type-check (vue-tsc) + production build to dist/
npm run type-check          # TypeScript check only (vue-tsc --noEmit)
npm start                   # Serve production build from dist/ via Express (requires build:client first)
```

Local dev requires two terminals (`dev` + `dev:client`) — the Vite dev server proxies API calls to the Express backend; it does not run the backend itself.

### Testing

Vitest is split into two **projects** (see `vitest.config.ts`): `node` (smoke + integration tests, hit real Express routes/services) and `jsdom` (Vue component/composable/store specs, environment = jsdom). `npm test` only runs the `jsdom` project.

```bash
npm test                          # Vue component/composable/store specs (jsdom project)
npm run test:smoke                # tests/smoke/**/*.spec.ts (node project)
npm run test:integration          # tests/integration/**/*.spec.ts (node project)
npm run test:coverage             # jsdom project with v8 coverage (srcV2/**/*.{ts,vue})
npm run test:watch                # vitest in watch mode
npm run test:ui                   # vitest --ui
npm run test:e2e                  # Playwright, tests/e2e/ (chromium/firefox/webkit + mobile viewports)

# Run a single test file
npx vitest run --project jsdom srcV2/components/infrastructure/ModuleSelector.spec.ts
npx vitest run --project node tests/integration/api/feedback.spec.ts
npx playwright test tests/e2e/custom-infra.spec.ts
```

Playwright's `webServer` expects a build already served on `BASE_URL` (default `http://localhost:3001`); it does not rebuild for you. E2E auth state is captured once via `tests/e2e/auth.setup.ts` into `.auth/user.json` and reused across browser projects.

Coverage targets: Components 80%, Composables 90%, Services 85%. Mock the GitHub API in tests — never hit it for real.

## Architecture

### GitHub-as-database

`services/githubService.js` wraps two separate Octokit clients:
- **Infrastructure App** (`this.octokit`) — provisions/deletes infra, triggers Terraform workflows
- **Code Deployment App** (`this.codeOctokit`) — deploys application code / AKS manifests, used by `/api/add-code-repo`

Never cross the two clients' credentials. Metadata reads/writes go through `rest.repos.getContent()` / `createOrUpdateFileContents()`; workflow triggers go through `rest.actions.createWorkflowDispatch()`. `services/infrastructureService.js` is the layer that fetches and shapes this metadata for the frontend; `services/databaseService.js` is an unused placeholder — do not build real functionality on it.

### Request flow (async workflow pattern)

Almost every mutating action follows the same shape:

```
Vue page action → POST /api/<endpoint> (routes/api.js, express-validator)
  → services/*.js builds metadata + calls githubService.triggerWorkflow()
    → creates/updates a PR in the service-catalog repo, dispatches a GitHub Actions workflow
  → API responds { success, correlationId, prNumber }
  → SPA opens a status modal, polls GET /api/status/:correlationId (~every 5s) until success/failure/timeout
  → webhook (POST /api/webhook/github) observes the merge; metadata then shows up in installed-apps
```

AKS deploys use their own status endpoints (`/api/aks-status/:workflowId`, `/api/aks-status-by-correlation/:correlationId`) instead of `/api/status`.

### Correlation ID tracing

`server.js` middleware stamps every request with `req.correlationId = uuidv4()`; it threads through logger calls, PR descriptions, workflow dispatch payloads, and API responses. When debugging a user-reported issue, search logs/PRs for the correlation ID rather than timestamps — it's the one identifier that survives the client → API → GitHub Actions → webhook hop.

### Backend layout

- `routes/api.js` — ~35 REST endpoints (all under `/api`), grouped roughly by: custom/template infra CRUD (`/custom`, `/template`, `/delete`, `/promote`), catalog data (`/templates`, `/modules`, `/roles`, `/environments`, `/agents`), installed apps + metadata (`/installed-apps`, `/app-metadata/:appName/:environment`, `/deployed-apps*`), secrets (`/secrets*`), RBAC (`/rbac-relationships`), AKS (`/aks-*`), agent-driven changes (`/agent-change`), feedback-to-GitHub-Issue (`/feedback`), and `/debug/*` introspection routes.
- `services/githubService.js` — dual Octokit clients (see above)
- `services/infrastructureService.js` — metadata orchestration/transforms
- `services/aksService.js` — AKS deploy orchestration (web apps + agents, workload identity grants)
- `services/secretsService.js` — Key Vault secret self-service (see Dockerfile's `sops` install for the encryption path)
- `services/hclParser.js` / `services/terragruntLocalsResolver.js` — parse existing Terraform/Terragrunt state to support "edit existing infra" flows
- `middleware/auth.js` + `utils/jwtValidator.js` — stateless Entra ID (Azure AD) JWT bearer validation; no session storage
- `middleware/verifyWebhook.js` — HMAC-SHA256 verification for the GitHub webhook route
- `utils/logger.js` — Winston logger; always pass the correlation ID
- Datadog APM (`dd-trace`) is initialized at the very top of `server.js`, before other requires, wrapped in try/catch so a missing/misconfigured agent never blocks startup — prefers a Unix socket at `/var/run/datadog/apm.socket` (AKS DaemonSet), falls back to TCP for local dev.

### Frontend layout (`srcV2/`)

- `pages/` — one component per route (`CustomInfrastructurePage`, `TemplateDeployPage`, `InstalledAppsPage`, `AKSDeployPage`, `AKSInstalledAppsPage`, `ExistingInfraChangePage`, `SecretsPage`, `FeedbackPage`, `DocsPage`); routing itself is driven by `stores/navigation.ts`, not vue-router
- `stores/` — Pinia: `auth.ts`, `navigation.ts`, `workflow.ts`, `environments.ts`
- `composables/useWorkflowPolling.ts` — the polling-until-terminal-status logic described above
- `composables/useAuth.ts` / `services/authService.ts` — MSAL-based Entra ID login
- `services/api.ts` — axios layer all pages/stores should call through rather than hitting endpoints directly

**Environment feature flags**: `data/environments.json` defines per-environment flags (`customInfra`, `templates`, `aks`) served via `GET /api/environments` and consumed by `useEnvironmentsStore` — do not hardcode environment lists in Vue pages.

**Edit-existing-infra / prefill flow**: editing an installed app sets `navigationStore.prefillContext = { appName, environment }` and navigates to `custom-infra`; `CustomInfrastructurePage` reads it on mount, fetches `GET /api/app-metadata/:appName/:environment`, and reconstructs module/RBAC selections from the flat metadata shape (module-type prefix matching in `parseModuleInstances()`). This feature is gated behind the `VITE_ENABLE_CATALOG_PREFILL` build arg — see `docs/EDIT-INFRASTRUCTURE-GUIDE.md`.

### Config & data

- `config.js` — Azure subscription IDs per environment name (e.g. `devsand`, `sand`), surfaced to the frontend via the runtime `GET /config.js` endpoint (not a static file — injects `VITE_ENTRA_*`/`AZURE_AD_*` env vars at request time so FluxCD/Kustomize ConfigMaps can change auth config without a rebuild)
- `data/modules.json` — Terraform module catalog (storageV2, keyvault, RBAC, appServiceWindows/Linux, functionApp, serviceBus, sqldb, eventGridTopics, aiFoundry, UserAssignMSI, …)
- `data/agents.json` — AI agent definitions for `/api/agent-change` (active agents: `topicsubscription`, `storage`, `servicebus`)
- `data/environments.json`, `data/roles.json`, `data/templates.json`

## Docker

The single multi-stage `Dockerfile` (there is no `Dockerfile.vue` — older docs/README references to it are stale) builds:
1. `frontend-builder` (node:24-alpine) — `npm ci --legacy-peer-deps`, `npm run build:client`
2. `release` (node:24-alpine) — production deps only, installs `sops` (checksum-verified) for the secrets-service encryption path, copies backend code + `dist/` from stage 1, runs as non-root `node` user

```bash
docker build -t self-service-infra:latest -f Dockerfile .
docker run -d --name self-service-infra -p 3000:3000 \
  -e GITHUB_APP_ID=... -e GITHUB_INSTALLATION_ID=... \
  -v /path/to/github-key.pem:/app/secrets/github-key.pem:ro \
  self-service-infra:latest
curl http://localhost:3000/health   # Docker/K8s health probe
```

`validate-dockerfile-vue.sh` runs a fuller build+runtime validation locally.

## Pre-commit Hooks & Code Style

This repo uses pre-commit hooks that **fail and auto-fix** files if violations are found. After the hook modifies files, re-stage before the commit will succeed:

```bash
git add -u && git commit -m "your message"
```

Critical rules enforced automatically:
- **No trailing whitespace**
- **Newline at end of file**
- **No merge conflict markers** (`<<<<<<<`, `=======`, `>>>>>>>`)
- **No hardcoded secrets** (API keys, tokens, private keys)

## Conventions

- All new features go in `srcV2/` (Vue) + `routes/api.js` + `services/` — never resurrect the vanilla-JS `public/` pattern
- Never add a real database; `services/databaseService.js` stays a placeholder
- Every API response follows `{ success, data | error, correlationId, prNumber? }`; every new endpoint validates input with `express-validator` and logs via `utils/logger.js` with the correlation ID
- Long-running operations (provision, delete, AKS deploy) always go through the status-modal + polling pattern — never block the UI waiting on a GitHub Actions run
- Azure subscription IDs live in `config.js`; keep them in sync with `data/environments.json`
