## Copilot AI Agent Instructions: Self-Service Infrastructure Catalog

### Project Overview
Web-based self-service platform for provisioning, deploying, and deleting Azure infrastructure using Terraform modules. **GitHub is the single source of truth** for all state/metadata (no database). Backend: Node.js 18+/Express. Frontend: **Vue 3 SPA** (`srcV2/`). See [docs/Architecture.md](../docs/Architecture.md) for deep dives into GitOps patterns, dual GitHub Apps, and component interactions.

### Repository Discovery: Read .ai/ai-repo.md First
Before broad repository discovery, read [.ai/ai-repo.md](../.ai/ai-repo.md) and follow `.github/skills/repository-context/SKILL.md`. The generated map is the cheapest source for repository structure, agent/skill/workflow inventory, key entry points, package scripts, and external repository references. Use Graphify only for relationship or dependency questions and only when its snapshot is actually available; otherwise use targeted search. Always read the exact current file before editing it or making a file-specific claim. Broad grep/tree sweeps are the final fallback, not the starting point.

### Core Architectural Patterns

#### GitHub-as-Database Pattern
- **Source of truth**: All metadata stored as JSON in service-catalog repo's `docs/metadata/` folder
- **No database**: `DatabaseService` is a placeholder; all real data flows from GitHub API
- **Example structure**: `projectName-environment.json` contains: projectName, environment, owner, modules[], lifecycle, status, createdAt, prNumber, etc.
- **Usage**: [infrastructureService.js](../services/infrastructureService.js) fetches metadata via GitHubService; transforms it for frontend consumption

#### Dual GitHub Apps (Critical Pattern)
- **Infrastructure App**: Provisions/deletes infrastructure, triggers Terraform workflows
- **Code Deployment App**: Deploys application code and AKS manifests
- **Implementation**: [githubService.js](../services/githubService.js) initializes two separate Octokit clients with different credentials
- **Rule**: Never mix app permissions; always use correct client (`this.octokit` vs `this.codeOctokit`)
- **Config**: Both apps configured in `.env` with separate App IDs, Installation IDs, and private key paths

#### Correlation ID Tracking (End-to-End Traceability)
- **Generated in**: [server.js](../server.js) middleware creates `req.correlationId = uuidv4()`
- **Threaded through**: All logger calls, GitHub PR descriptions, workflow status polling, error responses
- **Usage pattern**: `logger.info(\`[${req.correlationId}] Action description\`)`
- **Frontend tracking**: SPA passes correlationId in all API calls and status modal polling requests
- **Debugging**: Search logs for correlationId to trace single request across services/PRs/workflows

#### SPA Navigation (Vue 3 Component-Based)
- **Architecture**: Vue 3 SPA in `srcV2/` with Pinia state management and page components
- **Navigation**: Vue Router or Pinia navigation store (`stores/navigation.ts`)
- **Pages included**: custom-infra, templates, installed-apps, aks, aks-installed-apps, existing-infra-change, docs, rbac-manager, debug

#### Async Workflow Polling Pattern
- **User action** (e.g., "Provision") → **Trigger API** → **Start GitHub workflow** → **Return correlationId**
- **Status modal** shows "In Progress" and polls `/api/status/:correlationId` (optionally `?type=` for workflow filtering)
- **Polling stops** when status is "success", "failure", or timeout (typically 2-5 min)
- **Implementation**: Vue composables (`useWorkflowPolling.ts`) and Pinia stores handle polling

### Frontend Architecture: Vue 3 SPA

**Status**: Vue 3 is the sole frontend implementation. The legacy Vanilla JavaScript `public/` directory has been removed.

#### Vue 3 SPA
- **Location**: `srcV2/` folder (TypeScript)
- **Built by**: Vite to `dist/` for production
- **State management**: Pinia stores (`infrastructure.ts`, `navigation.ts`, `workflow.ts`, `environments.ts`, `auth.ts`)
- **Reusable logic**: Composables (`useApi.ts`, `useWorkflowPolling.ts`, etc.)
- **Development**: Hot module replacement (HMR) with `npm run dev:client`
- **Type safety**: Full TypeScript support
- **Architecture**: Component-based with proper separation of concerns
- **Deployment**: `npm run build:client && npm start`

