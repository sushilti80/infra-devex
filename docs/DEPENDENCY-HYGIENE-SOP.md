# Dependency Hygiene SOP

> **Purpose**: Prevent CI pipeline breakages from lock-file desync, deprecated runtimes, and unpatched vulnerabilities. Every dependency change must pass automated validation before merge.

## TL;DR — Prevention Gates

| Gate | Where | What it blocks | When |
|------|-------|----------------|------|
| Lock-file sync | `dependency-audit` CI job | `npm ci` mismatch | Every PR & push |
| npm audit (prod) | `dependency-audit` CI job | Critical/high CVEs in prod deps | Every PR & push |
| Deprecated packages | `dependency-audit` CI job | Deprecated dep tree entries | Every PR & push |
| Node runtime check | `dependency-audit` CI job | Deprecated Node versions (18, 20) | Every PR & push |
| Dependabot PRs | Weekly (Monday) | Drift from upstream updates | Weekly |
| QA acceptance tests | `npm test` (Vitest) | Runtime regressions from dep changes | Every PR & push |

---

## 1. The Golden Rule

> **Never edit a version in `package.json` without regenerating `package-lock.json`.**

CI uses `npm ci --legacy-peer-deps`, which requires **exact** sync between the two files. A mismatch causes `npm ci` to fail, blocking all builds.

### How to update a dependency correctly

```bash
# 1. Update package.json (or use npm install which does both)
npm install <package>@<version> --legacy-peer-deps

# OR manually edit package.json, then sync the lock file:
npm install --package-lock-only --legacy-peer-deps

# 2. Validate the sync locally
npm run deps:check

# 3. Run tests to confirm nothing broke
npm test
npm run test:smoke
npm run test:integration

# 4. Run a full audit
npm run deps:audit

# 5. Commit both files together
git add package.json package-lock.json
git commit -m "deps: update <package> to <version>"
```

### Available npm scripts

| Script | Purpose | Blocking? |
|--------|---------|-----------|
| `npm run deps:check` | Run all 4 hygiene checks (lock sync, audit, deprecated, runtime) | ✅ CI gate |
| `npm run deps:check:json` | Same, but JSON output for CI parsing | ✅ CI gate |
| `npm run deps:audit` | `npm audit --omit=dev` (production deps only) | Informational |
| `npm run deps:audit:fix` | Auto-fix vulnerabilities within semver range | Manual |
| `npm run deps:outdated` | `npm outdated` — check for newer versions | Manual |
| `npm run deps:sync` | Regenerate lock file from package.json | Fix tool |

---

## 2. Automated Dependency Updates (Dependabot)

Configuration: [`.github/dependabot.yml`](../.github/dependabot.yml)

### Update cadence

| Ecosystem | Schedule | Grouping | PR limit |
|-----------|----------|----------|----------|
| npm (production) | Weekly Monday 08:00 CET | All patch+minor in 1 PR | 10 |
| npm (development) | Weekly Monday 08:00 CET | All patch+minor in 1 PR | (shared limit) |
| npm (major versions) | Weekly Monday 08:00 CET | Each major update = separate PR | (shared limit) |
| Agent Governance reusable workflow | Weekly Monday 08:00 CET | Dedicated governance PR | 5 (shared) |
| Other GitHub Actions | Weekly Monday 08:00 CET | Grouped in 1 PR | 5 (shared) |
| Docker base images | Weekly Monday 08:00 CET | All in 1 PR | 3 |

### Dependabot PR handling SOP

1. **Dependabot opens a PR** — triggers the full CI pipeline including the `dependency-audit` gate.
2. **CI runs**:
   - `dependency-audit` job validates lock-file sync (Dependabot always updates both files, so this passes automatically).
   - `npm audit` confirms no new critical/high vulnerabilities introduced.
   - `npm test` (Vitest) runs all component/composable/store specs.
   - `npm run test:smoke` and `test:integration` run backend tests.
3. **If CI is green** — review the diff, check the changelog for breaking changes, then `Squash & Merge`.
4. **If CI is red** — do not merge. Either:
   - Fix the issue (e.g., migration needed for a major version) and push the fix, or
   - Close the PR and coordinate a manual update.
5. **Major version updates** — always require manual review. Check the upgrade guide, test locally with `npm run dev && npm run dev:client`, and confirm all E2E scenarios.

---

## 3. CI Pipeline: Dependency Hygiene Gate

Location: [`.github/workflows/qa-pipeline.yml`](../.github/workflows/qa-pipeline.yml) → `dependency-audit` job

### Pipeline order

```
dependency-audit (gate)
    ├── lock file sync check
    ├── Node runtime version check
    ├── npm audit (critical+high = fail)
    └── deprecated packages check
        │
        ▼ (if gate passes)
    smoke-tests → unit-tests → integration-tests
        │
        ▼ (if all pass)
    test-summary (aggregates all results)
        │
        ▼ (if summary passes)
    build-and-push (Docker image)
```

### What the gate checks

#### 3.1 Lock file sync (`npm ci --dry-run`)

Runs `npm ci --dry-run --legacy-peer-deps` which validates that `package-lock.json` is in sync with `package.json` **without installing anything** (fast, ~3s). If out of sync, the job fails and prints:

