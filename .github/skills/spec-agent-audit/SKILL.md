---
name: spec-agent-audit
description: >-
  Read-only audit of agent definition files for alignment with this
  self-service infrastructure repository, factual accuracy, concise guidance,
  safe delegation, memory hygiene, and cross-agent contradictions. Use when
  auditing agents, agent prompts, role boundaries, pipeline contracts, or
  continuous agent quality.
argument-hint: "[agent path or batch] [Audit round: 1|2]"
---

# Spec agent audit

Read-only meta-audit of agent definitions under `.github/agents/*.agent.md`.
The files under review are the artifacts. Do not edit them, their memories, or
production code while auditing. Report findings only unless the caller supplies
an explicit, separate report path.

## Epistemic stance

- Audit on-disk files and current repository sources, not chat claims or an
  agent's self-description.
- Disk wins when memory, documentation, and chat disagree. Record the source
  of a factual correction.
- Treat examples and commands in an agent file as claims that need checking;
  do not assume they are illustrative when they describe project behavior.

## Scope and anti-loop

- Audit one agent or a batch. Every audit request must include `round: 1` or
  `round: 2`.
- Round 1 runs the full checklist below.
- Round 2 is delta-only: re-check open Blocking and Advisory findings from
  Round 1 plus regressions introduced by fixes.
- Never run a Round 3 automatically. Escalate unresolved issues to a human.

## Operating cadence

- Run Round 1 after an agent definition or governing skill changes, and at the
   start of a new delivery pipeline when agent drift would be costly.
- Batch-audit all agents at a release or pipeline-governance checkpoint; audit
   a single agent when its role or prompt changes.
- Run Round 2 only after the owner has revised the audited file. Treat the
   file as unaudited again after any later change.
- This skill is on-demand. It does not create a background watcher; an
   Orchestrator or human must invoke it at the cadence above.

## Governing sources

Read the sources that apply to the target before judging it:

- `.github/copilot-instructions.md` and `CLAUDE.md` for platform architecture
  and repository rules.
- `.github/skills/agent-memory/SKILL.md` for operational state and the propose-only learning firewall.
- `.github/skills/artifact-paths/SKILL.md` for pipeline artifact ownership.
- `.github/skills/graphify-context/SKILL.md`, then `graphify query "..."` before
  a broad relationship search.
- The exact source files needed to verify claims: `routes/api.js`,
  `services/`, `middleware/`, `srcV2/`, `data/`, `Dockerfile`, `package.json`,
  pipeline files, and relevant documentation or tests.
- If a source is absent, mark the dependent check unverifiable. Do not invent
  a replacement source.

## Checklist A: Agent contract, state, and governed learning

For each target agent, verify:

1. Frontmatter `name` and `description` are present, meaningful, and aligned
   with the body. The description's trigger words describe the actual role.
2. The role has a clear scope boundary and does not quietly claim another
   agent's artifact or authority.
3. The body activates `.github/skills/agent-memory/SKILL.md` when the role
   participates in shared pipeline state or runtime learning.
4. Operational state uses `.agent/state/project-state.md` and contains current
   facts/artifact pointers rather than reusable behavioral instructions.
5. The agent does not depend on private `.github/agent-memory/**` behavior or
   routinely load quarantined `.agent/learning/legacy/**` content.
6. Reusable runtime discoveries are propose-only LearningRecord candidates under
   `.agent/learning/candidates/`; the discovering run does not self-promote
   them into an agent, skill, repository policy, or global governance.
7. State and learning instructions never store secrets, tokens, private keys,
   connection strings, generated plans, plaintext secret values, sensitive logs,
   or user data.

## Checklist B: Project alignment and factual accuracy

Cross-check every material project claim against current code or a governing
document. In particular, verify that the agent preserves:

1. Vue 3 in `srcV2/` as the active frontend; do not direct new work to the
   removed legacy `public/` frontend.
2. GitHub as the metadata source of truth; no invented database or session
   persistence.
3. Correct separation of the Infrastructure GitHub App and Code Deployment
   GitHub App. A workflow or repository operation must name the correct client.
4. Correlation ID propagation through requests, logs, GitHub workflow/PR
   context, responses, and status polling where the operation is asynchronous.
5. Express validation, auth middleware, Winston logging, standard API response
   shape, and the existing status/polling endpoints when the role touches them.
6. Runtime environment flags and data catalogs from `data/`, rather than
   hardcoded environment, module, or agent lists.
7. Artifact paths and ownership from `artifact-paths/SKILL.md`; no invented
   alternate filenames or completion signals.
