# PRD: Kong API Self-Service on the Infrastructure Catalog

## 1. Title and Metadata

| Field        | Value                                                                               |
|--------------|-------------------------------------------------------------------------------------|
| Feature Name | Kong API Self-Service                                                               |
| Slug         | `kong-api-self-service`                                                             |
| Author       | Product Manager Agent                                                               |
| Date         | 2026-07-22                                                                          |
| Status       | `draft`                                                                             |
| Stakeholders | Platform Engineering, API Platform Team, Application Developers (API producers and consumers) |
| Repository   | `organization/self-service-infra`                                                 |

---

## 2. Problem Statement

### Current Pain

Application developers at Example who own or consume APIs must go through manual, ticket-driven processes
to perform routine Kong Konnect gateway operations: registering a new service, adding a route, attaching
a plugin (e.g., rate-limiting, JWT authentication, request-transformation), or registering a Dev Portal
application. Because the organisation already operates Kong Konnect Enterprise, these operations have a
well-defined Admin API — but no self-service front door exists for development teams to use it safely.

The result:
- **Bottleneck on the API Platform team**: every service registration or plugin change requires a
  human operator, even for trivial mutations.
- **Inconsistent configuration**: ad-hoc changes applied directly to the Admin API bypass governance,
  naming conventions, and audit trails.
- **No discoverability**: teams cannot easily see which Kong services, routes, and consumers exist
  across environments without direct Admin API or Konnect Manager access, which is restricted.

### Why Now

The Self-Service Infrastructure Catalog already lets teams provision Azure resources (compute, messaging,
storage) via a GitOps/Terraform workflow. Extending the same principle to Kong Konnect is the natural
next step as the number of API-producing teams grows. Providing self-service Kong operations through the
same portal reduces the total number of tools a developer needs to interact with and keeps all
infrastructure state changes auditable in GitHub.

### Expected Business Value

| Outcome | Measurable Indicator |
|---|---|
| Reduced lead time for API gateway config | P50 time from request to live service/route drops from days to < 30 min |
| Fewer manual interventions for API Platform team | Ops tickets for routine Kong changes drop > 60% within 90 days of launch |
| Full audit trail for every Kong change | 100% of Kong mutations traceable to a GitHub PR + correlationId |
| Developer productivity | Application teams can register a new API service without opening a ticket |

### User Personas

| Persona | Goal |
|---|---|
| **API Producer** (app developer) | Register a new API service + routes in Kong for their application, configure auth plugin, see live status |
| **API Consumer** (app developer) | Register a Dev Portal application and obtain consumer credentials for an existing API |
| **API Platform Engineer** | Review, approve, and audit all Kong configuration changes; manage plugins at the global/control-plane level |

---

## 3. Goals and Non-Goals

### Goals

1. Let API Producers register a new Kong Service + Route set through the Self-Service portal (scoped to
   their application/environment).
2. Let API Producers attach a curated set of approved plugins to their services (rate-limiting, JWT
   auth, request-transformer, CORS — exact set to be confirmed with API Platform team).
3. Let API Consumers register a Dev Portal application and request consumer credentials (API keys or
   OAuth client credentials) for a target service.
4. All mutations go through a GitHub PR → GitHub Actions workflow → Kong Admin API (or
   `terraform-provider-kong` / `deck` declarative sync) — preserving the GitOps audit trail.
5. Expose read-only Kong service/route inventory per environment in the portal so teams can discover
   existing APIs without direct Konnect access.
6. Surface Kong entity status (service health, route count, plugin list) in the portal's installed-apps
   view for services owned by the authenticated user's team.

### Non-Goals

- **Global plugin management** (rate-limiting at the control-plane/gateway level) — remains with the
  API Platform team.
- **Kong Control Plane infrastructure provisioning** (Konnect organisations, runtime groups,
  certificates) — that is IaC-managed by the API Platform team.
- **Migrating existing Kong configuration** into the portal as a one-time import — out of scope for
  v1; existing config stays managed by the current tooling.
- **Custom plugin development or upload** — not self-serviceable; requires Platform Engineering review.
- **Direct Admin API bypass** — the portal must never expose raw Admin API credentials to end users.
- **Multi-vendor API gateway support** (Azure APIM, AWS API Gateway) — out of scope for this PRD.

---

## 4. Current State Assessment

### What Exists Today (Evidence Table)

| Capability | File / Location | Relevance to Kong Feature |
|---|---|---|
| Terraform module registry | `data/modules.json` (15 modules: storageV2, keyvault, RBAC, appServiceWindows/Linux, serviceBus, sqldb, appConfiguration, VMs, eventGridTopics, aiFoundry, redis, UserAssignMSI) | **No Kong module exists**; would need a new `kongService` module entry added |
| Agent-dispatch pattern | `data/agents.json` (agents: topicsubscription, storage, servicebus) + `routes/api.js` lines 1330–1400 (`GET /agents`, `POST /agent-change`) | Kong config changes could follow the same agent dispatch pattern for simple mutations |
| GitHub-as-database (metadata) | `services/infrastructureService.js` `getInstalledApps()` (lines 143–210, reads `docs/metadata/*.json` via `repos.getContent`); direct per-file lookup pattern (~lines 637–663). **Note**: `_fetchDataFile()` reads only `data/` static-config files (templates.json, modules.json, etc.) — it does not read `docs/metadata/`. The proposed `getKongServices()` / `getKongService()` (FR-008) must follow the `getInstalledApps()` pattern, not `_fetchDataFile()`. | Kong entity state (services, routes) could be tracked as metadata JSON per app |
| Vue 3 SPA navigation | `srcV2/App.vue`, `srcV2/stores/navigation.ts` | New "Kong" page requires a new `PageId` and nav entry |
| Environment definitions | `data/environments.json` (devsand, sand, aisand) | Kong workspace/runtime-group mapping to environments needs definition |
| Status modal + workflow polling | `srcV2/components/modals/StatusModal.vue`, `routes/api.js` `/api/status/:correlationId` | All Kong mutation flows must use the same async polling pattern |
| Correlation ID middleware | `server.js`, `routes/api.js` (all routes) | All new Kong endpoints must thread correlationId |
| Authentication (MSAL/EntraID) | `srcV2/composables/useAuth.ts`, `middleware/auth.js` | Kong endpoints must use `requireAuth`; user identity determines scope of allowed mutations |
| GitHub Actions workflow dispatch | `services/githubService.js` `triggerWorkflow()` | Kong mutations dispatched as GitHub Actions workflows (same pattern as infra provisioning) |
| Express API route pattern | `routes/api.js` (30+ endpoints) | New Kong routes follow established pattern: `express-validator` + correlationId + try/catch |
| **Kong / Konnect** | _Searched: `data/modules.json`, `routes/api.js`, `services/`, `docs/`, `data/agents.json`_ | **Zero matches. No Kong-related code, config, docs, or modules exist anywhere in the repo.** |

