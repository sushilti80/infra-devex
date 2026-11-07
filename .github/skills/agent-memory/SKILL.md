---
name: agent-memory
description: Manage shared operational state and propose-only LearningRecord candidates without private self-modifying agent memory. Use when an agent needs current pipeline state or needs to capture a reusable runtime discovery for later governed review.
---

# Agent State and Governed Learning

This skill separates **current operational state** from **candidate learning**.

- Operational state answers: what is in flight, what phase/gate is current, what artifact exists, what is blocked, and what happens next.
- Candidate learning records an observed failure/risk and a proposed remediation for later evaluation and review.
- There is no private per-agent behavioral memory. Runtime learning must not silently become future instruction.

## Operational state

Canonical path:

`.agent/state/project-state.md`

Read it when current pipeline status matters. Update it after a meaningful pipeline transition.

Allowed content:
- feature or bug identifier;
- current phase/gate/status;
- last owning agent;
- artifact paths;
- unresolved human blocker;
- one-line factual activity outcome;
- recently shipped release pointer.

Do not store reusable behavioral rules, preferred procedures, architectural heuristics, review shortcuts,
or "always/never" lessons in operational state.

Current repository evidence overrides state when they disagree. Correct stale state rather than treating
it as authoritative implementation evidence.

## Governed learning

Canonical candidate path:

`.agent/learning/candidates/LR-YYYY-NNNN.yaml`

Create a LearningRecord candidate only when there is a reusable observed failure, risk, or organizational
invariant worth proposing for future behavior. Use the LearningRecord schema from the governance release
pinned by `.agent/governance.yaml`.

A candidate must capture:
1. the observed failure/risk;
2. concrete evidence;
3. the smallest-correct-layer classification: `code`, `tool`, `skill`, `repository-policy`,
   `agent`, or `global-governance`;
4. the proposed change target and description;
5. an evaluation case with `fails_before` / `passes_after`; and
6. promotion scope/status.

If the proposed behavioral change has not been independently implemented and evaluated, keep
`passes_after: false` and `promotion.status: candidate`.

### Promotion firewall

The run that discovers a lesson may record a candidate, but that discovery does **not** authorize it to:
- rewrite the agent that discovered it;
- rewrite an owning skill or repository policy;
- modify global governance;
- treat the candidate as active instruction; or
- bypass the normal PR/evaluation/review path.

Promotion is a separate governed change.

## Legacy evidence

Historical private-memory content was moved to:

`.agent/learning/legacy/`

Those files are quarantined evidence only:
- do not load them routinely at task start;
- do not treat them as current repository truth;
- do not copy their imperatives into behavior;
- consult them only when historical investigation is actually relevant;
- re-verify useful observations against current repository evidence before creating a LearningRecord candidate.

Do not create or update `.github/agent-memory/**`.

## State update pattern

After completing a pipeline unit:
1. update/add the relevant Active Features row when applicable;
2. append one concise Activity Log entry, newest first;
3. add only unresolved human blockers that still require action;
4. keep state bounded by pruning old activity entries, not current active/blocker rows.

Role-specific agents may narrow this pattern, for example the Release Manager moving a completed feature
to Recently Shipped or the Debugger logging a confirmed bug without adding it as an Active Feature.

## Sensitive-data boundary

Never store secrets, tokens, private keys, connection strings, plaintext secret values, sensitive logs,
full production transcripts, or user data in state, candidates, or legacy-learning additions.
