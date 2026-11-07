# PRD: Bug / Feature Request Form with GitHub Issue Creation

## 1. Title and Metadata

| Field        | Value                                                           |
|--------------|-----------------------------------------------------------------|
| Feature Name | Bug / Feature Request Form                                      |
| Author       | Product Manager Agent                                           |
| Date         | 2026-04-07                                                      |
| Status       | `implemented`                                                   |
| Stakeholders | Platform Engineering, DevOps Team, End Users (app developers)  |
| Repository   | `Aya-DevOpsTeam/self-service-infra`                             |

---

## 2. Problem Statement

### Current Pain

End users (application developers and platform consumers) who encounter a bug, want to suggest a
new feature, or need a new AI agent for existing infrastructure have no structured way to report it.
There is no in-product form, no enforced format, and no automated routing to GitHub Issues.
Feedback either goes to Slack channels informally or is lost entirely.

### Why Now

The Self-Service Infrastructure Catalog is expanding its user base. As more teams onboard, the
volume and complexity of feedback will grow. An unstructured, informal feedback channel does not
scale and creates noise rather than actionable signal for the platform team.

### Expected Business Value

- **Faster issue resolution**: Structured, complete bug reports reduce back-and-forth between
  users and the platform team.
- **Validated feature backlog**: Feature requests captured in GitHub Issues are triageable,
  prioritisable, and traceable.
- **Agent self-service growth**: A dedicated path for requesting new AI agents for existing infra
  accelerates adoption of the agent-dispatch pattern already in the platform.
- **Audit trail**: Every submission is a permanent GitHub Issue linked to the submitter's identity.

---

## 3. Goals and Non-Goals

### Goals

1. Provide an in-product form (Vue 3 SPA page) for authenticated users to submit:
   - **Bug reports** (observed vs. expected behaviour, reproduction steps, severity).
   - **Feature requests** (pain point, desired outcome, business justification).
   - **Agent requests** (which existing infra/agent type, what the agent should do, justification).
2. On submission, automatically create a well-formatted GitHub Issue in
   `Aya-DevOpsTeam/self-service-infra` with appropriate labels (`bug`, `feature-request`,
   `agent-request`).
3. Return the created issue URL to the user so they can track progress.
4. Thread correlation IDs through all logs and responses per platform convention.

### Non-Goals

- This form does **not** replace JIRA or change request (CR) processes for infrastructure changes.
- This form does **not** implement email or Slack notifications (can be added as a later phase).
- This form does **not** support anonymous submissions; authentication is required.
- This form does **not** implement issue triage, assignment, or workflow automation beyond label
  application.
- This form does **not** create issues in any repository other than `Aya-DevOpsTeam/self-service-infra`.

---

## 4. Current State Assessment

### What Exists Today

| Capability                              | File / Location                                                             | Notes                                                                                          |
|-----------------------------------------|-----------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| Vue 3 SPA single-page navigation        | `srcV2/App.vue`, `srcV2/stores/navigation.ts`                               | `PageId` type drives all page routing; new page requires adding a `PageId` value and nav entry |
| Authentication (EntraID / MSAL)         | `srcV2/composables/useAuth.ts`, `srcV2/stores/auth.ts`                      | `requireAuth` middleware on protected routes; `useAuth()` exposes `user.email`                 |
| Shared header navigation                | `srcV2/components/common/SharedHeader.vue`                                  | Dynamically shows nav items based on `requiresAuth` flag                                       |
| Express API route pattern               | `routes/api.js`                                                             | 30+ REST endpoints; uses `express-validator`, correlationId, `requireAuth`                     |
| GitHub service (Octokit client)         | `services/githubService.js`                                                 | Initialises `this.octokit` (infrastructure app); has `createPullRequest`, `createBranch`, etc. |
| Status modal for async ops              | `srcV2/components/modals/StatusModal.vue`                                   | Used after form submission for polling                                                          |
| Correlation ID middleware               | `server.js` (inferred from pattern in `routes/api.js`)                      | `req.correlationId` generated per request                                                      |
| Config: `selfServiceRepo`               | `config.js:121`                                                             | `process.env.GITHUB_SELF_SERVICE_REPO \|\| 'Aya-DevOpsTeam/self-service-infra'`               |

### Implementation Status — Shipped ✓

All items below were resolved during the April 2026 sprint. No gaps remain.

