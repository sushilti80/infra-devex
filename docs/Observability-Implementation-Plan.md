# Self Service Infra Observability Implementation Plan

Date: 2026-03-31
Owner: SRE DevOps + Platform Engineering
Scope: Node/Express API, Vue SPA, GitHub workflow orchestration, Docker delivery path

## A) Current State Findings

### What exists
- Correlation ID middleware exists in server startup and is threaded through many API responses and logs.
- Structured logging is present via Winston and correlation-aware console formatting.
- Workflow polling exists in Vue store/composable with terminal states and timeout handling.
- Health endpoint exists with basic GitHub service connectivity check.
- AKS and Infra workflow status APIs exist and are used by the frontend.

### Gaps
- No formal SLI/SLO definitions or error budget policy.
- No application metrics endpoint (Prometheus/OpenTelemetry) for request latency, error rates, or in-flight operations.
- No distributed tracing for API -> GitHub API calls -> workflow status retrieval.
- Logging schema is inconsistent across API and services (mixed message-only logs and object logs).
- No explicit dashboard and alert specification with thresholds/severity.
- Frontend UX and polling metrics are not captured as telemetry.
- CI/CD gates do not enforce observability readiness and Wiz security outcomes as release criteria.

## B) Top 10 Production Signals That Matter

1. API availability percentage for authenticated endpoints.
2. API p95 latency for core operations: custom provision, template deploy, delete, promote, aks deploy.
3. 5xx error rate by endpoint and environment.
4. 4xx auth/validation error ratio (to detect UX/API contract drift).
5. Workflow trigger success rate (dispatch accepted vs failed).
6. Workflow completion success rate by type (infra, aks, agent-change).
7. Workflow time to completion p50/p95 by type.
8. Polling timeout rate (frontend marked timeout before terminal workflow result).
9. GitHub API dependency latency and error rate (token/auth, create PR, dispatch, status lookup).
10. Health endpoint dependency status trend (github connected/not_initialized/error).

## C) SLI/SLO Table

| SLI | Definition | Target SLO | Window | Error Budget |
|---|---|---|---|---|
| API Availability | Successful responses for critical routes / total requests | 99.9% | 30d | 43m 49s/month |
| API Latency | p95 latency for critical routes | <= 750ms | 30d | 5% of requests may exceed |
| API Correctness | 5xx rate for critical routes | < 0.5% | 30d | 0.5% |
| Workflow Trigger Reliability | Dispatch success / trigger attempts | >= 99.5% | 30d | 0.5% |
| Workflow Completion Reliability | Successful terminal workflows / all terminal workflows | >= 98.5% | 30d | 1.5% |
| Workflow Completion Time | p95 time from trigger to terminal status | <= 12m | 30d | 5% may exceed |
| Polling Experience Reliability | Polling sessions that avoid timeout false-negatives | >= 99.0% | 30d | 1.0% |
| Auth Reliability | Token-refresh success for recoverable 401s | >= 99.5% | 30d | 0.5% |

Error Budget Policy:
- Burn rate > 2x on 1h and > 1x on 6h: freeze non-critical releases.
- Burn rate > 4x on 1h: incident mode and rollback readiness.

## D) Implementation Plan by Phase

### Phase 0 (Week 1): Baseline Instrumentation and Logging Contract

Owner roles:
- SRE DevOps: telemetry standard + dashboards + alert policy
- Backend Engineer: API metrics and log schema implementation
- Frontend Engineer: workflow UX telemetry events

File-level changes:
1. server.js
- Add request lifecycle telemetry middleware:
  - request_total counter labels: method, route, status_code
  - request_duration_ms histogram labels: method, route, status_code
  - in_flight gauge by route
- Add response-time capture and standardized request completion log record.
- Add readiness/liveness split (keep current health, add readiness with dependency detail).

2. utils/logger.js
- Standardize log schema fields:
  - ts, level, service, env, correlation_id, route, method, status_code, duration_ms, operation, workflow_type, workflow_id, user_hash
- Keep human-friendly console output but ensure JSON payload is consistent.