### Gaps and Limitations

1. No Kong Terraform module in `data/modules.json`.
2. No Kong agent in `data/agents.json`.
3. No Kong-aware GitHub Actions workflow in the service-catalog or infra-live repo (assumed — not
   directly discoverable from this repo alone).
4. No Kong Admin API credentials are referenced in any config, environment variable list, or K8s
   secret manifest in this repo.
5. No Kong workspace-to-environment mapping defined.
6. No Kong entity metadata schema defined for the service-catalog.

---

## 5. Requirement Classification Matrix

| Capability | Classification | Evidence | Proposed Action |
|---|---|---|---|
| Kong Service registration | `new-feature` | No Kong code anywhere in repo | Build new module + workflow + Vue page |
| Kong Route management | `new-feature` | No Kong code anywhere in repo | Included in Service registration flow (v1: create together) |
| Plugin attachment (curated set) | `new-feature` | No Kong code anywhere in repo | New sub-form on Service registration page |
| Dev Portal application registration | `new-feature` | No Kong code anywhere in repo | Separate "API Consumer" flow / page section |
| Kong entity read (inventory/status) | `new-feature` | No Kong code anywhere in repo | New API endpoint + read-only view |
| Agent-dispatch pattern for incremental changes | `existing-extend` — **not used in v1** | `data/agents.json`, `POST /api/agent-change` in `routes/api.js` lines 1354–1400 | Pattern exists and is viable, but v1 uses a dedicated Kong REST namespace (`/api/kong/*`) for all mutations. No v1 FR routes through `/api/agent-change`. A `kongConfig` agent entry in `data/agents.json` is deferred to v2 for incremental/lightweight changes. |
| Metadata tracking in service-catalog | `existing-extend` | GitHub-as-database pattern in `services/infrastructureService.js` | Add Kong entity metadata schema to service-catalog |
| Vue 3 SPA navigation | `existing-extend` | `srcV2/App.vue`, `srcV2/stores/navigation.ts` | Add `kong` PageId and nav entry |
| Workflow polling / status modal | `existing-refine` | `srcV2/components/modals/StatusModal.vue` | Reuse as-is; no changes needed |
| Correlation ID tracking | `existing-refine` | All existing routes | Reuse as-is; all new Kong routes must include it |

---

## 6. Functional Requirements

### FR-001: Kong Service Registration

| Field | Detail |
|---|---|
| **Priority** | must |
| **Description** | An authenticated API Producer can register a new Kong Service (upstream URL, name, tags) and one or more Routes (paths, methods, strip-path, preserve-host) within a selected environment, from the Self-Service portal. |
| **Rationale** | Core self-service capability; reduces API Platform team bottleneck for every new service onboarding. |
| **Acceptance Criteria** | (a) A form in the Vue SPA captures: service name (alphanumeric + hyphens, ≤ 128 chars), upstream URL (valid URL with protocol), environment selection, route paths (≥ 1), HTTP methods, tags (optional). (b) On submission, a correlationId is generated, a GitHub PR is created in the service-catalog repo (or a GitHub Actions workflow is dispatched to infra-live), and the status modal displays "In Progress". (c) The PR/workflow applies the Kong service+route config via the approved delivery mechanism (Terraform or deck). (d) On workflow success, the service appears in the Kong inventory view under the selected environment. (e) On workflow failure, the status modal shows the error and the PR/run URL. (f) Duplicate submission handling — two cases apply (cross-reference NFR-REL-002): **(i) Conflict (HTTP 409)**: service name + environment match an existing active service AND the submitted payload (upstreamUrl, routes, tags) differs from the stored metadata — return HTTP 409 with message "A service with this name already exists in [env] with a different configuration"; no workflow is dispatched. **(ii) Idempotent retry (HTTP 200)**: service name + environment match an existing service AND the payload is byte-for-byte identical to the stored metadata — return HTTP 200 with the existing service details; no duplicate workflow is dispatched (see NFR-REL-002). |
| **Dependencies** | FR-005 (Kong credential management), FR-007 (environment mapping), NFR-SEC-001 |

### FR-002: Kong Route Management (post-registration)