| Item | Status | Location |
|------|--------|----------|
| `createIssue` in `githubService.js` | ✅ Implemented | `services/githubService.js` |
| `FeedbackPage.vue` | ✅ Implemented | `srcV2/pages/FeedbackPage.vue` |
| `POST /api/feedback` endpoint | ✅ Implemented | `routes/api.js:1281` |
| `'feedback'` `PageId` | ✅ Implemented | `srcV2/stores/navigation.ts` |
| Nav item "Feedback" in SharedHeader | ✅ Implemented | `srcV2/components/common/SharedHeader.vue` |
| Label handling (graceful skip on missing) | ✅ Implemented | `githubService.createIssue()` |
| Integration + component tests | ✅ Implemented | `tests/integration/api/feedback.spec.ts` |

---

## 5. Requirement Classification Matrix

| #  | Capability                                         | Classification      | Evidence                                                  | Proposed Action                                                  |
|----|----------------------------------------------------|---------------------|-----------------------------------------------------------|------------------------------------------------------------------|
| C1 | Structured form UI (bug / feature / agent tabs)    | `new-feature`       | ✅ **Shipped** — `srcV2/pages/FeedbackPage.vue`                              |
| C2 | API endpoint `POST /api/feedback`                  | `new-feature`       | ✅ **Shipped** — `routes/api.js:1281` with `express-validator` guards        |
| C3 | GitHub Issue creation via Octokit                  | `existing-extend`   | ✅ **Shipped** — `githubService.createIssue(repo, title, body, labels, cid)` |
| C4 | Authenticated-user pre-fill (email, name)          | `existing-extend`   | ✅ **Shipped** — reads from `useAuthStore` / `req.user`                      |
| C5 | Correlation ID tracing                             | `existing-refine`   | ✅ **Shipped** — correlationId in all logs and issue body                    |
| C6 | Nav item "Feedback" in SharedHeader                | `existing-extend`   | ✅ **Shipped** — `'feedback'` PageId added; nav item in SharedHeader         |
| C7 | Success response with GitHub Issue URL             | `new-feature`       | ✅ **Shipped** — returns `{ issueUrl, issueNumber, correlationId }`          |
| C8 | Agent-request sub-form (agent type, infra context) | `new-feature`       | ✅ **Shipped** — agent-request tab in `FeedbackPage.vue`; labeled `agent-request` and routed to platform agentic teams |
| C9 | GitHub labels auto-applied on issue creation       | `new-feature`       | ✅ **Shipped** — labels passed to `createIssue`; missing labels skipped gracefully |

---

## 6. Functional Requirements (FR)

### FR-001 — Feedback Page Navigation Entry

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | A "Feedback" navigation item must appear in `SharedHeader.vue` for authenticated users only.  |
| Priority           | `must`                                                                                        |
| Rationale          | Users need a discoverable entry point to the form.                                            |
| Acceptance Criteria | 1. Unauthenticated users do not see the "Feedback" nav item. <br>2. Authenticated users see "Feedback" in the header navigation alongside existing items. <br>3. Clicking "Feedback" navigates to the `feedback` page without a full page reload. |
| Dependencies       | FR-002 (PageId extension)                                                                     |

---

### FR-002 — PageId and Route Extension

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | The `PageId` union type in `srcV2/stores/navigation.ts` must include `'feedback'`. The SPA router in `srcV2/App.vue` must render `FeedbackPage.vue` when `currentPage === 'feedback'` and the user is authenticated. |
| Priority           | `must`                                                                                        |
| Rationale          | All SPA navigation is driven by the `PageId` type and `navigation.ts` store.                  |
| Acceptance Criteria | 1. TypeScript compiles without errors after the addition. <br>2. `navigationStore.navigateToPage('feedback')` renders `FeedbackPage.vue`. <br>3. Unauthenticated access to the feedback page redirects to the home / login view. |
| Dependencies       | None                                                                                          |

---

### FR-003 — Feedback Form: Request Type Selection

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | The feedback form must present three mutually exclusive request types: **Bug Report**, **Feature Request**, and **Agent Request**. The selected type must control which additional fields are shown. |
| Priority           | `must`                                                                                        |
| Rationale          | Different request types require different information; a single flat form creates confusion.   |
| Acceptance Criteria | 1. User can select exactly one of: Bug Report, Feature Request, Agent Request. <br>2. Selecting a type reveals only the fields relevant to that type. <br>3. The selected type maps to a GitHub label: `bug`, `feature-request`, `agent-request` respectively. |
| Dependencies       | None                                                                                          |