### Critical Developer Workflows

#### Initial Setup
```bash
npm install                                    # Install all dependencies (both backend + frontend)
cp .env.example .env                          # Create env file
# Edit .env with GitHub App credentials:
#   GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_PRIVATE_KEY_PATH
#   GITHUB_CODE_APP_ID, GITHUB_CODE_INSTALLATION_ID, GITHUB_CODE_APP_PRIVATE_KEY_PATH
```

#### Vue 3 Development (Primary - With HMR)
```bash
npm run dev                                    # Terminal 1: Express API on :3000 (watches server.js changes)
npm run dev:client                             # Terminal 2: Vite dev server on :5173 (watches srcV2/, proxies /api to :3000)
# Browser: http://localhost:5173 - hot reload on component/composable changes
# ✅ **RECOMMENDED for all feature development** - fastest feedback loop with HMR
```

#### Production Build (Vue)
```bash
npm run build:client                           # Build Vue app to dist/ (TypeScript → JS, bundle)
npm start                                      # Serve built Vue app from dist/ via Express static
```

#### Testing & Quality
```bash
npm test                                       # Run Vitest (Vue component tests, composables)
npm run test:coverage                         # Coverage report (v8)
npm run type-check                            # TypeScript check for srcV2/
```

#### Docker & Kubernetes
```bash
docker build -t self-service-infra:latest -f Dockerfile .   # Multi-stage build (see Dockerfile)
# Deploy to AKS: kubectl apply -f kubernetes/  (see ingress.yaml, app manifests)
# Health check: GET /health returns { status: 'ok', timestamp }
```

#### Debugging Patterns
- **Correlation ID search**: `grep -r "correlationId"` in logs to trace single user request across services
- **GitHub App auth issues**: Check `logger.info` on server startup; both apps must initialize without errors
- **Metadata fetch failures**: Ensure service repo has `docs/metadata/` folder with valid JSON files
- **Workflow not triggering**: Verify PR description includes `workflow-file: .github/workflows/[workflow-name].yml`

### Data Flow & Integration Patterns

#### Request Flow (Example: Provision Infrastructure)
```
User clicks "Create" in Vue 3 SPA (srcV2/pages/CustomInfrastructurePage.vue)
  → POST /api/custom { projectName, modules[], environment }
  → routes/api.js validates input + generates correlationId from server.js middleware
  → infrastructureService.buildCustomInfrastructure() prepares metadata
  → githubService.triggerWorkflow() creates PR in service-catalog repo + triggers GitHub Actions
  → API returns { success, correlationId, prNumber }
  → SPA shows status modal, polls GET /api/status/:correlationId every 5s
  → webhooks receive push event when PR merges
  → metadata appears in installed-apps list + frontend re-renders
```

#### GitHub API Integration
- **Octokit clients**: Initialized in [githubService.js](../services/githubService.js) constructor
- **File operations**: Read/write JSON via `rest.repos.getContent()` and `rest.repos.createOrUpdateFileContents()`
- **Workflow triggers**: `rest.actions.createWorkflowDispatch()` starts GitHub Actions workflows
- **Error handling**: Catch `HttpError` and retry with exponential backoff (not currently implemented; add if needed)

#### Azure Subscription Config
- Stored in [config.js](../config.js) and surfaced to the Vue frontend via the `/config.js` runtime endpoint
- Maps environment names (e.g., 'devsand', 'sand') to Azure subscription IDs
- Used for "View in Azure Portal" links and resource group URL construction
- **Dynamic environments**: `data/environments.json` defines per-environment feature flags (`customInfra`, `templates`, `aks`) loaded at runtime via `GET /api/environments`; the `useEnvironmentsStore` in `srcV2/stores/environments.ts` consumes this and exposes filtered computed lists (e.g., `aksEnabledEnvironments`)

### Platform Responsibilities (Current)
- Provision, update, promote, and delete infrastructure through GitHub workflow dispatches with correlationId tracking.
- Orchestrate AKS deployments for both web apps and agents, including workload identity grant payloads.
- Handle agent-driven existing-infra change requests through `/api/agent-change` and infra-live workflow dispatch.
- Act as control plane for environment-aware UI behavior (feature flags from `data/environments.json`).
- Broker metadata lifecycle operations in GitHub (`docs/metadata/*`) as the source of truth.
- Accept product feedback (`/api/feedback`) and create GitHub Issues in the self-service repository.

