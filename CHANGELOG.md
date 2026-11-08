# Changelog

## [0.0.36] - 2026-06-11

### 🐛 Bug Fixes
- **Prefill instance count not restored** — Multi-instance modules now correctly restore their instance count and names when editing existing infrastructure instead of defaulting to 1 instance
- **RBAC relationships lost on submit** — Fixed v-model binding issue where removed RBAC pairs were re-appearing in deployment submissions. Now uses explicit `@update:modelValue` handler to guarantee state updates on every add/remove

### ✨ Features
- **Resource instance prefill prop** — `ResourceForm` component now accepts optional `prefillInstances` prop for restoring saved module configurations during edit mode

### 🔒 Security
- Added **Key Vault Crypto User** role to RBAC catalog for fine-grained encryption key access

### 🔧 Internal
- Updated `.github/copilot-instructions.md` with complete prefill/edit wiring patterns
- Enhanced prefill context handling in CustomInfrastructurePage

## [0.0.35] - 2026-06-04

### ✨ Features
- **Edit Infrastructure UI** — Users can now modify existing infrastructure directly from InstalledAppsPage with automatic form pre-fill
- Edit button (pencil icon) on each app row with clean context passing via navigation store
- Automatic form auto-load when navigating to CustomInfrastructurePage with app metadata

### 🧪 Testing
- 390 tests passing (88% coverage)
- New test suites: navigation store (14 tests), InstalledAppsPage (8 tests), prefill flow (12 tests)

### 🔒 Security
- Wiz security gate: PASS (0 critical, 0 high findings)
- Input validation on app/environment names with regex `/^[a-zA-Z0-9_-]{1,64}$/`

### 🏗️ Infrastructure
- Feature controlled by build-arg `VITE_ENABLE_CATALOG_PREFILL=true`
- Backward compatible; existing navigation calls unaffected

## [0.0.34] - 2026-06-03

### ✨ Features
- Edit Infrastructure UI path — adds Edit button to InstalledAppsPage with navigation store context passing; auto-load of app metadata on mount in CustomInfrastructurePage with feature flag `VITE_ENABLE_CATALOG_PREFILL`
- `prefillContext` state in `navigation.ts` store for passing app/environment context between pages
- Edit button (pencil icon) renders on each app row in InstalledAppsPage; restricted to editing mode when feature flag enabled
- Automatic form pre-fill in CustomInfrastructurePage via `GET /api/app-metadata/:appName/:env`; non-blocking on failure with error logging

### 🧪 Testing
- 389 tests pass (0 failures, 88% coverage)
- New test suites: `navigation.spec.ts` (14 tests), `InstalledAppsPage.spec.ts` (8 tests), `CustomInfrastructurePage.prefill.spec.ts` (12 tests)
- Tests cover context passing, form auto-load success/failure, context leak prevention, input validation
- TypeScript type-check: PASS (0 errors)

### 🔒 Security
- Wiz security gate: **PASS** (0 critical findings introduced, 0 high findings)
- Input validation on app/environment: regex `/^[a-zA-Z0-9_-]{1,64}$/` gates API call client-side
- Backend validates against allowlist from `data/environments.json`
- No hardcoded secrets or PII introduced; context cleared on success and failure paths
- Pre-existing npm dev-dependency criticals (vitest GHSA-5xrq-8626-4rwp) not in production image (Dockerfile Stage 2 uses `npm ci --only=production`)

### 🏗️ Infrastructure / Deployment
- **Build-arg requirement:** `VITE_ENABLE_CATALOG_PREFILL=true` must be passed at Docker build time to activate Edit button and auto-load in the built image
- Feature is backward compatible; existing calls to `navigateToPage()` (18 call sites) continue to work unchanged (context param optional)
- AppSelector component now exposes `collapse()` method for programmatic collapse after form submission

### 🔧 Internal
- Structured observability: correlation IDs logged on auto-load API requests and responses
- SLI metric: `catalog_prefill_succeeded.latency_ms` tracked for latency monitoring (target ≤5s)
- All NFR targets met: context leak prevention (NFR-004), input validation (NFR-005), feature flag consistency (NFR-006), correlation ID logging (NFR-007), type safety (NFR-008)

---

## [0.0.32] - 2026-06-02