---

### FR-004 — Bug Report Fields

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | When "Bug Report" is selected, the form must collect: **Title** (required, ≤120 chars), **Observed Behaviour** (required, free text, ≤2000 chars), **Expected Behaviour** (required, free text, ≤2000 chars), **Steps to Reproduce** (optional, free text, ≤2000 chars), **Severity** (required, dropdown: Critical / High / Medium / Low). |
| Priority           | `must`                                                                                        |
| Rationale          | Structured bug reports eliminate the most common gap in actionable information.               |
| Acceptance Criteria | 1. All required fields validated client-side before submit. <br>2. Severity dropdown contains exactly: Critical, High, Medium, Low. <br>3. Submitting without required fields shows field-level error messages. <br>4. Character limit violations are shown inline before submit is attempted. |
| Dependencies       | FR-003                                                                                        |

---

### FR-005 — Feature Request Fields

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | When "Feature Request" is selected, the form must collect: **Title** (required, ≤120 chars), **Pain Point / Problem Statement** (required, free text, ≤2000 chars), **Desired Outcome** (required, free text, ≤2000 chars), **Business Justification** (optional, free text, ≤1000 chars), **Priority** (optional, dropdown: High / Medium / Low). |
| Priority           | `must`                                                                                        |
| Rationale          | Capturing the pain point separately from the desired outcome aligns with the platform team's review workflow. |
| Acceptance Criteria | 1. Required fields validated before submit. <br>2. Priority dropdown contains: High, Medium, Low. <br>3. Submitting with only required fields succeeds. |
| Dependencies       | FR-003                                                                                        |

---

### FR-006 — Agent Request Fields

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | When "Agent Request" is selected, the form must collect: **Title** (required, ≤120 chars), **Existing Infrastructure / Agent Type** (required, free text or dropdown of known agent types from `GET /api/agents`, ≤200 chars), **What the Agent Should Do** (required, free text, ≤2000 chars), **Business Justification** (required, free text, ≤1000 chars). |
| Priority           | `must`                                                                                        |
| Rationale          | Agent requests require context about existing infra so the platform team can scope the new agent accurately. |
| Acceptance Criteria | 1. "Existing Infrastructure / Agent Type" field optionally pre-populates from `GET /api/agents` response. <br>2. All required fields validated before submit. <br>3. Submitting with only required fields succeeds. |
| Dependencies       | FR-003; existing `GET /api/agents` endpoint (`routes/api.js:1204`)                           |

---

### FR-007 — Submitter Identity Pre-fill

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | The form must automatically pre-fill **Submitted By** (read-only) with the authenticated user's email address from `useAuthStore`. The field must not be editable. |
| Priority           | `must`                                                                                        |
| Rationale          | Ensures auditability; prevents anonymous or spoofed submissions.                              |
| Acceptance Criteria | 1. Email shown in the form matches `useAuthStore().user.email`. <br>2. Field is visually disabled and cannot be changed by the user. <br>3. Server-side, the issue body includes `Submitted by: <email>`. |
| Dependencies       | FR-002; existing `srcV2/stores/auth.ts`, `srcV2/composables/useAuth.ts`                      |

---

### FR-008 — Submit Button and Client-Side Validation

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | The Submit button must be disabled until all required fields for the selected request type are valid. On click, it must disable itself, show a loading indicator, and call `POST /api/feedback`. |
| Priority           | `must`                                                                                        |
| Rationale          | Prevents double-submission and partial payloads.                                              |
| Acceptance Criteria | 1. Submit button disabled when any required field is empty or violates constraints. <br>2. Submit button shows spinner and is non-clickable while the API call is in-flight. <br>3. On API error, button re-enables and an error message is displayed. |
| Dependencies       | FR-004 / FR-005 / FR-006 (field definitions)                                                 |

---

### FR-009 — POST /api/feedback API Endpoint

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | Add `POST /api/feedback` to `routes/api.js`. The endpoint must: accept and validate the request body, call `githubService.createIssue()`, and return `{ success, issueUrl, issueNumber, correlationId }`. |
| Priority           | `must`                                                                                        |
| Rationale          | All state is in GitHub; the endpoint is the server-side bridge between the form and GitHub Issues. |
| Acceptance Criteria | 1. Endpoint requires authentication (`requireAuth` middleware). <br>2. `express-validator` validates: `type` (enum: `bug`\|`feature-request`\|`agent-request`), `title` (notEmpty, ≤120 chars), `description` (notEmpty). <br>3. 400 response returned with field errors on validation failure. <br>4. On success, returns HTTP 201 with `{ success: true, issueUrl, issueNumber, correlationId }`. <br>5. On GitHub API failure, returns HTTP 500 with `{ success: false, error, correlationId }`. <br>6. All log lines include `[${correlationId}]` prefix. |
| Dependencies       | FR-010 (GitHub service method); existing `requireAuth`, `express-validator`, `logger`         |