### Recent Feature Updates To Preserve
- **Dynamic environments** are fully runtime-driven from `data/environments.json` (no hardcoded lists in Vue pages).
- **Agent dispatch flow** is implemented end-to-end:
  - `GET /api/agents` returns agent definitions from `data/agents.json`.
  - `POST /api/agent-change` validates agent inputs and triggers infra-live `agent-dispatch` automation.
  - Current active agents include `topicsubscription`, `storage`, and `servicebus`.
- **AKS deployment API expanded**:
  - Supports web app and agent paths in a single endpoint (`/api/aks-deploy`).
  - Supports optional `workload_identity_grants` plus app/agent-specific parameters.
  - Status endpoints: `/api/aks-status/:workflowId` and `/api/aks-status-by-correlation/:correlationId`.
- **Feedback-to-Issue integration**:
  - `POST /api/feedback` supports `bug`, `feature-request`, and `agent-request`.
  - Inputs are sanitized and turned into structured GitHub Issues with correlation IDs.
- **Code repository bootstrap integration**:
  - `POST /api/add-code-repo` uses the code deployment GitHub App, injects repo secret, and triggers `create-app` workflow in the code catalog repository.
- **Module catalog updates**:
  - `data/modules.json` includes `serviceBus`, `eventGridTopics`, `UserAssignMSI`, and `aiFoundry`.
- **Prefill / Edit-existing-infra wiring (FR-003 / FR-004)** — Editing an installed app pre-populates the Custom Infrastructure wizard:
  - **Entry point**: `InstalledAppsPage` sets `navigationStore.prefillContext = { appName, environment }`, then navigates to `custom-infra`.
  - **Auto-load** (`onMounted`): `CustomInfrastructurePage` reads `prefillContext`, validates it (alphanumeric ≤ 64 chars), fetches `GET /api/app-metadata/:appName/:environment`, calls `handlePrefill()`, then **immediately clears** the context to prevent re-triggering on back-navigation.
  - **`handlePrefill(metadata)`**: calls `parseModuleInstances()` to convert flat instance names from metadata (e.g. `['appServiceWindows-1','appServiceWindows-2','keyvault']`) back to module types + per-type instance lists, sets `selectedModules` to deduped module-type names, sets `prefillResourceInstances` ref, and restores `rbacRelationships` from `metadata.rbacPairs`.
  - **`parseModuleInstances(flatModules, availableModuleTypes)`**: For each flat name, finds the longest matching module-type prefix (`flatName === type || flatName.startsWith(type + '-')`); groups by type. Always skip `'RBAC'` (managed automatically via watcher).
  - **ResourceForm**: Receives optional `prefillInstances` prop. `initializeInstances()` uses prefilled instances (count + names) instead of a single default when the prop is set. A separate `watch(() => props.prefillInstances, ...)` re-initialises when the prop arrives after `selectedModules`.
  - **RBAC removal / v-model fix**: `RbacManager` is bound with `:modelValue` + `@update:modelValue="(val) => (rbacRelationships = val)"` (explicit assignment) instead of `v-model`, to guarantee the ref is updated on every remove/add. Both `remove` and `add` paths emit `update:modelValue` with a fresh array copy.
  - **Reset paths**: `clearEditingMode()` and `handleDeployAnother()` both reset `prefillResourceInstances` to `undefined` so ResourceForm defaults back to single instances on fresh runs.
  - **Edge cases to preserve**: (a) RBAC pairs removed by user must NOT reappear in the submission — only `rbacRelationships.value` at submit time is sent. (b) Multi-instance modules must show correct instance count on the Configure step when editing. (c) ModuleSelector must highlight the correct module-type chips, not flat instance names.

### Pipeline Ownership
- Azure DevOps pipeline definition lives in `.pipeline/self-service.yaml`.
- Pipeline is scoped to core app changes (backend, Vue app, Dockerfiles, config) and builds/pushes `self-service-infra` container image using shared templates.
- Keep this file updated whenever build inputs or deployment packaging paths change.