| Field | Detail |
|---|---|
| **Priority** | should |
| **Description** | An authenticated API Producer who owns a Kong Service can add, edit, or delete Routes on that service after initial registration. |
| **Rationale** | Services evolve; allowing post-registration route changes avoids re-creating the entire service for minor path updates. |
| **Acceptance Criteria** | (a) Portal displays the current route list for owned services. (b) User can add a route (path + methods required) or delete an existing route via the same PR/workflow dispatch pattern as FR-001. (c) Editing a route creates a new PR; no in-place edits to the Konnect Admin API without an audit trail. (d) Deletion is protected: user must confirm, and the workflow verifies **no active traffic** (P95 request count in the last 5 minutes **== 0**, i.e., the route is idle) before executing the delete. The traffic metric is sourced from the **Kong Konnect Vitals API** (workspace-scoped, called from the GitHub Actions workflow using the service-account token from FR-005). **If traffic > 0** (i.e., P95 request count is non-zero), the workflow flags a warning and requires an explicit override flag (`force_delete: true`) to proceed. **v1 caveat**: If Konnect Vitals API access cannot be confirmed before Phase 3 (see OQ-1), this automated traffic check is descoped to a manual confirmation prompt in the portal, with the automated check deferred to v2. |
| **Dependencies** | FR-001, FR-005 |

### FR-003: Plugin Attachment (Curated Set)

| Field | Detail |
|---|---|
| **Priority** | must |
| **Description** | An authenticated API Producer can attach any plugin from a pre-approved list to their Kong Service or Route. The approved plugin list is managed by the API Platform team and stored in a config file readable by the portal. |
| **Rationale** | Plugins are the primary mechanism for enforcing security and rate policies. A curated list prevents misconfiguration while still enabling self-service. |
| **Acceptance Criteria** | (a) A `data/kong-plugins.json` file (or equivalent) lists approved plugins with their configurable parameters and defaults. (b) The portal renders a plugin selector; non-approved plugins are not shown. (c) Each plugin has a form section generated from its parameter schema (minimum fields: required params; advanced params behind an "Advanced" toggle). (d) On submission, the plugin config is included in the PR/workflow alongside the service definition. (e) Adding a plugin to an already-deployed service creates an incremental PR/workflow dispatch (does not require full service re-registration). (f) Minimum approved plugins at launch: `rate-limiting`, `jwt`, `cors`, `request-transformer`, `ip-restriction`. Exact list is an **open question** (see Section 10). |
| **Dependencies** | FR-001, FR-005 |

### FR-004: Dev Portal Application Registration (Consumer Self-Service)

| Field | Detail |
|---|---|
| **Priority** | should |
| **Description** | An authenticated API Consumer can register a Dev Portal application, select one or more published Kong Services to subscribe to, and receive consumer credentials (API key or OAuth 2.0 client credentials, depending on the auth plugin on the target service). |
| **Rationale** | Consumer credential management is currently manual. Self-service credential issuance reduces toil for both consumer teams and the API Platform team. |
| **Acceptance Criteria** | (a) Portal lists published services (those with `published: true` in metadata and `dev-portal` tag in Kong). (b) User provides: application name, description, contact email, target service(s). A subscription to multiple services is allowed; each selected service must independently satisfy criterion (e). (c) On submission, workflow creates a Kong Consumer + credential in Konnect, and returns the credential to the user in a one-time-display modal (never stored in the portal or GitHub). (d) Credentials are stored in an Azure Key Vault provisioned for the consumer team's application. **Hard prerequisite**: the consumer team must have an existing Key Vault recorded in their infrastructure metadata (a `keyvault` module entry in their app's metadata JSON). If no Key Vault is found, the workflow fails with a descriptive error instructing the team to provision one first via the Custom Infrastructure wizard. (e) Consumer registration requires **each** selected target service to be active (`status: active` in metadata). |
| **Dependencies** | FR-001, FR-005, NFR-SEC-002, Assumption A6 (Dev Portal licensing — if unlicensed, FR-004 is deferred; see Section 10), Assumption A7 (consumer team Key Vault prerequisite — see Section 10). |

### FR-005: Kong Credential Management (Admin API Token)

| Field | Detail |
|---|---|
| **Priority** | must |
| **Description** | The platform must securely store and consume the Kong Konnect Admin API PAT (Personal Access Token) or Service Account token needed to authenticate GitHub Actions workflows that interact with the Kong Admin API. |
| **Rationale** | Without a secure credential strategy, no Kong mutations can be performed by automated workflows. This is a prerequisite for all Kong FRs. |
| **Acceptance Criteria** | (a) The token is stored as a GitHub Actions secret (in the service-catalog or infra-live repo) — never in this repo's code, config files, or K8s manifests. (b) The token scope is the minimum required (per-workspace RBAC in Konnect if supported). (c) A documented token rotation procedure exists (runbook, not automated in v1). (d) The portal's Express backend never proxies raw Admin API calls; all mutations go through GitHub Actions workflows. |
| **Dependencies** | Platform Engineering must provision the Kong Konnect Service Account — see Section 10, Assumption A3. |

### FR-006: Kong Service Inventory View (Read-Only)

| Field | Detail |
|---|---|
| **Priority** | must |
| **Description** | A read-only page in the Vue SPA displays the Kong services registered per environment, filtered to services owned by the authenticated user's team (via tag convention). |
| **Rationale** | Discoverability is a baseline need; teams must be able to see what they own without direct Konnect Manager access. |
| **Acceptance Criteria** | (a) New "Kong" page accessible from the main navigation. (b) Displays a table/card list: service name, upstream URL, route count, active plugins, environment, status (active/inactive), last modified. (c) Data sourced from service-catalog metadata JSON (GitHub) with a ≤ 60 s cache; falls back to a "data unavailable" state with an error message — never crashes the page. (d) Filter by environment (uses `data/environments.json` values). (e) "View in Konnect" link opens the Konnect Manager URL for the service (if base URL is configured). (f) Page is accessible in < 2 s on a standard connection (see NFR-PERF-001). |
| **Dependencies** | FR-001 (data must exist), FR-007 |

### FR-007: Kong-to-Environment Mapping Configuration