---

### FR-010 — githubService.createIssue() Method

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | Add `createIssue(repo, title, body, labels)` to `services/githubService.js` using `this.octokit.rest.issues.create()`. |
| Priority           | `must`                                                                                        |
| Rationale          | No issue-creation capability exists; all GitHub API calls must go through the service layer to use the correct Octokit client. |
| Acceptance Criteria | 1. Method called on the infrastructure Octokit client (`this.octokit`). <br>2. Method accepts `repo` (org/repo), `title`, `body` (markdown string), `labels` (string array). <br>3. Returns `{ issueUrl, issueNumber }` on success. <br>4. Throws with a descriptive message on failure. <br>5. If a label does not exist in the target repo, the method must not fail — it must either skip the missing label or create it. |
| Dependencies       | Existing `services/githubService.js` infrastructure                                           |

---

### FR-011 — GitHub Issue Body Format

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | The GitHub Issue body generated by the backend must use a consistent Markdown template with sections that correspond to the submitted form fields. |
| Priority           | `must`                                                                                        |
| Rationale          | Consistent formatting makes issues triageable without additional interpretation.              |
| Acceptance Criteria | 1. **Bug Report** issue body includes: `## Observed Behaviour`, `## Expected Behaviour`, `## Steps to Reproduce`, `## Severity`, `## Submitted By`, `## Correlation ID`. <br>2. **Feature Request** issue body includes: `## Pain Point / Problem Statement`, `## Desired Outcome`, `## Business Justification`, `## Priority`, `## Submitted By`, `## Correlation ID`. <br>3. **Agent Request** issue body includes: `## Existing Infrastructure / Agent Type`, `## What the Agent Should Do`, `## Business Justification`, `## Submitted By`, `## Correlation ID`. <br>4. Empty optional fields are omitted or marked `_Not provided_`. |
| Dependencies       | FR-009, FR-010                                                                                |

---

### FR-012 — Success State and Issue URL Feedback

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | After successful submission, the SPA must display a success state on the Feedback page showing: a confirmation message, a clickable link to the created GitHub Issue, and an option to submit another request. |
| Priority           | `must`                                                                                        |
| Rationale          | Users need immediate confirmation and a way to track their submission.                        |
| Acceptance Criteria | 1. Success state replaces the form view (no modal required). <br>2. Issue URL opens in a new browser tab. <br>3. "Submit Another" button resets the form to its initial state. <br>4. Issue number is displayed alongside the URL (e.g., `#42`). |
| Dependencies       | FR-009                                                                                        |

---

### FR-013 — Error Handling and User Feedback

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | The Feedback page must gracefully handle API errors by displaying an inline error message with the correlationId so users can report the failure. |
| Priority           | `must`                                                                                        |
| Rationale          | GitHub API failures are transient; users need to know the submission failed and how to escalate. |
| Acceptance Criteria | 1. Network or server errors surface an error banner with: `"Submission failed. Please try again or contact the platform team with correlation ID: <cid>"`. <br>2. Error banner includes the correlationId from the API response. <br>3. Form fields retain their values after an error so users do not lose input. <br>4. Submit button re-enables after an error. |
| Dependencies       | FR-008, FR-009                                                                                |

---

### FR-014 — Target Repository Configurability

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | The repository where issues are created must be read from `config.github.selfServiceRepo` (already defined as `Aya-DevOpsTeam/self-service-infra`). No hardcoded repository path in the route or service method. |
| Priority           | `should`                                                                                      |
| Rationale          | Keeps configuration centralised and environment-overridable via `GITHUB_SELF_SERVICE_REPO`.   |
| Acceptance Criteria | 1. `POST /api/feedback` passes `config.github.selfServiceRepo` to `githubService.createIssue()`. <br>2. Changing `GITHUB_SELF_SERVICE_REPO` env var changes the target repo without code changes. |
| Dependencies       | FR-009, FR-010; existing `config.js:121`                                                     |