3. routes/api.js
- Wrap critical handlers with operation labels:
  - custom_provision, template_provision, delete_infra, promote_infra, aks_deploy, workflow_status_lookup
- Ensure all success and error paths include correlationId and operation metadata.

4. srcV2/stores/workflow.ts
- Emit telemetry events at transitions:
  - workflow_track_started
  - workflow_status_changed
  - workflow_poll_timeout
  - workflow_terminal
- Capture elapsed_ms and workflowType dimensions.

5. srcV2/services/api.ts
- Add client-side timing for API calls and annotate with endpoint key + status.
- Add retry outcome telemetry for 401 refresh path.

Acceptance criteria:
- For any request, logs can be queried by correlation_id and contain duration + status.
- Endpoint-level p95 latency and error rate are available from metrics.
- Workflow timeout events and terminal outcomes are visible in telemetry.

### Phase 1 (Week 2): Dashboards, Alerts, and SLO Burn Alerts

Owner roles:
- SRE DevOps: dashboard and alert implementation
- Backend Engineer: dependency telemetry for GitHub calls

File-level changes:
1. services/githubService.js
- Instrument outbound GitHub calls with metrics:
  - github_api_requests_total labels: operation, result
  - github_api_duration_ms histogram labels: operation
  - github_auth_failures_total
- Add structured dependency logs with operation names.

2. services/infrastructureService.js
- Add workflow lifecycle checkpoints with structured operation fields.
- Add fallback-path metric (github_to_local_fallback_total).

3. services/aksService.js
- Track correlation search effectiveness:
  - workflow_search_attempts_total
  - workflow_search_matches_total
  - log_download_failures_total

Dashboard spec (minimum):
- API Health:
  - request rate, error rate, p50/p95 latency, availability
- Workflow Reliability:
  - trigger success rate, terminal success rate, completion time p95
- Dependency Health:
  - GitHub API latency/error/auth failures
- User Experience:
  - frontend polling timeout rate, avg polling duration, auth refresh success
- Security Gate:
  - latest Wiz scan status by build, critical/high count trend

Alert thresholds:
- P1:
  - API availability < 99.0% for 10m
  - 5xx > 5% for 5m on critical endpoints
  - Workflow trigger failure > 10% for 10m
- P2:
  - p95 latency > 1500ms for 15m
  - Polling timeout rate > 3% over 30m
  - GitHub API auth failures > 2% for 10m
- P3:
  - Health dependency status not_initialized/error for > 30m

Acceptance criteria:
- All SLIs visible on a single operational dashboard.
- Alert runbooks include severity, owner, and first-response steps.

### Phase 2 (Weeks 3-4): Tracing + Pipeline Gates + Reliability Hardening

Owner roles:
- SRE DevOps: release gates + incident policy
- Platform Engineer: CI/CD wiring
- Security Engineer: Wiz policy tuning

File-level changes:
1. package.json
- Add scripts for observability checks, e.g. telemetry contract tests and smoke metrics.

2. build-and-push.sh and validate-dockerfile-vue.sh
- Publish build metadata labels (git sha, build id, timestamp, env).
- Enforce image hardening checks (base image freshness, user non-root, vulnerability baseline).

3. Dockerfile
- Add OCI labels for traceability.
- Ensure healthcheck strategy aligns with /health and readiness endpoints.

4. tests/smoke and tests/integration
- Add reliability tests for status polling and workflow status API correctness.

Acceptance criteria:
- Every deployed image is traceable to commit and scan status.
- Release blocked automatically when SLO burn or security gate fails.
- On-call has dashboard + runbook coverage for all P1/P2 alerts.

## E) Alerting and Dashboard Spec (Panels + Thresholds + Severity)

### Dashboard: Self Service Infra - Executive Health
- Panel: API Availability (30d rolling) | target >= 99.9% | severity P1 if below 99.0% for 10m
- Panel: Error Rate by Endpoint | target < 0.5% 5xx | severity P1 if > 5% for 5m
- Panel: p95 Latency by Endpoint | target <= 750ms | severity P2 if > 1500ms for 15m
- Panel: Workflow Trigger Reliability | target >= 99.5% | severity P1 if < 90% for 10m
- Panel: Workflow Completion p95 | target <= 12m | severity P2 if > 20m for 30m