| Field | Detail |
|---|---|
| **Priority** | must |
| **Description** | A configuration file or extension to `data/environments.json` maps each platform environment (devsand, sand, etc.) to its corresponding Kong Konnect runtime group / workspace name and the Konnect Manager base URL. |
| **Rationale** | The platform operates across multiple environments; without this mapping the portal cannot route mutations to the correct Kong workspace. |
| **Acceptance Criteria** | (a) Each environment entry in `data/environments.json` gains a `kong` block: `{ "workspaceName": "...", "runtimeGroupId": "...", "konnectBaseUrl": "...", "enabled": true|false }`. (b) Environments with `kong.enabled: false` do not show up in the Kong service registration form's environment selector. (c) The GET `/api/environments` endpoint surfaces the `kong` block to the Vue SPA. (d) At least one environment (devsand) is configured and enabled at launch. |
| **Dependencies** | Platform Engineering must provide the Konnect workspace names and runtime group IDs — see Section 10, Assumption A2. |

### FR-008: Kong Self-Service Metadata in Service Catalog

| Field | Detail |
|---|---|
| **Priority** | must |
| **Description** | Each Kong Service registered through the portal generates a metadata JSON file in the service-catalog repo (`docs/metadata/kong-{serviceName}-{environment}.json`) following the existing GitHub-as-database pattern. |
| **Rationale** | Consistent with the platform's source-of-truth model; enables the inventory view, audit trail, and future agent-dispatch operations on Kong entities. |
| **Acceptance Criteria** | (a) Metadata schema includes: `serviceName`, `environment`, `upstreamUrl`, `routes[]`, `plugins[]`, `owner` (email/team), `status`, `kongServiceId` (UUID from Konnect), `createdAt`, `lastModifiedAt`, `prNumber`, `correlationId`. (b) Metadata file is created/updated on every PR merge that affects the Kong service. (c) Metadata is readable by `infrastructureService.getKongServices(environment)` (new method) which follows the same pattern as the existing `getInstalledApps()` method (lines 143–210) — **not** `_fetchDataFile()`, which only reads static config files under `data/`. (d) Deleting a service sets `status: deleted` (soft-delete) rather than removing the file, preserving audit history. |
| **Dependencies** | FR-001, FR-005 |

### FR-009: Kong Service Deletion / Decommissioning

| Field | Detail |
|---|---|
| **Priority** | should |
| **Description** | An authenticated API Producer who owns a Kong Service can request its deletion via the portal. Deletion follows the same PR/workflow pattern and requires confirmation. |
| **Rationale** | Self-service lifecycle completeness; avoids orphaned services in Konnect. |
| **Acceptance Criteria** | (a) Deletion button visible only to the service owner (enforced by team tag matching). (b) User must type the service name to confirm. (c) Workflow checks for active consumer subscriptions; if any exist, workflow fails with a descriptive error listing the consumers before the Admin API delete is called. (d) On success, metadata status is set to `deleted`; service disappears from the active inventory view. (e) Deletion is not reversible through the portal (recovery requires a manual Platform Engineering intervention). |
| **Dependencies** | FR-001, FR-004, FR-008 |

### FR-010: Audit Trail and Activity Log

| Field | Detail |
|---|---|
| **Priority** | must |
| **Description** | Every Kong mutation (create, update, delete service/route/plugin/consumer) is traceable to: the initiating user, correlationId, GitHub PR number, and GitHub Actions workflow run URL. |
| **Rationale** | Compliance, incident investigation, and governance require a full audit trail for all API gateway configuration changes. |
| **Acceptance Criteria** | (a) GitHub PR description for every Kong mutation includes: correlationId, initiating user email, environment, entity type, action (create/update/delete), timestamp. (b) Server logs include `[correlationId] Kong mutation: action=… entity=… user=… env=…` at INFO level. (c) Metadata JSON includes `prNumber` and correlationId for the last mutation. (d) The portal's Kong inventory view shows a "Last modified by" field sourced from metadata. |
| **Dependencies** | FR-008 |

---

## 7. Non-Functional Requirements

### NFR-PERF-001: Page Load Performance

| Field | Detail |
|---|---|
| **Target** | Kong inventory page initial load (with API call) ≤ 2 000 ms at P90 on a 10 Mbps connection |
| **Measurement** | Lighthouse CI performance score ≥ 80; manual timing with browser DevTools in CI |
| **Strategy** | Cache metadata reads for ≤ 60 s (server-side or SWR in Vue); paginate if > 50 services per environment |

### NFR-PERF-002: Mutation Workflow Turnaround

| Field | Detail |
|---|---|
| **Target** | Time from portal form submission to Kong entity live in Konnect ≤ 5 min at P95 |
| **Measurement** | Measured from correlationId creation to `status: active` in metadata; monitored via workflow run duration in GitHub Actions |
| **Strategy** | GitHub Actions workflow for Kong mutations must complete all steps (PR creation, merge, Admin API call) within the target window |

### NFR-REL-001: Portal Resilience on Konnect Unavailability

| Field | Detail |
|---|---|
| **Target** | Kong inventory page degrades gracefully (shows cached/last-known data or "unavailable" message) — never crashes the SPA — when Konnect API is unreachable |
| **Measurement** | Manually verified by blocking the metadata fetch in dev; automated via unit tests mocking the GitHub metadata fetch with a network error |
| **Strategy** | `try/catch` in `infrastructureService.getKongServices()`; return `{ available: false, services: [] }` on failure |

### NFR-REL-002: Workflow Idempotency