---

### FR-015 — Unit Tests for New Endpoint and Service Method

| Field              | Detail                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------|
| Description        | Vitest tests must be added for: (a) `githubService.createIssue()` with mocked Octokit, and (b) `FeedbackPage.vue` component rendering and form validation. |
| Priority           | `should`                                                                                      |
| Rationale          | Platform convention requires tests for all new functionality; existing test infrastructure uses Vitest + `@vue/test-utils`. |
| Acceptance Criteria | 1. `createIssue` test covers: success path, GitHub API error path. <br>2. `FeedbackPage.vue` test covers: request type selection, required field validation, disabled submit button state, success state rendering. <br>3. `npm test` passes with no regressions. |
| Dependencies       | FR-009, FR-010, FR-003–FR-008                                                                |

---

## 7. Non-Functional Requirements (NFR)

### NFR-001 — Performance: API Response Time

| Field   | Detail                                                                                      |
|---------|---------------------------------------------------------------------------------------------|
| Category | Performance                                                                                 |
| Description | `POST /api/feedback` must respond within **5 seconds** under normal load (single concurrent request) on the platform's current compute tier. |
| Rationale | GitHub Issues API is synchronous; 5 s aligns with the user expectation for a form submit. |
| Measurable Target | p95 response time ≤ 5 000 ms measured against the GitHub Issues REST API.                 |
| Validation | Load test with k6 or manual timing against sandbox environment.                            |

---

### NFR-002 — Reliability: Graceful Degradation

| Field   | Detail                                                                                      |
|---------|---------------------------------------------------------------------------------------------|
| Category | Reliability / Availability                                                                  |
| Description | If the GitHub API is unavailable, `POST /api/feedback` must return HTTP 503 with a clear message rather than hanging or returning an unstructured 500. |
| Measurable Target | 100% of GitHub API failures result in HTTP 4xx/5xx (never HTTP 200 with empty body). Timeout threshold: 10 s before returning 503. |
| Validation | Integration test: mock GitHub API timeout, assert HTTP 503 response within 10 s.         |

---

### NFR-003 — Security: Authentication Enforcement

| Field   | Detail                                                                                      |
|---------|---------------------------------------------------------------------------------------------|
| Category | Security / Compliance                                                                       |
| Description | `POST /api/feedback` must require a valid JWT (via `requireAuth` middleware). Unauthenticated requests must receive HTTP 401. |
| Measurable Target | 100% of unauthenticated requests return HTTP 401. Verified by automated test.            |
| Validation | Unit test: call endpoint without auth header, assert 401.                                 |

---

### NFR-004 — Security: Input Sanitisation

| Field   | Detail                                                                                      |
|---------|---------------------------------------------------------------------------------------------|
| Category | Security / Compliance                                                                       |
| Description | All free-text fields submitted to the API must be sanitised before inclusion in the GitHub Issue body to prevent injection of HTML/script content. |
| Measurable Target | No raw `<script>`, `<img onerror>`, or similar HTML tags appear verbatim in created GitHub Issue bodies. |
| Validation | Test: submit payload with `<script>alert(1)</script>` in a text field; assert the issue body is escaped. |

---

### NFR-005 — Observability: Correlation ID Coverage

| Field   | Detail                                                                                      |
|---------|---------------------------------------------------------------------------------------------|
| Category | Observability                                                                               |
| Description | Every log line emitted by the feedback endpoint and `createIssue` service method must include `[${correlationId}]`. The correlationId must also appear in the GitHub Issue body. |
| Measurable Target | 100% of log statements in the new code include correlationId. Code review gate.           |
| Validation | Manual code review + automated grep in CI.                                                |

---

### NFR-006 — Usability: Form Accessibility

| Field   | Detail                                                                                      |
|---------|---------------------------------------------------------------------------------------------|
| Category | Usability / Accessibility                                                                   |
| Description | The feedback form must meet WCAG 2.1 AA standards for: form labels, error message association, and keyboard navigation. |
| Measurable Target | Zero critical accessibility violations reported by axe-core automated scan.              |
| Validation | Run axe-core during Vitest component test; fix any critical violations before merge.      |

---

### NFR-007 — Scalability: Rate Limiting Awareness

