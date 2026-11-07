---
name: delivery-contract
description: Deterministically validate self-service feature-delivery artifacts and gate transitions. Use for PRD structure/handoff markers, architecture spec completeness, challenger verdict markers/round limits, Dev/QA/SRE terminal artifacts, and normal Phase 2 readiness eligibility. This skill validates contracts; it does not judge product, architecture, implementation, test, or security quality.
---

# Delivery Contract

Use deterministic validation before Orchestrator reasoning.

Implementation:

`scripts/validate-delivery-contract.mjs`

## Ownership

This skill owns:
- parsing/counting required PRD structure and the `ORCHESTRATOR-READY` marker;
- checking required architecture-spec JSON fields;
- parsing challenger verdict markers and enforcing the automatic two-round limit;
- reading Dev/QA/SRE terminal status fields; and
- normal Phase 2 GO eligibility from owner-produced terminal artifacts.

This skill does **not**:
- author or repair an artifact;
- decide whether requirements, NFR targets, architecture, tests, or security evidence are substantively good;
- replace PRD Challenger or Architecture Challenger review;
- waive a human gate;
- infer missing evidence; or
- broaden Orchestrator authority.

## Commands

### PRD gate

```bash
node scripts/validate-delivery-contract.mjs prd \
  --feature <feature_name> \
  --path docs/prd/<feature_name>.md
```

Checks deterministic structure, FR/NFR heading counts, per-FR Acceptance Criteria presence, and the final
`ORCHESTRATOR-READY` fields/counts. It intentionally does not judge whether a persona or target is
semantically adequate; that remains PM/Challenger work.

### Architecture spec gate

```bash
node scripts/validate-delivery-contract.mjs spec \
  --feature <feature_name> \
  --path docs/architecture/<feature_name>-spec.json
```

Checks the current Orchestrator contract: `status: ready_for_challenger`, feature identity, required
acceptance/technical/testing/NFR fields, and dependencies presence.

### Challenger review gate

PRD:

```bash
node scripts/validate-delivery-contract.mjs review \
  --type prd --round 1 --feature <feature_name> \
  --path docs/reviews/<feature_name>-prd-review-round1.md
```

Architecture:

```bash
node scripts/validate-delivery-contract.mjs review \
  --type arch --round 1 --feature <feature_name> \
  --path docs/reviews/<feature_name>-arch-review-round1.md
```

The JSON `decision` is:
- `CONTINUE` — approved;
- `REVISE` — Round 1 changes requested; route to the owning author then run Round 2;
- `ESCALATE` — non-approved Round 2, or explicit escalation; stop for a human.

Architecture reviews accept both verdict marker spellings already present in this repository:
`ARCH-CHALLENGER-VERDICT` and `ARCHITECTURE-CHALLENGER-VERDICT`.

Rounds above 2 always return `ESCALATE`, even when the review verdict itself is `approved`. A human may
authorize another manual review cycle, but the extra review artifact never converts itself into automatic
pipeline authorization; an explicit human decision remains required before continuing.

### Terminal artifacts

```bash
node scripts/validate-delivery-contract.mjs dev --feature <feature_name> --path docs/readiness/<feature_name>-dev-status.json
node scripts/validate-delivery-contract.mjs qa  --feature <feature_name> --path tests/results/<feature_name>-results.json
node scripts/validate-delivery-contract.mjs sre --feature <feature_name> --path docs/security/wiz-<feature_name>-report.json
```

Dev may report `status: complete` (current contract) or `pass`; QA must report `status: pass`. SRE may report `gate: pass` or `warn`; `warn` must
include a non-empty `remediation_plan`. `fail` stops readiness.

For the normal three-agent Phase 2 path:

```bash
node scripts/validate-delivery-contract.mjs phase2 \
  --feature <feature_name> \
  --dev-status docs/readiness/<feature_name>-dev-status.json \
  --qa-results tests/results/<feature_name>-results.json \
  --sre-report docs/security/wiz-<feature_name>-report.json
```

`GO_ELIGIBLE` means only that the three terminal artifacts satisfy their mechanical gates. Challenger
approval, human gates/waivers, artifact conflicts, and deployment/release evidence remain separate.

## Result contract

The validator always writes one JSON object.

- exit `0`: deterministic gate can continue (`CONTINUE` or `GO_ELIGIBLE`);
- exit `2`: valid execution found a revise/stop/escalation/no-go condition;
- exit `1`: validator usage, file, parse, or harness error.

Use the JSON `decision`, `code`, `errors`, `warnings`, and `facts` directly. Do not re-count or
re-parse the same contract with model reasoning.

When a validator reports malformed/missing evidence, route the artifact to its documented owner from
`.github/skills/artifact-paths/SKILL.md`.