### Project Conventions
- **All state is in GitHub**: Never add a database. `DatabaseService` is deprecated.
- **CorrelationId everywhere**: Thread through logs, PR descriptions, API responses, frontend polling—always track single requests
- **Dual GitHub Apps**: Infrastructure app (Terraform, provision) ≠ Code app (AKS, code deploy). Never mix credentials.
- **SPA Navigation**: Vue.js component-based routing with Pinia navigation store
- **Status modal for all async ops**: Long-running operations (provision, delete, AKS deploy) use status modal + polling, never block UI
- **No DatabaseService**: Database service is deprecated and not used. All metadata stored in GitHub (`docs/metadata/`). Do not add database integration.
- **No secrets in code**: `.env`, `*.pem`, `secrets.yaml` must be in `.gitignore`
- **Logging via Winston**: All logs go through [utils/logger.js](../utils/logger.js) with correlationId prefix
- **Input validation**: Use `express-validator` for all API endpoint validation before processing
- **Azure subscription IDs**: Maintain in [config.js](../config.js); surfaced to Vue frontend via `/config.js` runtime endpoint

### When Adding Features
1. Add/extend API in `routes/api.js` (use RESTful naming, validate input)
2. Add/extend service logic in `services/`
3. Update frontend logic in `srcV2/` (Vue components/composables)
4. Update docs in `README.md` and `docs/`
5. Add/extend tests (Vitest for Vue, see `srcV2/`)
6. Update K8s manifests if needed

### Security & Quality
- All logging via `utils/logger.js` (Winston, correlationId required)
- All API input validated (express-validator)
- No hardcoded secrets; `.env`, `*.pem` in `.gitignore`
- Use async/await, modular JS, descriptive names
- Never push `.env`, secrets, or generated files

### Key Files & Directories
- **[routes/api.js](../routes/api.js)**: 30+ REST endpoints; validate inputs, use correlationId in all responses
- **[services/githubService.js](../services/githubService.js)**: GitHub API wrapper; dual Octokit clients (infrastructure + code); workflow triggering
- **[services/infrastructureService.js](../services/infrastructureService.js)**: Metadata operations; fetches/transforms data from GitHub
- **[services/aksService.js](../services/aksService.js)**: AKS deployment orchestration; `deployToAks()` accepts `envname, appname, namespace, isWebApp, imageName, imageTag, teamLabel, port, externalSecretEnabled, kvSecrets, envVars, secretEnvVars, correlationId, triggeredBy`
- **[services/databaseService.js](../services/databaseService.js)**: **Deprecated and not used**—all data comes from GitHub metadata in `docs/metadata/` folder. Do not add database functionality. This file is a placeholder for reference only.
- **[srcV2/](../srcV2/)**: Vue 3 SPA (TypeScript); stores (Pinia), composables, views; built to `dist/`
- **[data/environments.json](../data/environments.json)**: Environment definitions with per-feature flags (`customInfra`, `templates`, `aks`); loaded at runtime via `GET /api/environments`
- **[data/modules.json](../data/modules.json)**: Terraform module definitions; includes storageV2, keyvault, RBAC, UserAssignMSI, appServiceWindows/Linux, functionApp, serviceBus, sqldb, appConfiguration, VMs, eventGridTopics, **aiFoundry**
- **[config.js](../config.js)**: Environment config, GitHub App credentials, Azure subscription IDs
- **[utils/logger.js](../utils/logger.js)**: Winston logger; always pass correlationId
- **[kubernetes/](../kubernetes/)**: AKS manifests, ingress, secrets
- **[Dockerfile](../Dockerfile)**: Multi-stage build (Node base → bundle → runtime); non-root user

### When Adding Features

**⚠️ Important**: All features must be implemented in Vue.js (`srcV2/` folder). The legacy Vanilla JavaScript `public/` directory has been removed.

#### New API Endpoint
1. Add route in [routes/api.js](../routes/api.js) with `express-validator` validation
2. Log with correlationId: `logger.info(\`[${req.correlationId}] Action\`)`
3. Always return `{ success: boolean, data: ..., correlationId: req.correlationId }`
4. Handle errors with try-catch; use appropriate HTTP status codes
5. If async/long-running: trigger workflow and return `prNumber` + `correlationId` for polling
6. Add frontend code in a Vue component under `srcV2/`
7. Update [README.md](../README.md) with endpoint docs