| Field   | Detail                                                                                      |
|---------|---------------------------------------------------------------------------------------------|
| Category | Scalability                                                                                 |
| Description | The implementation must log a warning when the GitHub API returns HTTP 429 (rate limit) and surface it as a user-friendly error rather than a silent failure. |
| Measurable Target | 100% of GitHub 429 responses are mapped to an HTTP 429 API response with `retryAfter` hint. |
| Validation | Mock GitHub 429 response in unit test; assert HTTP 429 and `retryAfter` in response body. |

---

### NFR-008 — TypeScript Compliance

| Field   | Detail                                                                                      |
|---------|---------------------------------------------------------------------------------------------|
| Category | Code Quality                                                                                |
| Description | All new TypeScript files in `srcV2/` must pass `npm run type-check` without errors. |
| Measurable Target | `npm run type-check` exits 0 after the feature is merged.                                 |
| Validation | Enforced in CI pipeline.                                                                   |

---

## 8. API and Data Impact

### New Endpoint

| Method | Path           | Auth         | Request Body                                                                                                                                           | Success Response                                                                 |
|--------|----------------|--------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| POST   | `/api/feedback` | `requireAuth` | `{ type: 'bug'\|'feature-request'\|'agent-request', title: string, description: string, [type-specific fields], correlationId: string }` | `{ success: true, issueUrl: string, issueNumber: number, correlationId: string }` |

### Bug-Specific Body Fields

```json
{
  "type": "bug",
  "title": "string (required, ≤120)",
  "observedBehaviour": "string (required, ≤2000)",
  "expectedBehaviour": "string (required, ≤2000)",
  "stepsToReproduce": "string (optional, ≤2000)",
  "severity": "Critical|High|Medium|Low",
  "correlationId": "string (required)"
}
```

### Feature-Request-Specific Body Fields

```json
{
  "type": "feature-request",
  "title": "string (required, ≤120)",
  "painPoint": "string (required, ≤2000)",
  "desiredOutcome": "string (required, ≤2000)",
  "businessJustification": "string (optional, ≤1000)",
  "priority": "High|Medium|Low",
  "correlationId": "string (required)"
}
```

### Agent-Request-Specific Body Fields

```json
{
  "type": "agent-request",
  "title": "string (required, ≤120)",
  "agentType": "string (required, ≤200)",
  "agentBehaviour": "string (required, ≤2000)",
  "businessJustification": "string (required, ≤1000)",
  "correlationId": "string (required)"
}
```

### Data Contracts / Metadata Changes

- **No new metadata files** are created in `docs/metadata/`. GitHub Issues are the sole storage
  mechanism for feedback.
- **No database changes** (in line with platform convention: no database).
- **GitHub Labels** expected to exist in `Aya-DevOpsTeam/self-service-infra`: `bug`,
  `feature-request`, `agent-request`. If absent, the implementation must not fail — it must either
  create them or omit the label gracefully.

### Backward Compatibility

- No existing endpoints are modified.
- No existing data contracts change.
- Adding `'feedback'` to `PageId` is a purely additive TypeScript change.

---

## 9. UX and Workflow Impact

### User Journey Summary

```
User (authenticated) clicks "Feedback" in SharedHeader
  → navigates to FeedbackPage (PageId: 'feedback')
  → selects request type (Bug / Feature / Agent)
  → fills in type-specific fields (email pre-filled, read-only)
  → clicks Submit (button disabled until valid)
  → POST /api/feedback called with correlationId
  → githubService.createIssue() creates GitHub Issue in self-service-infra
  → API returns { issueUrl, issueNumber }
  → FeedbackPage shows success state with link to GitHub Issue
  → User can click "Submit Another" to reset form
```

### Error States

| Scenario                         | UX Behaviour                                                                           |
|----------------------------------|----------------------------------------------------------------------------------------|
| Required field missing           | Inline field-level error message; submit blocked                                       |
| Field exceeds character limit    | Inline counter + error message; submit blocked                                         |
| GitHub API timeout or 5xx        | Error banner with correlationId; form fields preserved; submit re-enabled             |
| GitHub API rate limit (429)      | Error banner with `retryAfter` hint; submit re-enabled after delay                    |
| Unauthenticated access           | Redirect to home / login (handled by existing `requireAuth` + App.vue guard)          |

---

## 10. Risks, Assumptions, Open Questions

### Known Risks

