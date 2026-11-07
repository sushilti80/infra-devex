# Governed Learning

Runtime learning is **propose-only**.

Agents may capture an observed failure, risk, or reusable discovery as a LearningRecord candidate,
but they may not automatically promote that observation into repository instructions, an agent,
a skill, or global governance.

## Locations

- `.agent/state/project-state.md` — current operational pipeline state only.
- `.agent/learning/candidates/LR-YYYY-NNNN.yaml` — candidate LearningRecords.
- `.agent/learning/legacy/` — quarantined historical private-memory content retained as evidence
  only. Legacy files are not governing instructions and must not be automatically loaded as agent
  behavior.

## Candidate contract

Use the central Aya LearningRecord schema from the governance release pinned by
`.agent/governance.yaml`. A candidate must include:

- observed failure or risk;
- concrete evidence;
- smallest-correct-layer classification;
- proposed change target and description;
- evaluation case and before/after status; and
- promotion scope/status.

Creating a candidate does not authorize the proposed change. Promotion requires a separate governed
change with the required evaluation and review.

## Runtime rules

1. Update operational state only with current factual status and artifact references.
2. Do not store reusable behavioral rules in operational state.
3. Do not create or update `.github/agent-memory/**`.
4. Do not treat legacy learning files as authoritative repository facts; verify against current
   repository evidence.
5. Do not modify the agent/skill/policy that would consume a new lesson merely because the lesson was
   discovered in the same run.
