# Datadog Log Investigation Runbook

Audience: human operators and AI agents investigating self-service API failures.
Use read-only queries first. This runbook does not authorize deployment changes,
RBAC changes, monitor creation, or production test submissions.

## Safety and scope

- Never request, query for, copy, or persist submitted secret values, credentials,
  private keys, request bodies, full process environments, or raw SOPS stderr/stdout.
- Use a correlation ID, UTC time window, workload namespace, and operation to find
  evidence. Logs from older versions may contain sensitive or personal data:
  inspect and redact before quoting or saving them.
- Distinguish the app's hosting environment (`env:shared` or `env:sand`) from the
  requested infrastructure environment (`@environment:dev` or `@environments:dev`)
  and repository target (`@target:live` or `@target:sand`).
- Scope by Kubernetes namespace, not service alone. CI test output can use the same
  `service:self-service-infra` and contain synthetic encryption failures.
- New events described below are available only after the updated image is deployed.
  A query returning no matches does not establish that the operation succeeded.

| Workload | Hosting environment tag | Namespace | Deployment |
|---|---|---|---|
| Shared | `env:shared` | `kube_namespace:self-service` | `kube_deployment:self-service-app` |
| Sandbox | `env:sand` | `kube_namespace:self-service-test` | `kube_deployment:self-service-test-app` |

## 1. Establish a bounded search

Open Logs Explorer in the team's Datadog site. Select an absolute UTC window
starting five minutes before and ending five minutes after the reported failure.
Select the approved accessible log indexes; check index selection and retention if
an older incident has no results.

Start with both namespaces if the hosting environment is unknown:

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test)
```

For a known shared deployment, narrow to:

```text
service:self-service-infra env:shared kube_namespace:self-service
```

Do not start with `status:error`: historical submission failures were logged at
`info`, and partial submissions are now logged at `warn`.

Useful columns are `timestamp`, `status`, `event`, `correlation_id`, `appName`,
`target`, `environment`, `environments`, `bundleId`, `outcome`, `status_code`,
`reason`, `failure_category`, `process_code`, `phase`, `duration_ms`, `latency_ms`,
`version`, and `pod_name`. Some columns are absent on some event types.

## 2. Follow one request

Replace `REQUEST-CORRELATION-ID` with the ID from the API response. The full-text
branch also finds older logs that embed the ID in message text instead of an
attribute.

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) (@correlation_id:"REQUEST-CORRELATION-ID" OR *:"REQUEST-CORRELATION-ID")
```

Sort oldest first. Follow authentication, vault resolution, encryption failure,
submission outcome, and HTTP completion. The order of logs sharing a timestamp is
not guaranteed. One correlation ID may cover multiple environments and secrets.
Do not assume a bundle has written nothing unless its failure occurred before the
commit; a PR-creation failure can occur after a commit exists.

## 3. Find failed or partially failed submissions

This query includes old `info`-level outcome events:

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) @event:secret_create_submitted (@outcome:error OR @outcome:partial)
```

Narrow by adding validated identifiers such as `@appName:myapp`, `@target:live`,
`@environments:dev`, or `@bundleId:developer`.

Inspect:

- `outcome`: `success`, `partial`, or `error`.
- `status_code`: actual HTTP status on completed service submissions.
- `failures`: single/fan-out entries containing `environment` and `error_code`.
- `reason`: bundle failure code, or `UNKNOWN` for an unclassified exception.
- `error_code`: legacy numeric HTTP status on validation/bundle error events;
  **do not confuse this with the string code on encryption events**.
- `latency_ms`: submission duration.

Validation rejections may lack `status_code` and detailed failure entries. The
single/fan-out API continues to return HTTP 400 for `ENCRYPTION_FAILED`, and HTTP
207 for partial success. A 5xx-only query misses these failures.

For an overview, group submission events by `env`, `outcome`, and `appName`. Use
submission-event counts or unique correlation IDs to measure affected requests;
encryption-event counts measure failed encryption attempts, not unique users or
submissions. Bundles/fan-out can generate several encryption events per request.

## 4. Diagnose encryption failures

### New structured events

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) @event:secret_encryption_failed
```

For a missing executable:

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) @event:secret_encryption_failed @failure_category:sops_missing
```

| `failure_category` | Meaning | First investigation |
|---|---|---|
| `configuration_missing` | Key Vault URL or key version is missing; SOPS was not launched | Check required setting presence without printing values |
| `local_io_failed` | Temporary directory or input-file preparation failed | Check storage, permissions, and `process_code`; `ENOENT` here does not mean SOPS is missing |
| `sops_missing` | Launching SOPS returned `ENOENT` | Check executable, PATH, and runtime-image contents; do not assume a Key Vault denial |
| `sops_not_executable` | Launch returned `EACCES` or `EPERM` | Check executable permissions and runtime security policy |
| `timeout` | Subprocess reported `ETIMEDOUT` | Investigate dependency connectivity; no new execution timeout is introduced by logging |
| `output_limit` | Subprocess exceeded its output buffer | Investigate output volume without dumping it |
| `process_failed` | Other subprocess failure, possibly a numeric exit code | Follow the encryption runbook; an exit code alone does not identify Azure authorization, network, or key-state failures |

`phase` distinguishes `configuration`, `local_io`, and `sops_encrypt`.
`process_code` contains only allow-listed OS codes or an integer; it may be absent.
`duration_ms` measures elapsed time through failure, excluding cleanup.
Secret names, values, subprocess messages, stderr/stdout, arguments, and stack
traces are deliberately absent. Do not enable raw-error logging to fill that gap.

For cleanup warnings:

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) @event:secret_encryption_cleanup_failed
```