```
❌ [deps-check] lock-sync: lock file out of sync — run 'npm install --package-lock-only --legacy-peer-deps' and commit the result
```

#### 3.2 Node runtime version

Checks `Dockerfile`, all `.github/workflows/*.yml` `NODE_VERSION` env vars, and `package.json` `@types/node` for deprecated Node versions (18, 20). Minimum supported version: 22.

#### 3.3 npm audit (production dependencies only)

Runs `npm audit --omit=dev --json` and checks vulnerability counts. **Blocking severities**: `critical` and `high`. Non-blocking: `moderate` and `low` (warnings only).

To override blocking severities for a specific run:
```yaml
env:
  AUDIT_SEVERITY: "critical"  # only block critical, allow high
  # or: AUDIT_SEVERITY: "" to skip audit entirely
```

#### 3.4 Deprecated packages

Scans the installed `node_modules` tree for packages marked `deprecated` in their metadata. More than 5 deprecated packages = blocking. Fewer = warning.

---

## 4. Vulnerability Response Procedure

### 4.1 Daily / Automatic

- **Dependabot** opens PRs for vulnerable dependencies when advisories are published.
- **CI `dependency-audit` gate** blocks any PR that introduces new critical/high vulnerabilities.

### 4.2 Manual triage

```bash
# Check current vulnerability state
npm run deps:audit

# See full details (all severities including dev)
npm audit --legacy-peer-deps

# Auto-fix safe (within-range) vulnerabilities
npm run deps:audit:fix

# If audit fix doesn't resolve, use overrides in package.json
# (existing pattern: "overrides": { "qs": "^6.14.2" })
```

### 4.3 Severity response SLAs

| Severity | Response time | Action |
|----------|---------------|--------|
| Critical | 24 hours | Patch or override immediately; hotfix PR |
| High | 3 days | Patch in next PR; Dependabot PR if available |
| Moderate | 1 sprint | Monitor; patch during routine updates |
| Low | Next release | Track; no immediate action needed |

### 4.4 Overriding a vulnerability

If a vulnerability is a false positive or cannot be patched without a breaking change:

1. Use `overrides` in `package.json` to force a safe version:
   ```json
   "overrides": {
     "vulnerable-package": "^1.2.3"
   }
   ```
2. Regenerate the lock file: `npm run deps:sync`
3. Document the override in the PR description with the advisory URL and rationale.
4. Set a reminder to remove the override when upstream fixes the issue.

---

## 5. QA / Testing Integration

### 5.1 When to run tests after a dependency change

```bash
# After ANY dependency change (even a patch):
npm ci --legacy-peer-deps          # Reinstall with new lock file
npm run type-check                 # TypeScript compilation check
npm test                           # Vue component/composable/store specs (jsdom)
npm run test:smoke                 # Smoke tests (Express server + health check)
npm run test:integration           # API contract tests
```

### 5.2 What QA should verify on Dependabot PRs