| Field | Detail |
|---|---|
| **Target** | Resubmitting the same Kong service registration where **both** the service name + environment AND the full payload (upstreamUrl, routes, tags) are identical to an existing active service must return HTTP 200 with the existing service details — no duplicate workflow is dispatched. If the name + environment match but the payload differs, the request is a conflict (HTTP 409), not an idempotent retry — see FR-001(f)(i). |
| **Measurement** | Integration tests: (a) submit FR-001 twice with identical payload → second call returns HTTP 200 with existing data, no second workflow run; (b) submit FR-001 twice with same name+env but different upstreamUrl → second call returns HTTP 409. |
| **Strategy** | Pre-flight check in the Express route via `GET /api/kong/services/:serviceName/:environment`: if found, compare payload checksum/fields. Identical → return 200 + existing data. Different → return 409. Not found → proceed with workflow dispatch (201). |

### NFR-SEC-001: No Direct Admin API Exposure

| Field | Detail |
|---|---|
| **Target** | The Kong Konnect Admin API token must never appear in browser network traffic, server logs, GitHub PRs, or metadata files |
| **Measurement** | Security review: grep all PR descriptions and metadata files for token patterns; OWASP ZAP scan on the new Kong endpoints |
| **Strategy** | Token resides exclusively in GitHub Actions secrets; Express backend dispatches workflows but never proxies Admin API calls |

### NFR-SEC-002: Consumer Credential One-Time Display

| Field | Detail |
|---|---|
| **Target** | Consumer API keys/client secrets must be displayed exactly once in the portal (one-time modal) and never stored in GitHub, server logs, or metadata |
| **Measurement** | Security review: verify no credential appears in PRs, metadata JSON, or Winston log output |
| **Strategy** | GitHub Actions workflow writes credential directly to the consumer team's Azure Key Vault; portal receives only a Key Vault reference (vault name + secret name), not the raw credential |

### NFR-SEC-003: Owner-Scoped Mutations

| Field | Detail |
|---|---|
| **Target** | A user can only modify/delete Kong services owned by their team. Ownership determined by service metadata `owner` field matching the authenticated user's Entra ID team/group claim |
| **Measurement** | Integration test: user A attempts to delete a service owned by user B → expects HTTP 403 |
| **Strategy** | Express route middleware compares `req.user.email` (or team claim) against metadata `owner` field before dispatching mutation workflows |

### NFR-SCALE-001: Service Catalog Growth

| Field | Detail |
|---|---|
| **Target** | Inventory view must remain responsive with up to 500 Kong services per environment. **Warm-cache target (primary)**: ≤ 2 s P90 response time when the server-side metadata cache (≤ 60 s TTL, from NFR-REL-001 / FR-006(c)) is populated. **Cold-cache target (secondary / acceptable degradation)**: ≤ 10 s P90 for the initial cache population (GitHub Contents API list + fetch of up to 500 files, or git-tree batch fetch). After the first load, subsequent requests are served from cache and meet the 2 s target. **Note**: Given the no-database, GitHub-as-source-of-truth architecture, a cold-cache fetch of 500 individual GitHub API file reads is expected to take several seconds. The platform must never show a blank/crashed page during cold-cache load — a loading skeleton or progressive-render pattern is required. |
| **Measurement** | (a) Warm-cache load test: inject 500 metadata JSON files into mock service-catalog; pre-warm cache; measure `GET /api/kong/services` response time — target ≤ 2 s P90. (b) Cold-cache test: restart server; measure time to first meaningful paint on Kong inventory page — target ≤ 10 s P90. |
| **Strategy** | Server-side cache with ≤ 60 s TTL (in-memory or Redis if available). Paginate the inventory API (page size = 50 default). Prefer a single git-tree API call over N individual file fetches where possible. Lazy-load additional pages on scroll. |

### NFR-OBS-001: Observability

| Field | Detail |
|---|---|
| **Target** | All Kong API mutations log at INFO level with correlationId, action, entity, user, and environment. Errors log at ERROR level with stack trace |
| **Measurement** | Log output review in dev; verified in existing Winston logger pattern |
| **Strategy** | Reuse `utils/logger.js` with structured log lines: `[correlationId] Kong mutation: action=create entity=service name=X env=Y user=Z` |

### NFR-OBS-002: Workflow Failure Alerting

| Field | Detail |
|---|---|
| **Target** | When a Kong mutation workflow fails, the portal status modal surfaces a human-readable error and the GitHub Actions run URL within 30 s of failure |
| **Measurement** | Manual test: inject a deliberate workflow failure; verify status modal updates within 30 s |
| **Strategy** | Existing `GET /api/status/:correlationId` polling pattern with workflow conclusion check (`failure` state → show run URL) |

### NFR-USE-001: Discoverability

| Field | Detail |
|---|---|
| **Target** | A new developer with no prior knowledge of Kong should be able to complete the service registration flow (FR-001) in ≤ 10 minutes, with no external documentation required |
| **Measurement** | Directional usability test with 2 developers unfamiliar with Kong; success = task completed in ≤ 10 min with ≤ 2 requests for help. **Note**: a sample of 2 is directional only and does not constitute a hard pass/fail gate for the Definition of Done. The DoD gate for this NFR is: all form fields have inline help text and real-time validation (verifiable by inspection), not a fixed usability study result. |
| **Strategy** | Each form field has inline help text; upstream URL field has an example placeholder; route path field validates format in real-time |

### NFR-A11Y-001: Accessibility

| Field | Detail |
|---|---|
| **Target** | Kong pages meet WCAG 2.1 AA compliance for all interactive elements |
| **Measurement** | axe-core scan in Vitest; 0 critical/serious violations |
| **Strategy** | Follow existing Vue component patterns with ARIA labels on all form inputs and error messages |

---

## 8. API and Data Impact