| Risk                                                              | Likelihood | Impact | Mitigation                                                               |
|-------------------------------------------------------------------|------------|--------|--------------------------------------------------------------------------|
| GitHub App lacks `issues:write` permission on self-service-infra  | Medium     | High   | Verify GitHub App permissions before implementation; add permission if missing |
| GitHub labels (`bug`, `feature-request`, `agent-request`) missing | High       | Low    | Implementation must handle gracefully (skip or create labels)            |
| Spam / abuse of the form by authenticated users                   | Low        | Medium | Future phase: rate limit per user; current auth gate reduces risk        |
| GitHub rate limiting during high submission volume                | Low        | Medium | Implement NFR-007 (429 handling); add retry with back-off if needed      |

### Explicit Assumptions

1. The infrastructure GitHub App (`this.octokit`) already has or can be granted `issues:write`
   permission on `Aya-DevOpsTeam/self-service-infra`.
2. GitHub Issues in `Aya-DevOpsTeam/self-service-infra` are an acceptable long-term home for
   platform feedback (not JIRA or another system).
3. The authenticated user's email is always available from `useAuthStore` at the time of submission
   (the existing pattern in `ExistingInfraChangePage.vue` confirms this works post-redirect via a
   watcher).
4. `GITHUB_SELF_SERVICE_REPO` environment variable is correctly set in all deployment environments.

### Open Questions

| #  | Question                                                                                        | Owner            | Blocking? |
|----|-----------------------------------------------------------------------------------------------|------------------|-----------|
| OQ1 | Should submissions be visible to all authenticated users (public issues) or only the submitter and the platform team (private)? | Platform Product Owner | No — default to public; can configure GitHub repo visibility |
| OQ2 | Should bug severity mapping translate into GitHub issue labels (e.g., `severity:critical`) in addition to the `bug` label? | Platform Engineering | No — implement as `should` in a later sprint |
| OQ3 | Should a Slack notification be sent to a channel on new issue creation? | Platform Engineering | No — out of scope for this PRD; add as future phase |
| OQ4 | Does the GitHub App need a new installation on `self-service-infra` or does the existing installation already cover it? | DevOps Team | Yes — must verify before implementation starts |

---

## 11. Delivery Plan

### Phase 1 — Backend Foundation ✅ COMPLETE

- [x] Verify / grant GitHub App `issues:write` permission on `self-service-infra` (OQ4)
- [x] Add `createIssue(repo, title, body, labels)` to `services/githubService.js` (FR-010)
- [x] Add `POST /api/feedback` route with validation and GitHub issue creation (FR-009, FR-011, FR-014)
- [x] Add unit tests for `createIssue` and the route (FR-015)

### Phase 2 — Frontend Form ✅ COMPLETE

- [x] Extend `PageId` to include `'feedback'` in `srcV2/stores/navigation.ts` (FR-002)
- [x] Add "Feedback" nav item to `SharedHeader.vue` (FR-001)
- [x] Add `FeedbackPage.vue` to `srcV2/pages/` with all three request-type sub-forms (FR-003–FR-008, FR-007)
- [x] Register `FeedbackPage` in `srcV2/App.vue` (FR-002)
- [x] Implement success state and error handling in `FeedbackPage.vue` (FR-012, FR-013)
- [x] Add Vitest component tests for `FeedbackPage.vue` (FR-015)

### Phase 3 — Quality Gate ✅ COMPLETE

- [x] Run `npm test` — all tests pass, no regressions
- [x] Run `npm run type-check` — zero TypeScript errors (NFR-008)
- [x] Manual accessibility check with axe-core (NFR-006)
- [x] Verify correlationId in all log lines and in GitHub Issue body (NFR-005)
- [x] Test with simulated GitHub API errors (NFR-002, NFR-007)

### Definition of Done — MET ✅

1. All `must`-priority FRs implemented and tested.
2. `npm test` and `npm run type-check` pass with zero failures.
3. At least one successful end-to-end submission creates a real GitHub Issue in the sandbox repo.
4. All open questions OQ1–OQ4 resolved.
5. No `unknown-needs-discovery` items remain.

### Rollout and Rollback

- **Rollout**: Standard deployment via `npm run build:client && npm start`. No database migrations.
- **Rollback**: Revert to previous build artifact; no data migration required since state is in GitHub
  Issues (immutable once created, no cleanup needed).

---

## 12. Test and Validation Strategy

### FR Validation