| Dependency type | Risk areas to test | QA approach |
|----------------|-------------------|------------|
| Express / body-parser | All API endpoints, request parsing | Run integration tests; manually test POST/PUT with complex bodies |
| @octokit/rest | GitHub API calls (provision, delete, metadata) | Run smoke tests; verify PR creation in test repo |
| Vue / Pinia / Vite | All pages render, navigation works, state management | `npm run dev:client` and manually verify each page |
| dd-trace | Datadog APM initialization, no startup crash | Start server; check `/health`; check Datadog dashboard |
| sops (in Docker) | Secrets service encryption/decryption | Test in sand environment |
| @azure/* | Azure SDK calls (MSI, Key Vault, etc.) | Run in sand environment |
| Test deps (vitest, playwright) | All tests still pass | Full `npm test` + `npm run test:e2e` |

### 5.3 E2E validation for major version updates

For major version bumps (e.g., Vue 3 → 4, Vite 7 → 8):

1. **Local validation**:
   ```bash
   npm run dev && npm run dev:client  # HMR works, all pages render
   npm run build:client               # Production build succeeds
   npm test                           # All Vitest specs pass
   npm run test:e2e                   # Playwright E2E passes
   ```
2. **Sand deployment validation**: Deploy to sand and run the full E2E suite against `https://self-service.example.com/`.
3. **Manual smoke test** in sand: provision infrastructure, check installed-apps, verify AKS deploy flow.

---

## 6. SRE / DevOps Responsibilities

### 6.1 CI pipeline hardening

- **Maintain** the `dependency-audit` gate in `qa-pipeline.yml` — never bypass it.
- **Monitor** CI failure rate on the gate; if it's >5% of PRs, investigate root cause (likely someone editing `package.json` without syncing the lock file).
- **Review** Dependabot PRs within 48 hours to prevent vulnerability backlog.

### 6.2 Docker image security

- The existing **Trivy image scan** step in `build-and-push` already scans the built Docker image.
- Combine with the `dependency-audit` gate (scans npm dependencies **before** the build) for defense-in-depth:
  - **Pre-build**: npm dependencies (CI gate)
  - **Post-build**: container image layers (Trivy)

### 6.3 Override review (quarterly)

Review `package.json` `overrides` section quarterly to ensure:
- Each override is still needed (upstream may have fixed the issue).
- No override is hiding a new vulnerability.
- Documented rationale exists for each override.

---

## 7. Lock File Sync — Deep Dive

### Why this is the #1 CI breaker

`npm ci` (the CI install command) is a **strict, cold install** that:
1. Deletes `node_modules/`.
2. installs exactly what's in `package-lock.json`.
3. Fails if `package.json` and `package-lock.json` disagree.

This is by design — it guarantees reproducible builds. But it means **any** version change in `package.json` without a lock file update triggers a hard failure.

### Common breakage scenarios

| Scenario | Cause | Fix |
|----------|-------|-----|
| Edit `package.json` version manually | Developer changes `^1.2.3` to `^1.3.0` in the JSON | `npm run deps:sync` |
| Merge conflict in `package.json` | Git auto-merge picks one side's version | `npm install --package-lock-only --legacy-peer-deps` |
| Dependabot PR partially merged | Lock file not included in the merge | Rebase and include lock file changes |
| Branch switch without clean | Stale lock file from another branch | `git checkout -- package-lock.json && npm run deps:sync` |

### Prevention

The `dependency-audit` CI gate catches all of these in ~3 seconds. **Always run `npm run deps:check` locally before pushing** if you touched `package.json`.

---

## 8. Deprecated Packages Policy

### What deprecation means

A deprecated npm package is one whose maintainer has flagged it as:
- No longer maintained (no security patches)
- Replaced by a newer package
- Abandoned

**Deprecated packages are a security risk** — they won't receive CVE patches even if vulnerabilities are found.

### Current policy

1. **CI gate** blocks merges with >5 deprecated packages in the installed tree.
2. **Warnings** are shown for 1-5 deprecated packages.
3. **Action required** for any deprecated package that is a production dependency:
   - Search for a maintained alternative on npmjs.com.
   - Create a PR to replace it.
   - Run full test suite to confirm compatibility.

### Known acceptable deprecations

Some packages are deprecated but have no viable alternative (e.g., a sub-dependency of a critical package). In this case:
1. Document the deprecation in this SOP (add to the list below).
2. Track for upstream resolution.
3. No action required unless a vulnerability is also present.

| Package | Reason deprecated | Acceptable? | Tracking |
|---------|-------------------|-------------|----------|
| _(none currently)_ | | | |

---

## 9. Responsibility Matrix

| Role | Daily | Weekly | Monthly | Quarterly |
|------|-------|--------|---------|-----------|
| **Developer** | Run `npm run deps:check` before pushing if you touched deps | Review & merge Dependabot PRs | Check `npm outdated` for major version upgrades | |
| **QA Engineer** | | Verify Dependabot PRs pass full test suite | Run E2E against sand after major dep updates | Audit test coverage for deprecated packages |
| **SRE/DevOps** | | Monitor CI gate failure rate | Review `overrides` section | Audit security posture; review deprecation list |
| **Release Manager** | | Include dep changes in changelog | | Quarterly dependency health report |

---

## 10. Escalation

| Issue | Escalate to | Channel |
|-------|-------------|---------|
| Critical CVE in production dep | SRE + Developer | Create hotfix PR immediately |
| CI gate consistently failing | SRE/DevOps | Investigate runner health or lock file conflicts |
| Dependabot PR backlog > 10 | Team lead | Triage in weekly standup |
| Deprecated package with no alternative | Architect | Decision needed on replacement or acceptance |

---

## Appendix A: `deps-check.sh` reference

Location: [`scripts/deps-check.sh`](../scripts/deps-check.sh)

```
Usage:
  ./scripts/deps-check.sh                  # full check (all 4)
  ./scripts/deps-check.sh --no-audit       # skip audit (for dev-only / offline)
  ./scripts/deps-check.sh --json           # machine-readable output for CI summaries
  ./scripts/deps-check.sh --help           # show help

Environment:
  AUDIT_SEVERITY   comma-separated list to block (default: "critical,high")
                   set to "" to skip audit entirely
  ALLOW_NETWORK    if "1", allows npm registry access for audit

Checks (in order, fastest first):
  1. lock-sync     — package.json and package-lock.json are in sync
  2. node-runtime  — Dockerfile + workflow NODE_VERSION not deprecated
  3. audit         — zero critical/high vulnerabilities in production deps
  4. deprecated    — no deprecated packages in the installed tree

Exit codes:
  0 — all checks passed
  1 — one or more blocking checks failed
```

## Appendix B: Dependabot configuration reference

Location: [`.github/dependabot.yml`](../.github/dependabot.yml)

- npm updates grouped: production (patch+minor), development (patch+minor), major (individual)
- Agent Governance reusable workflow: weekly, isolated in its own Dependabot PR
- Other GitHub Actions: weekly, grouped
- Docker: weekly, grouped
- `@types/node` patch updates ignored (too noisy; major version managed manually per Node upgrade)
- PR labels: `dependencies`, `automated` for triage
- Commit prefix: `deps` for npm, `ci` for actions, `docker` for Docker