### Dashboard: Dependency and Queue Health
- Panel: GitHub API latency p95 by operation | P2 if > 2s for 15m
- Panel: GitHub API error/auth rate | P2 if auth > 2% for 10m
- Panel: Fallback to local data count | P3 on sustained increase

### Dashboard: UX Workflow Experience
- Panel: Polling timeout rate | P2 if > 3% over 30m
- Panel: Average polling elapsed by workflow type
- Panel: 401 refresh retry success rate | P2 if < 99% over 1h

## F) CI/CD and Docker Observability Gates

Mandatory gates before release:
1. Metrics contract check passes:
- Critical API routes emit request_total and request_duration_ms.

2. Log schema check passes:
- Required fields present in sample logs: correlation_id, operation, status_code, duration_ms.

3. SLO burn guard:
- Block release if 1h burn rate > 4x or 6h burn rate > 2x.

4. Docker observability labels present:
- org.opencontainers.image.revision
- org.opencontainers.image.created
- org.opencontainers.image.source

5. Smoke telemetry:
- /health and status endpoints tested and dashboards receive data.

## G) Security Gate Using Wiz Scan Policy

Policy suggestion:
- Sand environment:
  - Fail build on CRITICAL findings.
  - HIGH findings allowed only with approved exception ticket.
- Production:
  - Fail build on HIGH or CRITICAL findings.
  - No override without security approval.

Required report fields for each run:
- mode (code/image/build-image)
- target
- env
- findings by severity
- policy threshold
- PASS/FAIL
- remediation owner and ETA

Fix-and-verify loop:
1. Run Wiz scan
2. Triage top findings
3. Apply remediations
4. Rebuild image
5. Re-scan and confirm gate PASS

## H) Risks and Mitigations

1. Risk: Alert fatigue from noisy thresholds
- Mitigation: Two-stage thresholds and burn-rate alerts instead of static-only alerts.

2. Risk: High-cardinality telemetry labels
- Mitigation: Restrict label sets to route templates and workflow_type, avoid raw IDs as labels.

3. Risk: Incomplete correlation across services
- Mitigation: Require correlation_id in API response, frontend state, and service logs.

4. Risk: Polling timeout false negatives
- Mitigation: Extend timeout by workflow type and record timeout root cause events.

5. Risk: Security gates slow delivery
- Mitigation: Shift-left scan in sand and auto-create remediation backlog.

## I) First 2-Week Execution Checklist

Week 1
- Define canonical telemetry schema and metric names.
- Implement server request metrics and standardized completion logs.
- Instrument workflow transitions in frontend store and API client timings.
- Add dependency metrics in GitHub/infra/aks services.

Week 2
- Build 3 dashboards (Executive Health, Dependency, UX Workflow).
- Configure P1/P2/P3 alerts with runbook links.
- Add CI observability gates and Docker metadata checks.
- Run sand Wiz security gate and fix top findings.
- Review SLO baseline and tune thresholds from observed data.

## Suggested Metric Names

- api_requests_total{method,route,status_code}
- api_request_duration_ms_bucket{method,route,status_code}
- api_in_flight_requests{route}
- workflow_triggers_total{workflow_type,result}
- workflow_completion_total{workflow_type,result}
- workflow_completion_duration_ms_bucket{workflow_type}
- workflow_poll_timeouts_total{workflow_type}
- github_api_requests_total{operation,result}
- github_api_duration_ms_bucket{operation}
- github_auth_failures_total
- auth_token_refresh_total{result}
- data_fallback_total{source="github",fallback="local"}

## Suggested Structured Log Fields

- ts
- level
- service
- env
- correlation_id
- operation
- workflow_type
- workflow_id
- route
- method
- status_code
- duration_ms
- user_hash
- error_code
- error_message
