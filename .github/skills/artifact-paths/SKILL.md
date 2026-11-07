---
name: artifact-paths
description: Canonical file-path convention for every artifact produced across feature delivery and bug resolution (diagnosis, PRD, reviews, architecture spec, dev status, QA results, Wiz report, readiness report, release summary). Read before writing or looking up pipeline artifacts.
---

# Pipeline Artifact Path Convention

Single source of truth for where every agent in the feature delivery and bug-resolution pipelines reads
and writes its artifacts. All agents (Debugger, PM, PRD Challenger, Architect, Architecture Challenger,
Vue.js Dev, QA Engineer, SRE DevOps, Release Manager, Orchestrator) must use these exact paths — do not invent alternate
locations or filenames.

`{feature_name}` is always the lowercase-hyphenated slug for the feature (e.g. `bulk-decommission`),
established by the PM Agent when it first authors the PRD.

`{bug_id}` is a lowercase-hyphenated ticket ID or concise symptom slug established by SelfService
Debugger (e.g. `bug-142-status-polling-timeout`).

## Path Table

| Artifact | Path | Written By | Read By |
|---|---|---|---|
| Bug diagnosis and resolution | `docs/debug/{bug_id}-diagnosis.md` | SelfService Debugger | Vue.js Developer, QA Engineer, Product Manager |
| Bug developer status | `docs/readiness/{bug_id}-dev-status.json` | Vue.js Developer | SelfService Debugger |
| Bug QA results | `tests/results/{bug_id}-results.json` | QA Engineer | SelfService Debugger, Vue.js Developer |
| PRD | `docs/prd/{feature_name}.md` | Product Manager | PRD Challenger, Architect, Orchestrator |
| PRD Challenger review | `docs/reviews/{feature_name}-prd-review-round{N}.md` | PRD Challenger | Product Manager, Orchestrator |
| Architecture spec (JSON) | `docs/architecture/{feature_name}-spec.json` | Architect | Architecture Challenger, Vue.js Dev, QA Engineer, SRE DevOps, Orchestrator |
| Architecture spec (MD) | `docs/architecture/{feature_name}-spec.md` | Architect | Architecture Challenger, Vue.js Dev, QA Engineer, SRE DevOps, Orchestrator |
| Architecture Challenger review | `docs/reviews/{feature_name}-arch-review-round{N}.md` | Architecture Challenger | Architect, Orchestrator |
| Architecture deep-dive doc (conditional — new pattern only) | `docs/architecture/{feature_name}-architecture.md` | Architect | All |
| ADR (conditional — significant decision only) | `docs/adr/{YYYYMMDD}-{decision}.md` | Architect | All |
| Dev status | `docs/readiness/{feature_name}-dev-status.json` | Vue.js Developer | Orchestrator |
| QA results | `tests/results/{feature_name}-results.json` | QA Engineer | Orchestrator |
| Wiz security report | `docs/security/wiz-{feature_name}-report.json` | SRE DevOps | Orchestrator, Release Manager |
| Readiness report | `docs/readiness/{feature_name}-readiness.md` | Orchestrator | Release Manager |
| Release summary | `docs/releases/vX.Y.Z.md` | Release Manager | — |

## Folder Purpose (why these are separated)

- `docs/debug/` — SelfService Debugger diagnoses and final bug-resolution evidence only.
- `docs/prd/` — Product requirement documents only. Nothing else lives here.
- `docs/architecture/` — Architect-agent output only: spec.json/spec.md contracts plus any conditional
  architecture deep-dive docs. ADRs are a separate `docs/adr/` folder, not nested here.
- `docs/reviews/` — Adversarial review rounds only: PRD Challenger (`*-prd-review-round{N}.md`) and
  Architecture Challenger (`*-arch-review-round{N}.md`).
- `docs/readiness/` — Feature and bug dev-status signals plus the final Orchestrator readiness report.
- `docs/security/` — Wiz scan reports only.
- `docs/releases/` — Release Manager changelog/summary output, plus blocked/failed release reports.
- `tests/results/` — QA Engineer's machine-readable feature and bug test results (kept outside `docs/`
  since it's a build/test artifact, not documentation).

Do not write a PRD, spec, review, or report directly into `docs/` root — always use the subfolder above.
If a target subfolder does not exist yet, create it before writing.

## Legacy Paths (pre-reorg — do not use)

These paths are deprecated. If you see references to them in old context or memory, treat them as
stale and use the table above instead:
- ~~`docs/PRD-{feature_name}.md`~~ → `docs/prd/{feature_name}.md`
- ~~`docs/specs/{feature_name}-spec.json` / `.md`~~ → `docs/architecture/{feature_name}-spec.json` / `.md`
