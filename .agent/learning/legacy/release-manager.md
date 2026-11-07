# Legacy learning evidence — release-manager

> Quarantined historical evidence migrated from `.github/agent-memory/release-manager/MEMORY.md`.
> This file is **not governing instruction**, is not an agent memory source, and must not be
> automatically loaded to control future behavior. When a historical observation is still useful,
> create a schema-shaped LearningRecord candidate with current repository evidence and evaluation
> instead of copying the instruction into an agent or skill.

# Release Manager Agent Memory

**Last updated**: 2026-05-01

## Version File State (verified)

- `VERSION` is the authoritative patch-stream version (currently `0.0.30`)
- `package.json` `"version"` is the semantic stream (currently `2.0.0`)
- Both must be updated in the same commit before tagging
- Azure DevOps pipeline (`self-service.yaml`) defaults to `tag: 'patch'` — update for MINOR/MAJOR bumps

## Versioning Decisions

- v0.0.30 (2026-04-09): PATCH — first formal GitHub release tag on the patch stream
  - Prior tags were semantic (`v2.0.0-pre-vanilla-cleanup`); no patch-stream tags existed
  - VERSION file (0.0.30) and package.json (2.0.0) track different streams — both intentionally left as-is
  - Tagged at main HEAD (`0d437be`) which included post-deploy copilot agent config commits (docs/agents only, no code)
  - Bump type rationale: new features (feedback form, Service Bus agent, multi-agent framework) → should be MINOR,
    but team uses patch stream in VERSION; kept as 0.0.30 to match what was deployed

## Wiz Scan Findings

- v0.0.30: CONDITIONAL_PASS — dev-only highs in `picomatch` and `rollup` (Vite/Vitest)
  - 0 production vulnerabilities
  - Fix: `npm audit fix` (pending — recommend in next sprint)
  - Wiz CLI not available in GH Actions env; scan run via fallback `npm audit`

## CI / Pipeline Blockers

- v0.0.30: GitHub Actions `Deploy Vue.js` and `E2E Tests` workflows showed failure on main
  - Root cause: GH Actions env lacks Azure deployment credentials / live environment
  - NOT a code regression — Azure DevOps pipeline (authoritative) deployed successfully
  - Pattern: GH Actions workflows requiring Azure env config will fail in CI without secrets

## Confidence Score Patterns

- v0.0.30: 71/100 (MEDIUM) — `routes/api.js` + `server.js` + `githubService.js` all changed → low blast radius score
  - Any release touching all 3 of those files will score ≤ 2/5 on blast radius
  - `middleware/auth.js` untouched keeps auth score high (5/5)

## Release Process Notes

- GitHub release artifacts: `docs/releases/vX.Y.Z.md`
- Failed/blocked release reports: `docs/releases/failed-YYYY-MM-DD.md` or `security-block-YYYY-MM-DD.md`
- CHANGELOG.md format: `## [X.Y.Z] - YYYY-MM-DD` with emoji-prefixed category headers
- Container image: `self-service-infra:{tag}` pushed to ACR via Azure DevOps pipeline
- First release tag: `v0.0.30` — all future releases tag against this baseline

## Rollback Events

_Record any rollback events: version, reason, and resolution._