### ✨ Features
- Service-catalog metadata pre-fill on Custom Infrastructure form — Step 0 (app/env selector) auto-populates Step 1 fields from catalog data (#service-catalog-prefill)
- New `GET /api/app-metadata/:appName/:environment` endpoint returns enriched app metadata from GitHub service-catalog files
- `AppSelector.vue` reusable Vue component for app + environment selection with live catalog lookup
- TypeScript `AppMetadata` interface + `InstalledApp` type enrichment for type-safe catalog data
- Feature flag `VITE_ENABLE_CATALOG_PREFILL` controls pre-fill activation at runtime

### 🐛 Bug Fixes
- Fix `getApplicationDetails()` file naming bug (FR-007) — resolves incorrect metadata file path resolution in `infrastructureService.js`

### 📊 Observability
- 4 new structured events: `catalog_prefill_requested`, `catalog_prefill_succeeded`, `catalog_prefill_failed`, `app_list_fetched`

### 🔧 Internal
- 44 new tests across 5 test files (350 unit + 67 integration passing)
- `apiService.getAppMetadata()` frontend API method added

---

## [0.0.30] - 2026-04-09

### ✨ Features
- Copilot multi-agent framework — Architect, QA, PM, SRE DevOps, Orchestrator, Vue.js Dev, and Release Manager agents with persistent memory (#55)
- Bug/Feature Request Form — `POST /api/feedback` creates GitHub Issues; supports `bug`, `feature-request`, `agent-request` types (#49)
- Service Bus agent — Terragrunt topic/queue/subscription management with namespace auto-create (#50)
- topicsubscription agent — renamed and updated for Event Grid & Service Bus subscriptions (#51, #52, #53)
- Multi-instance support for UserAssignMSI module
- aiFoundry module added to Terraform catalog

### 🐛 Bug Fixes
- `fix: switch dd-trace to UDS transport, rewrite Datadog dashboard to APM metrics`

### 🏗️ Infrastructure
- Datadog dashboards as code (`api-health`, `dependency-health`, `workflow-reliability`) in `docs/dashboards/`
- QA pipeline and Vue deploy GitHub Actions workflows added

### 🔧 Internal
- Agent input schemas updated (`data/agents.json`)
- Architecture and Copilot instructions documentation refreshed

---

## [2.1.0] - 2026-02-05

### 🔐 Security - Microsoft Entra ID Authentication (COMPLETED)

**Major Achievement**: Full enterprise authentication system implemented and deployed.

#### Added
- **Microsoft Entra ID Integration**
  - OAuth 2.0 Authorization Code Flow with PKCE for secure authentication
  - Single Sign-On (SSO) with Microsoft work accounts
  - JWT token-based API authentication with RS256 signature verification
  - Automatic token refresh (silent renewal) - no interruption to users
  - Session persistence across page reloads using localStorage
  - User identity extraction (email, name, tenant) from tokens
  - Comprehensive audit logging with user email in all authenticated requests

- **Frontend Authentication (Vue 3 + MSAL.js)**
  - MSAL browser library (`@azure/msal-browser`) integration
  - Redirect-based login flow (more reliable than popup)
  - Authentication state management (Pinia store)
  - Reusable composables (`useAuth.ts`)
  - API request interceptor with automatic token attachment
  - 401 error handling with automatic token refresh and retry
  - LoginButton component with user profile display

- **Backend Authentication (Express + JWT)**
  - JWT validation middleware for all protected endpoints
  - JWKS endpoint integration for public key retrieval
  - Token audience validation (prevents token reuse)
  - Token expiration and signature verification
  - User email extraction and request correlation
  - 15 API endpoints protected with authentication

- **Documentation**
  - [Authentication Guide](docs/AUTHENTICATION-GUIDE.md) - Complete 300+ line setup & usage guide
  - [Testing Checklist](docs/TESTING-CHECKLIST.md) - Comprehensive test scenarios
  - [README.md](README.md) - Updated with authentication section
  - [entra-id-integration-plan.md](docs/entra-id-integration-plan.md) - Marked as complete

#### Protected Endpoints
- `GET /api/installed-apps` - List all installed applications
- `GET /api/apps` - Get available apps
- `GET /api/deployed-apps` - List deployed applications
- `POST /api/custom` - Create custom infrastructure
- `POST /api/template` - Deploy from template
- `POST /api/delete` - Delete infrastructure
- `POST /api/promote` - Promote to production
- `POST /api/rbac-relationships` - Manage RBAC relationships
- `POST /api/label` - Label application
- `POST /api/aks-deploy` - Deploy to AKS
- Plus 5 additional protected endpoints

#### Testing
- **Automated Backend Tests**: 8/8 tests passing
  - Health check and public endpoint access
  - Protected endpoint authorization (401 without token, 200 with token)
  - User email extraction and logging
  - Token audience validation
  - CORS configuration
- **Manual Frontend Tests**: Login, session persistence, API integration, logout flows
- **End-to-End**: Full authentication flow tested on localhost:3001

#### Configuration
- Azure AD App Registration with Application ID URI
- Minimal scope configuration (`access_as_user`)
- Single-page application (SPA) platform
- Multiple redirect URI support (dev, staging, production)
- Environment variables for both backend and frontend

#### Security Improvements
- No client secrets stored (PKCE provides security)
- Token validation with public key cryptography
- Audience validation prevents cross-app token usage
- Short-lived tokens (1 hour) with automatic renewal
- Comprehensive request logging for audit trails

---

## [Next Release] - 2025-11-17

### Major Features

- **Architecture AI Integration**
  - Intelligent infrastructure recommendations and automation.
  - AI-driven suggestions for module selection and configuration.

- **Codex Pipelines Deployment**
  - Seamless deployment of Codex pipelines via self-service UI.
  - Automated workflow triggers for pipeline provisioning using GitHub Actions.
  - Secure token management for code deployment workflows.

- **Multi-Instance Module Support**
  - Provision multiple instances of any supported module.
  - Inline instance management UI: add, name, and remove instances directly from the catalog.
  - Instance names validated to ensure module prefix (e.g., `AppService-1`, `KeyVault-2`).
  - Smart default naming and auto-hide for instance panels.

- **RBAC Relationship Manager**
  - Visual RBAC manager for defining access relationships between resources.
  - Instance-level RBAC: assign roles to specific module instances.
  - Improved modal UI for relationship creation and editing.

### Improvements

- Enhanced error handling and logging across backend and frontend.
- Branch selection for workflow triggers now respects `.env` configuration (`SERVICE_CATALOG_BRANCH`).
- UI/UX refinements for modals, dropdowns, and multi-instance panels.
- Backend refactored to support new data structures for modules and instances.

### Fixes

- Fixed issues with instance panel visibility and z-index stacking.
- Corrected module name validation (case-sensitive, prefix enforcement).
- Resolved workflow trigger bugs for custom infrastructure requests.
- Improved dropdown text visibility in RBAC modals.

---

For previous releases, see earlier entries below.