### New Express API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/kong/services` | `requireAuth` | List Kong services for environments the user has access to; supports `?env=` filter |
| `GET` | `/api/kong/services/:serviceName/:environment` | `requireAuth` | Get details (routes, plugins, status) for a specific service in a specific environment |
| `POST` | `/api/kong/services` | `requireAuth` | Register new Kong Service + Routes; dispatches GitHub Actions workflow; returns `{ correlationId, prNumber }` |
| `PUT` | `/api/kong/services/:serviceName/:environment/routes` | `requireAuth` | Add/remove Routes on an existing service (FR-002) |
| `POST` | `/api/kong/services/:serviceName/:environment/plugins` | `requireAuth` | Attach a plugin to an existing service (FR-003) |
| `DELETE` | `/api/kong/services/:serviceName/:environment` | `requireAuth` | Decommission a Kong Service (FR-009) |
| `GET` | `/api/kong/plugins/available` | `requireAuth` | Return the curated plugin list from `data/kong-plugins.json` |
| `POST` | `/api/kong/consumers` | `requireAuth` | Register a Dev Portal consumer application (FR-004); returns `{ correlationId, kvReference }` |

**Input validation**: All new routes use `express-validator`. All responses include `correlationId`.
**Response format**: `{ success: boolean, data: {...}, correlationId: "cid-...", prNumber?: 1234 }`

### New / Modified Data Files

| File | Change Type | Description |
|---|---|---|
| `data/environments.json` | **Extend** | Add `kong: { workspaceName, runtimeGroupId, konnectBaseUrl, enabled }` block to each environment entry |
| `data/kong-plugins.json` | **New** | Curated list of approved Kong plugins with their configurable parameters and defaults |
| `data/modules.json` | **Future/Optional (not in v1 scope)** | A `kongService` entry (category: `api-gateway`, `supportsMultiInstance: true`) is a potential future integration with the Custom Infrastructure wizard. Not required by any v1 FR; the primary UX flow uses the dedicated Kong page. Deferred to v2. |

### Service Catalog Metadata (GitHub — service-catalog repo)

New metadata file per Kong Service:
```json
{
  "serviceName": "payments-api",
  "environment": "devsand",
  "upstreamUrl": "https://payments-service.internal:8080",
  "routes": [
    { "path": "/v1/payments", "methods": ["GET", "POST"], "stripPath": false }
  ],
  "plugins": [
    { "name": "rate-limiting", "config": { "minute": 100 } }
  ],
  "owner": "team-payments@example.com",
  "status": "active",
  "kongServiceId": "uuid-from-konnect",
  "createdAt": "2026-07-22T00:00:00Z",
  "lastModifiedAt": "2026-07-22T00:00:00Z",
  "prNumber": 1234,
  "correlationId": "cid-1721606400000-abc123"
}
```

### New Service Layer Methods

| Method | File | Description |
|---|---|---|
| `infrastructureService.getKongServices(environment)` | `services/infrastructureService.js` | Fetch all Kong service metadata for an environment from service-catalog repo (list `docs/metadata/kong-*-{env}.json` via `repos.getContent`, mirroring the `getInstalledApps()` pattern at lines 143–210) |
| `infrastructureService.getKongService(serviceName, environment)` | `services/infrastructureService.js` | Fetch single service metadata (direct per-file lookup, mirroring the existing `docs/metadata/{name}-{env}.json` direct-lookup pattern at ~lines 637–663) |
| `infrastructureService.registerKongService(params)` | `services/infrastructureService.js` | Build metadata + trigger GitHub Actions workflow for service creation |
| `infrastructureService.deleteKongService(serviceName, environment, user)` | `services/infrastructureService.js` | Trigger deletion workflow after ownership check |

### Backward Compatibility

- All new endpoints are additive; no existing endpoints are modified.
- The `environments.json` schema change is backward-compatible (new `kong` block with `enabled: false` default).
- No existing Pinia stores or composables are modified in v1; Kong state is managed in a new `kong.ts` store.

---

## 9. UX and Workflow Impact

### User Journey: API Producer Registering a New Service

```
1. Navigate to "Kong" page from main nav
2. Click "Register New Service"
3. Fill form: service name, upstream URL, environment, route paths, HTTP methods
4. (Optional) Select plugins from curated list; configure plugin parameters
5. Submit → Status modal: "Registering Kong Service…"
6. Portal polls /api/status/:correlationId
7. On success: status modal shows "Service registered successfully" + "View in Konnect" link
8. Service appears in the Kong inventory table
```

### User Journey: API Consumer Registering an Application

```
1. Navigate to "Kong" page → "API Consumers" tab
2. Browse published services (filtered by environment)
3. Click "Register Application" on target service
4. Fill form: application name, description, contact email
5. Submit → Status modal: "Registering consumer application…"
6. On success: one-time credential modal (API key or client secret)
7. User copies credential; modal closes; credential is NOT accessible again from the portal
```

### Vue SPA Changes

| Component / Store | Change |
|---|---|
| `srcV2/stores/navigation.ts` | Add `'kong'` to `PageId` type; add nav entry with `requiresAuth: true` |
| `srcV2/pages/KongPage.vue` | New page: inventory table + "Register Service" entry point |
| `srcV2/components/kong/KongServiceForm.vue` | New: service registration form |
| `srcV2/components/kong/KongPluginSelector.vue` | New: plugin selector with per-plugin config sub-forms |
| `srcV2/components/kong/KongInventoryTable.vue` | New: read-only service inventory table with filters |
| `srcV2/components/kong/KongConsumerForm.vue` | New: consumer application registration form |
| `srcV2/stores/kong.ts` | New Pinia store: service list, selected environment, submission state |
| `srcV2/composables/useKongApi.ts` | New: API call wrappers for all Kong endpoints |

### Error Handling Expectations

- Duplicate service name: `HTTP 409` → inline form error "A service with this name already exists in [env]"
- Upstream URL unreachable (if pre-validation is in scope): `HTTP 422` → inline warning (not a blocker in v1)
- Workflow failure: status modal shows error + GitHub Actions run URL
- Consumer credential issuance failure: status modal shows error; no partial credentials returned
- Konnect inventory unavailable: read-only page shows "Service inventory temporarily unavailable" banner; registration form remains functional