8. Actual npm scripts, route names, component paths, service signatures,
   workflow files, and Docker build behavior. Flag stale examples, guessed
   paths, impossible commands, and claims unsupported by the repository.

When a claim depends on external Azure, GitHub, or pipeline state, require an
explicit verification method and label the claim as an assumption until it is
verified. Do not treat an approved spec or another agent's report as proof that
implementation or deployment exists.

## Checklist C: Safety and evidence

1. Read-only roles forbid edits to their review input and production code.
   Mutation-capable roles state exactly what they may change.
2. Deployment, release, merge, push, and versioning authority is role-specific,
   gated, and consistent with the Orchestrator and Release Manager contracts.
   No role may silently self-approve a human gate or bypass the Wiz, test, auth,
   or deployment checks that govern it.
3. Agents do not commit secrets, log sensitive values, expose stack traces, or
   recommend disabling auth, validation, security scans, or correlation IDs to
   make a check pass.
4. Generated or pipeline-owned files are changed only by their documented
   owner. Agent instructions must not fabricate readiness, QA, Wiz, or release
   evidence when the implementation or scan target is missing.
5. Tests and completion signals are executable and scoped to the role. Claims
   such as "all tests pass" require the named command, result artifact, and
   relevant failure handling.

## Checklist D: Cross-agent boundaries and contradictions

Across the audited batch, verify:

1. Ownership is non-overlapping: Debugger owns bug diagnosis and explicitly scoped non-frontend
   application fixes; PM owns PRDs; challengers own reviews;
   Architect owns architecture specs; Vue Developer owns frontend
   feature and bug-fix implementation; QA owns feature and bug tests/results; SRE DevOps owns observability,
   Docker, and security gates; Orchestrator owns sequencing/readiness; Release
   Manager owns release ceremony.
2. Delegation references point to real `.github/agents/*.agent.md` files and
   the receiving role actually covers the delegated work.
3. All pipeline agents use compatible round limits, input contracts, artifact
   paths, verdict names, memory rules, and evidence expectations.
4. No role claims authority over the same API, UI, test, security, or release
   artifact as another role without an explicit handoff.
5. Examples do not contradict governing code, such as wrong auth status,
   polling path, environment behavior, GitHub client, metadata shape, or
   version convention.

## Checklist E: Concision and maintainability

Flag only material prompt cost or ambiguity:

1. Duplicate rules, repeated architecture background, dead sections, and
   generic framework tutorials that do not guide this role.
2. Placeholder code, invented APIs, speculative abstractions, and examples
   longer than needed to establish the local pattern.
3. Instructions that can be expressed once by linking to a governing skill or
   artifact contract.
4. Contradictory wording, vague verbs, undefined terms, and requirements that
   cannot produce a deterministic pass/fail result.

Suggest the smallest deletion or consolidation. Do not rewrite the agent file
as part of the audit.

## Severity

| Severity | Use for |
| --- | --- |
| Blocking | Unsafe mutation/deployment, secret handling, missing role boundary, missing required memory or artifact contract, or a factual contradiction likely to cause incorrect production work. |
| Advisory | Stale or unverifiable project claim, weak evidence, cross-agent drift, missing delegation detail, or material duplication. |
| Nit | Wording, formatting, or low-impact repetition that does not change behavior. |

Do not inflate Nits into Blocking. Do not approve agent files; report the audit
result and leave the decision to the human owner.

## Procedure

1. Resolve the requested path or batch against `.github/agents/*.agent.md`.
2. Read the applicable governing sources and the exact target files. Use the
   graph first for broad relationship questions, then verify claims in source.
3. Run all applicable checks for Round 1. For Round 2, inspect only the prior
   open Blocking/Advisory findings and regressions introduced by revisions.
4. Cite each finding with target path and line number, governing source path
   and line number where relevant, observed evidence, and a concise remediation
   hint.
5. Return the self-contained report below. If no issues are found, state the
   remaining unverifiable checks and residual risk.

## Report format

```markdown
## Agent audit: [agent-id | batch]
**Round:** 1 | 2
**Files reviewed:** [paths]
**Governing sources:** [paths]
**Unavailable sources:** [list, or none]

### Findings
1. **ID:** A1 | **Severity:** Blocking|Advisory|Nit | **Where:** path:line
   - Issue and observed evidence
   - Governing source: path:line
   - Remediation hint: smallest useful correction

### Per-agent summary
- <agent-id>: pass | findings [IDs]

### Gate
- **audit_passed:** yes | no
- **Blocking open:** [IDs]
- **Advisory open:** [IDs]
- **Recommend:** human-fix | proceed
```

The audit is complete when the report is emitted. It must not edit agent
definitions, memories, specifications, production code, or pipeline files.
