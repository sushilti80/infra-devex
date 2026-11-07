---
name: wiz-security-scan
description: "Run Wiz CLI security scans for source code directories and Docker images, including sand-environment build-and-scan workflows. Use when: wiz cli scan, code security scan, container image scan, Docker image vulnerability scan, SAST, IaC scan, software composition analysis, CI preflight security gate, scan build artifacts in sand."
argument-hint: "Target path/image, environment (sand/dev/etc), and whether to run code, image, or build+image scan"
user-invocable: true
---

# Wiz Security Scan Workflow

## Outcome
Produce a repeatable security assessment using Wiz CLI for:
- Source code directories
- Existing Docker images
- Images built locally (especially in sand environment)

## When To Use
- You need a security baseline before merge or deployment.
- You need to scan application code and IaC in a repository path.
- You need to scan a Docker image tag before pushing/deploying.
- You need to build in sand and scan the resulting image artifact.

## Inputs To Confirm
- `scanMode`: `code`, `image`, or `build-and-image`
- `targetPath`: repository or subdirectory path for code scan
- `imageRef`: image name/tag for image scan (example: `myapp:sand-20260331`)
- `environment`: `sand` by default unless user specifies another
- `severityGate`: minimum blocking severity (`critical` default)
- `authMode`: interactive session or environment-based auth (`WIZ_CLIENT_ID` + `WIZ_CLIENT_SECRET`)

## Decision Logic
1. If `scanMode=code`, run only code directory scanning.
2. If `scanMode=image`, run only image scanning for `imageRef`.
3. If `scanMode=build-and-image`, build first (sand profile/tags), then scan built image.
4. If no mode provided:
- Prefer `code` for source-only requests.
- Prefer `image` when an image tag is provided.
- Prefer `build-and-image` when user asks to scan a build artifact.

## Preflight Checks
1. Verify Wiz CLI is installed and available.
2. Verify authentication/session is valid.
3. For non-interactive runs, verify `WIZ_CLIENT_ID` and `WIZ_CLIENT_SECRET` are set in environment.
4. Verify target path/image exists.
5. Verify Docker/Podman engine is available for image/build scans.
6. For sand flow, ensure tags clearly identify sand artifacts (for example `:sand-<date>`).

## Procedure
1. Gather scan intent and map to one of the modes.
2. Run preflight checks and fail fast with actionable guidance if missing dependencies.
3. Execute selected scan mode.
4. Capture machine-readable output if supported by installed Wiz CLI version.
5. Summarize findings grouped by severity and category.
6. Apply severity gate and return explicit PASS/FAIL status.
7. Provide remediation actions for top findings.

## Command Patterns
Use the installed Wiz CLI help to confirm exact flag names for the local version before running commands.

### 1) Code Scan
```bash
wiz --help
wiz scan --help
wiz scan code --path <targetPath>
```

### 2) Image Scan (Existing Image)
```bash
wiz scan image --image <imageRef>
```

### 3) Build and Scan (Sand)
```bash
# Example build in sand context
export APP_ENV=sand
IMAGE_TAG="<app>:sand-$(date +%Y%m%d%H%M)"
docker build -t "$IMAGE_TAG" .

# Scan built image
wiz scan image --image "$IMAGE_TAG"
```

## Completion Criteria
A run is complete when all of the following are delivered:
1. Scan target(s) and mode used
2. Environment used (`sand` or user-specified)
3. Findings summary by severity (`critical/high/medium/low`)
4. Gate decision (`PASS` or `FAIL`) with threshold used
5. Top remediation recommendations
6. Note of any skipped scans with reason

## Quality Bar
- Commands are validated against local CLI help when flags are uncertain.
- Results are reproducible (explicit target path, image tag, environment).
- Summary is concise and decision-ready for PR reviewers/release owners.
- No credentials or secrets are printed in logs/output.
- Environment auth variables are checked before scan execution in CI/agent contexts.

## Failure Handling
- Wiz CLI missing: provide install steps or fallback to existing security tooling in repo.
- Auth failure: stop and request re-authentication, or set `WIZ_CLIENT_ID` and `WIZ_CLIENT_SECRET` for non-interactive runs.
- Build failure: report build error and skip image scan.
- Unsupported command flags: re-check `wiz --help` and retry with supported syntax.

## Output Template
Use this structure in responses:

```text
Wiz Security Scan Report
- Mode: <code|image|build-and-image>
- Environment: <sand|...>
- Targets: <path/image>
- Severity Gate: <critical|high|...>

Findings
- Critical: <n>
- High: <n>
- Medium: <n>
- Low: <n>

Decision
- Status: <PASS|FAIL>
- Reason: <why>

Top Remediations
1. <action>
2. <action>
3. <action>
```

## Notes
- Prefer scanning both code and image for release-critical changes.
- For sand builds, use unique tags to avoid scanning stale local images.
- If the user asks for CI integration, convert this procedure into a workflow job with the same gate semantics.
- Use `WIZ_CLIENT_SECRET` (singular). `WIZ_CLIENT_SECRETS` is not the standard variable name.