---

## 10. Risks, Assumptions, Open Questions

### Assumptions

| ID | Assumption | Impact if Wrong |
|---|---|---|
| A1 | Kong Konnect Enterprise is deployed in a model that exposes a usable Admin API (cloud/SaaS Konnect with PAT tokens, or on-prem with a reachable Admin API endpoint). | If the deployment model does not support programmatic API access, the entire GitHub Actions delivery mechanism must be redesigned. **Blocking — must be confirmed before architecture.** |
| A2 | Each platform environment (devsand, sand, etc.) maps to exactly one Kong Konnect workspace or runtime group. The API Platform team can provide workspace names and IDs. | If environments share a workspace with no logical separation, RBAC isolation between team environments is not possible. |
| A3 | The API Platform team can provision a Kong Konnect Service Account (or PAT) with scoped RBAC for the GitHub Actions integration, and will store it as a GitHub Actions secret. | If no service account can be provisioned, FR-005 cannot be satisfied without significant security trade-offs. **Blocking — must be confirmed before engineering starts.** |
| A4 | The approved delivery mechanism for Kong config is either `terraform-provider-kong` (Terraform module) or `deck sync` (declarative YAML). One of these is already in use or acceptable to the API Platform team. | If neither is acceptable, a custom Admin API call script must be built and maintained, increasing maintenance burden. |
| A5 | Ownership / team attribution can be derived from the Entra ID token already available on the backend (e.g., team group claim or email domain). | If no reliable team claim is available in the current token, FR-SEC-003 (owner-scoped mutations) requires a separate team-to-user mapping store. |
| A6 | The organisation's Kong Konnect Enterprise licence includes Dev Portal functionality (FR-004). | If Dev Portal is not licensed, FR-004 must be deferred or implemented using Kong's built-in consumer/key-auth plugin without a branded portal. |
| A7 | Consumer teams that wish to use FR-004 (Dev Portal application registration) already have at least one Azure Key Vault provisioned via the Self-Service portal (a `keyvault` module entry in their infra metadata JSON). | If no Key Vault exists, the FR-004 credential-storage workflow cannot complete. The consumer team must provision a Key Vault first (Custom Infrastructure wizard → keyvault module). This is a hard prerequisite for FR-004 and is documented as a user-facing error path. **Owner**: API Platform Team to document this prerequisite in FR-004 onboarding guidance. |

### Known Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Konnect Admin API rate limits | Medium | Medium | Batch mutations; add retry-with-backoff in GitHub Actions workflows |
| Naming convention conflicts with existing Kong config | High | Medium | Define and enforce a naming convention (e.g., `{appName}-{environment}`) before launch; validate in the Express route |
| Long workflow turnaround > 5 min (NFR-PERF-002) | Medium | High | Profile GitHub Actions workflow step durations; optimize Terraform plan/apply or deck sync times |
| Consumer credential exposure via GitHub Actions logs | High | Critical | Mask credential values in all GitHub Actions steps (`::add-mask::`) and verify in integration test |
| Teams register services on behalf of other teams | Medium | High | Enforce ownership tag convention strictly; owner = submitting user at registration time; mutations require owner match |

### Open Questions

| ID | Question | Owner | Blocking? |
|---|---|---|---|
| OQ-1 | What is the exact Kong Konnect deployment model — cloud SaaS, self-hosted, or hybrid? What is the Admin API base URL per environment? | API Platform Team | **Yes — FR-001, FR-005** |
| OQ-2 | What is the workspace/runtime group name for each environment (devsand, sand, etc.)? | API Platform Team | **Yes — FR-007** |
| OQ-3 | Can a Kong Konnect Service Account be provisioned with per-workspace scoped RBAC? If so, who provisions it and where is the credential stored? | API Platform Team + Platform Engineering | **Yes — FR-005** |
| OQ-4 | Which delivery mechanism is preferred: `terraform-provider-kong`, `deck`, or direct Admin API calls in GitHub Actions? | API Platform Team | **Yes — architecture decision** |
| OQ-5 | What is the approved list of plugins for self-service configuration? Are there env-specific restrictions (e.g., `ip-restriction` not available in sand)? | API Platform Team | No (can default to minimal set at launch) |
| OQ-6 | Is Kong Dev Portal licensed and in use? If so, what is the Developer Portal URL per environment? | API Platform Team | No (FR-004 can be deferred) |
| OQ-7 | What team/group claim is available in the Entra ID token for ownership enforcement (NFR-SEC-003)? | Platform Engineering (auth team) | No (can fall back to email-based ownership in v1) |
| OQ-8 | Are there existing Kong services that should be importable/visible in the inventory view in v1, or is the view only for services registered through the portal? | API Platform Team + Stakeholder | No (portal-registered only in v1 is acceptable) |

---

## 11. Delivery Plan

### Phase 1 — Foundation (blocker resolution + backend skeleton)

**Gate**: All blocking open questions (OQ-1, OQ-2, OQ-3, OQ-4) answered.

**Deliverables**:
- FR-007: Extend `data/environments.json` with Kong workspace mapping
- FR-005: Service Account provisioned; GitHub Actions secret in place
- FR-008: Define Kong metadata JSON schema; add `getKongServices()` / `getKongService()` to `infrastructureService.js`
- FR-010: Structured audit logging for all Kong mutations
- New Express routes: `GET /api/kong/services`, `GET /api/kong/plugins/available` (read-only endpoints only)
- `data/kong-plugins.json` initial version (curated plugin list)
- Unit tests for new service methods

### Phase 2 — Service Registration (core self-service path)

**Gate**: Phase 1 complete + GitHub Actions workflow for Kong service creation available in infra-live.