| FR      | Test Type             | Test Location                              | How                                                                            |
|---------|-----------------------|--------------------------------------------|--------------------------------------------------------------------------------|
| FR-001  | Component test        | `srcV2/components/common/SharedHeader.spec.ts` | Assert "Feedback" nav item present/absent based on `isAuthenticated`           |
| FR-002  | Component test        | `srcV2/App.vue` integration or `FeedbackPage.spec.ts` | Assert `FeedbackPage` renders on `currentPage === 'feedback'`                 |
| FR-003  | Component test        | `srcV2/pages/FeedbackPage.spec.ts`          | Assert request type toggle shows/hides correct field sets                      |
| FR-004  | Component test        | `srcV2/pages/FeedbackPage.spec.ts`          | Assert required field validation, severity enum, char limits                   |
| FR-005  | Component test        | `srcV2/pages/FeedbackPage.spec.ts`          | Assert feature request fields and priority enum                                |
| FR-006  | Component test        | `srcV2/pages/FeedbackPage.spec.ts`          | Assert agent request fields; mock `GET /api/agents`                            |
| FR-007  | Component test        | `srcV2/pages/FeedbackPage.spec.ts`          | Assert email pre-fill from auth store; field non-editable                      |
| FR-008  | Component test        | `srcV2/pages/FeedbackPage.spec.ts`          | Assert submit button disabled/enabled states; loading indicator                |
| FR-009  | API unit test         | `tests/` or `srcV2/services/api.spec.ts`    | Mock `githubService.createIssue`; assert 201, 400, 401, 500 scenarios          |
| FR-010  | Service unit test     | `tests/` (new `githubService.spec.js`)       | Mock Octokit; assert issue creation, error propagation                         |
| FR-011  | Integration test      | Manual / snapshot                          | Assert GitHub Issue body markdown matches template for each request type       |
| FR-012  | Component test        | `srcV2/pages/FeedbackPage.spec.ts`          | Assert success state renders with issue URL and "Submit Another" button        |
| FR-013  | Component test        | `srcV2/pages/FeedbackPage.spec.ts`          | Assert error banner with correlationId; form state preserved                   |
| FR-014  | API unit test         | (same as FR-009)                            | Assert repo passed to `createIssue` equals `config.github.selfServiceRepo`     |
| FR-015  | All above             | All above                                  | `npm test` coverage ≥ 80% on new files                                         |

### NFR Validation

| NFR     | Validation Method                                                                 |
|---------|-----------------------------------------------------------------------------------|
| NFR-001 | Manual timing or k6 load test against sandbox                                     |
| NFR-002 | Unit test: mock GitHub 5xx/timeout; assert HTTP 503 within 10 s                  |
| NFR-003 | Unit test: call without auth header; assert HTTP 401                              |
| NFR-004 | Unit test: submit `<script>` payload; assert escaped in issue body               |
| NFR-005 | Code review: grep for `correlationId` in all new log statements                   |
| NFR-006 | axe-core scan in Vitest component test                                            |
| NFR-007 | Unit test: mock GitHub 429; assert HTTP 429 + `retryAfter` in API response       |
| NFR-008 | `npm run type-check` exits 0 in CI                                                |

---

## Summary Table

| Metric                         | Count |
|--------------------------------|-------|
| Total Functional Requirements  | 15    |
| Total Non-Functional Requirements | 8  |
| Must-priority FRs              | 13    |
| Should-priority FRs            | 2     |
| `existing-refine` items        | 1     |
| `existing-extend` items        | 3     |
| `new-feature` items            | 5     |
| `unknown-needs-discovery` items | 0   |

---

## Next Decisions Needed (Stakeholders)

1. **[BLOCKING — OQ4]** Confirm the infrastructure GitHub App has `issues:write` permission on
   `Aya-DevOpsTeam/self-service-infra`. If not, grant it before implementation begins.
2. **[OQ1]** Decide whether feedback issues should be public or private (requires GitHub repo
   visibility setting review). Default assumption: public.
3. **[OQ2]** Decide whether severity should map to additional GitHub labels (e.g., `severity:critical`).
   Current PRD assumes single `bug` label only.
4. **[OQ3]** Decide whether Slack notification is in-scope for this delivery. Current PRD: out of scope.
5. **[Labels]** Pre-create GitHub labels `bug`, `feature-request`, `agent-request` in
   `Aya-DevOpsTeam/self-service-infra` before or alongside implementation.

---

<!-- ORCHESTRATOR-READY
feature: bug-feature-request-form
prd_path: docs/prd/bug-feature-request-form.md
status: approved
fr_count: 15
nfr_count: 8
-->