Cleanup warnings do not replace the original encryption result. A temporary input
file may remain; escalate to an authorized operator without reading or exporting it.

### Older images

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) ("Encryption failed" OR "ENCRYPTION_FAILED" OR "SOPS_NOT_CONFIGURED" OR @reason:ENCRYPTION_FAILED OR @reason:SOPS_NOT_CONFIGURED)
```

An older single/fan-out failure may only have `outcome:error`, without a cause
code. Return to the submission query and follow its correlation ID. The missing
cause cannot be reconstructed from generic error text.

Continue with [Secrets Encryption Failure Runbook](./secrets-encryption.md) for
runtime-image checks, rollback comparisons, and approved sandbox verification.

## 5. Check HTTP behavior and release boundaries

Find requests to the secrets submission endpoint without including submitted values:

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) @path:"/api/secrets" @method:POST
```

Inspect `status_code`, `duration_ms`, and `correlation_id`. Request completion events
currently use `info` severity even for HTTP errors; filter the structured status
rather than relying on `status:error`.

To compare deployments, add `version:DEPLOYED-VERSION`, `image_tag:IMAGE-TAG`, or
`pod_name:POD-NAME` to a scoped query after inspecting available tags. Compare the
same operation and similar windows before and after a deployment or rollback.
Older images may carry package version `2.0.0` instead of the deployed image version.
New logging/tracer configuration prefers `DD_VERSION`, but a stale deployment value
still produces a stale tag. Corroborate with `image_id`/digest and image tag.

## 6. Pivot to a trace when available

Inspect `dd.trace_id` and `dd.span_id` on a request log. Use Datadog's related-trace
link, or search the trace ID in APM. If the log has the nested trace attribute:

```text
service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) @dd.trace_id:"TRACE-ID"
```

Use the field actually present if the log pipeline remaps it. Neither missing IDs
nor an empty span search proves that tracing is disabled: context, sampling,
retention, and index selection affect availability. APM request metrics do not
guarantee an individually searchable trace. The app does not currently attach its
correlation ID as a custom trace tag or create a dedicated SOPS span; use log
correlation as the fallback, and do not claim end-to-end tracing from logs alone.

## 7. AI agent query procedure

1. Capture the UTC interval, correlation ID, hosting environment/namespace, app,
   repository target, and submission mode. If unknown, begin with both namespaces
   in a small window; expand time deliberately, not indefinitely.
2. Discover the available Datadog tools before invoking them. For the current MCP
   integration use `datadogexample-get_logs`; start with a small limit and oldest-first
   sorting. Do not invoke mutating tools or run synthetic submissions during triage.
3. Example request (replace the timestamps and request ID):

   ```json
   {
     "query": "service:self-service-infra (kube_namespace:self-service OR kube_namespace:self-service-test) (@correlation_id:\"REQUEST-CORRELATION-ID\" OR *:\"REQUEST-CORRELATION-ID\")",
     "from_time": "2026-10-15T15:45:00Z",
     "to_time": "2026-10-15T16:00:00Z",
     "limit": 20,
     "max_total_logs": 20,
     "sort": "timestamp"
   }
   ```

4. Read structured fields from `custom_attributes` and infrastructure tags from
   `tags` in this tool's response. Other clients may expose them under
   `attributes.attributes`; inspect the returned shape before interpreting absent
   fields. Keep only the safe diagnostic fields listed above in notes.
5. Check `has_more` and the returned cursor. Retrieve another bounded page only if
   needed, using the tool's actual cursor format and the same query/time window.
   If no usable cursor is exposed, narrow the window; do not invent a cursor.
6. If output is offloaded to a local file, inspect only relevant bounded records;
   do not dump the complete file. Do not copy entire logs into a report.
7. Report tool errors, permission/index/retention limitations, and truncation
   separately from empty results. If Datadog access is unavailable, hand the exact
   query and UTC window to a human; do not claim the query ran.
8. Stop when the evidence supports a category and the next safe check. A SOPS exit
   code is not proof of a Key Vault permission problem. Use the linked encryption
   runbook rather than repeatedly retrying a failed secret submission.

## Evidence handoff and alerting

Report:

- Exact scoped query, UTC interval, indexes if explicitly selected, and pagination
  completeness.
- Correlation ID, operation, outcome, HTTP status, and safe failure category/code.
- Hosting environment versus requested environment/target; affected image
  tag/digest and configured version, when available.
- Observed evidence, hypothesis, next safe check, and verification still required.

For alerting, the structured encryption-failure query above is suitable for a log
count monitor (for example, more than zero events in five minutes, grouped by
hosting environment). Configure approved recipients and severity separately.
Submission partial failures and cleanup warnings merit separate policies.
**Queries and dashboard threshold lines do not create monitors or notifications.**
This runbook does not provision monitors.