**Deliverables**:
- FR-001: Service registration form (Vue) + `POST /api/kong/services` backend
- FR-003: Plugin attachment in registration form + `POST /api/kong/.../plugins` backend
- FR-006: Kong inventory page with read-only table + environment filter
- All status modal + polling wiring (reuses existing pattern)
- **GitHub Actions workflow for Kong service creation** (in infra-live repo) — required before this Phase 2 gate can be met; must be delivered as part of Phase 1 or in parallel
- End-to-end integration test: register a service in devsand → verify Konnect + metadata

### Phase 3 — Post-Registration Management + Consumer Self-Service

**Gate**: Phase 2 complete + at least one team using Phase 2 in devsand.

**Deliverables**:
- FR-002: Route management (add/delete on existing service)
- FR-009: Service deletion flow
- FR-004: Consumer application registration (if Dev Portal is licensed — OQ-6)
- Load test for NFR-SCALE-001 (500 services scenario)
- Accessibility audit (NFR-A11Y-001)

### Definition of Done

- All FRs in the phase have passing unit tests (Vitest) and integration tests
- No `unknown-needs-discovery` items without an assigned owner
- Wiz security scan: 0 critical, 0 high findings
- OWASP ZAP passive scan on all new Kong endpoints: 0 high-risk findings
- All NFRs validated against their measurable targets
- PRD Challenger review: `verdict: approved`
- Readiness report compiled by Orchestrator

### Rollout and Rollback

- **Rollout**: Feature-flagged behind `environments.json → features.kong: true` (new flag, defaulting to `false`). Enable for `devsand` first.
- **Rollback**: Set `features.kong: false` for all environments; Kong metadata files in service-catalog remain intact for audit but the portal hides the Kong page and all Kong API routes return `HTTP 503 Service Unavailable`.

---

## 12. Test and Validation Strategy

### Unit Tests (Vitest)

| Area | Tests Required |
|---|---|
| `infrastructureService.getKongServices()` | Mock GitHub fetch; assert correct transform; test degraded/unavailable state |
| `infrastructureService.registerKongService()` | Mock `githubService.triggerWorkflow()`; assert PR description contains correlationId, user, env, action |
| Express route `/api/kong/services` (GET) | Validates env query param; 401 on unauthenticated request |
| Express route `/api/kong/services` (POST) | Input validation: service name regex, URL format, env existence, required fields; duplicate → 409 |
| Express route `/api/kong/services/:name/:env` (DELETE) | Ownership check: 403 when `req.user` does not match metadata owner |
| `KongServiceForm.vue` | Renders form fields; submit calls `useKongApi.registerService()`; shows status modal on submit |
| `KongInventoryTable.vue` | Renders service list; filters by environment; shows "unavailable" on empty/error state |

### Integration Tests

| Scenario | Validation |
|---|---|
| Full registration flow (FR-001) | Submit form → workflow dispatch confirmed → metadata file created → service appears in inventory |
| Duplicate submission (NFR-REL-002) | Second submit with same name+env returns 409, no second workflow dispatched |
| Unauthorised deletion (NFR-SEC-003) | User B cannot delete service owned by user A (403) |
| Konnect unavailable (NFR-REL-001) | Inventory page shows degraded state when metadata fetch fails |

### E2E Tests (Playwright — optional, Phase 3)

- Register service flow: form → submission → status modal → inventory visible
- Consumer registration flow: browse services → register app → one-time credential modal

### NFR Validation

| NFR | Validation Method |
|---|---|
| NFR-PERF-001 | Lighthouse CI on Kong page in pipeline |
| NFR-PERF-002 | GitHub Actions run duration monitoring (alert if > 5 min) |
| NFR-SEC-001 | OWASP ZAP passive scan; grep all PR descriptions for token patterns |
| NFR-SEC-002 | Security review: verify no credential in metadata JSON, PR descriptions, or Winston logs |
| NFR-SCALE-001 | Load test with 500 mocked metadata files |
| NFR-A11Y-001 | axe-core in Vitest component tests |

---

## 13. Summary Table

| Metric | Count |
|---|---|
| Total Functional Requirements | 10 (FR-001 – FR-010) |
| Total Non-Functional Requirements | 11 (NFR-PERF-001/002, NFR-REL-001/002, NFR-SEC-001/002/003, NFR-SCALE-001, NFR-OBS-001/002, NFR-USE-001, NFR-A11Y-001) |
| `new-feature` | 8 |
| `existing-extend` | 3 |
| `existing-refine` | 2 |
| `unknown-needs-discovery` | 0 (blocking OQs noted explicitly in Section 10) |
| Blocking Open Questions | 4 (OQ-1, OQ-2, OQ-3, OQ-4) |

## 14. Next Decisions Needed (Stakeholders)

1. **OQ-1** [BLOCKING]: Confirm Kong Konnect deployment model and Admin API base URL per environment.
2. **OQ-2** [BLOCKING]: Provide Konnect workspace / runtime group names for each platform environment.
3. **OQ-3** [BLOCKING]: Confirm Service Account provisioning path for GitHub Actions integration; agree on secret storage location.
4. **OQ-4** [BLOCKING]: Decide on delivery mechanism — `terraform-provider-kong`, `deck`, or direct API calls in GitHub Actions.
5. **OQ-5** [Advisory]: Confirm approved plugin list for self-service configuration at launch.
6. **OQ-6** [Advisory]: Confirm Dev Portal licensing to determine whether FR-004 is in scope for v1.
7. **OQ-7** [Advisory]: Confirm Entra ID token claims available for team/ownership attribution.

---

<!-- ORCHESTRATOR-READY
feature: kong-api-self-service
prd_path: docs/prd/kong-api-self-service.md
status: approved
fr_count: 10
nfr_count: 11
revision: round2-human-approved-fr008c-citation-fix-2026-07-22
-->