#### New Vue Component/Composable (Primary Pattern)
1. Write in TypeScript (`.ts` files in [srcV2/](../srcV2/)) - **all new features must be in Vue**
2. Use Pinia stores for state ([stores/](../srcV2/stores/))
3. Use composables for reusable logic ([composables/](../srcV2/composables/))
4. Export types from [types/](../srcV2/types/infrastructure.types.ts)
5. Add tests: `*.spec.ts` using Vitest + `@vue/test-utils`
6. Run: `npm test`, `npm run test:coverage`

#### New GitHub Workflow
1. Add `.yml` file to `service-catalog` repo's `.github/workflows/`
2. Reference in PR description: `workflow-file: .github/workflows/[name].yml`
3. Trigger via [githubService.js](../services/githubService.js): `rest.actions.createWorkflowDispatch()`
4. Frontend polls `/api/status/:correlationId` for completion
5. Test triggering + polling with mock correlationId

### Code Style & Patterns

#### Pre-commit Hooks (CRITICAL)
This repo enforces pre-commit hooks. **Always produce clean output — no trailing whitespace, no missing end-of-file newline.**
If a hook auto-fixes a file, the commit will fail. The fix is to re-stage and retry:
```bash
git add -u && git commit -m "your message"
```
Rules that are enforced automatically:
- **No trailing whitespace** on any line (spaces or tabs)
- **Newline at end of every file**
- **No merge conflict markers** (`<<<<<<<`, `=======`, `>>>>>>>`)
- **No hardcoded secrets** (API keys, tokens, private keys)

#### JavaScript/TypeScript
- Use `const`/`let`; avoid `var`
- Async/await over `.then()` chains
- Destructure imports/parameters for clarity
- JSDoc comments for complex functions (especially service layer)
- Error handling: always catch + log with correlationId

#### API Response Format
```javascript
{
  success: true/false,
  data: {...},           // or 'error' if success=false
  correlationId: "uuid",
  prNumber: 1234         // if workflow triggered
}
```

#### Frontend Modal Pattern
```javascript
showStatusModal("Action Name", "In Progress");  // Opens modal, shows spinner
// ... polling logic ...
showStatusModal("Action Name", "Success", true); // Closes modal, shows success
```

### Security & Quality
- ✅ **Always validate** input via `express-validator` before processing
- ✅ **Never log secrets** (API keys, tokens); only log correlationId
- ✅ **Thread correlationId** through: requests → logs → PRs → responses
- ✅ **Use Winston logger** for all logging
- ✅ **Mock GitHub API** in tests; never hit real API
- ❌ **No hardcoded credentials** in code; use env vars or K8s secrets
- ❌ **No session storage** for auth (future: stateless JWT only)
- ❌ **Don't modify `node_modules/`, generated files, or `.env`**

### Debugging Checklist
- **Secrets encryption failures**: Follow [.runbooks/secrets-encryption.md](.runbooks/secrets-encryption.md) for safe `ENCRYPTION_FAILED`/SOPS triage; check runtime-image SOPS presence before changing Key Vault permissions, especially when rollback restores behavior.
- **Workflows not triggering**: Check both GitHub Apps are initialized in `logger.info` on startup
- **Metadata not fetching**: Verify `docs/metadata/` folder exists in service repo + valid JSON
- **Frontend stuck in "In Progress"**: Check correlationId in status modal polling; ensure workflow completed
- **Azure Portal links broken**: Sync subscription IDs in [config.js](../config.js) ↔ [data/environments.json](../data/environments.json)
- **Private key auth failures**: Verify `GITHUB_PRIVATE_KEY_PATH` points to valid `.pem` file or use `GITHUB_PRIVATE_KEY` env var

### References
- [docs/Architecture.md](../docs/Architecture.md): Full system design, component diagrams, ADRs
- [docs/Architecture-Quick-Reference.md](../docs/Architecture-Quick-Reference.md): Quick API/patterns reference
- [docs/Vue-Architecture-Diagram.md](../docs/Vue-Architecture-Diagram.md): Vue dev modes, HMR setup
- [docs/entra-id-*.md](../docs/): Future Entra ID integration plans
- [README.md](../README.md): Setup, env vars, deployment
