# Repository Behavioral Evals

This directory contains **repository-specific behavioral regression cases** for agents in
`self-service-infra`.

These cases complement, but do not duplicate:

- deterministic code/tests such as `tests/smoke/deliveryContract.spec.ts`; and
- organization-wide behavioral evals owned by `organization/agent-governance`.

## Current execution status

Example Agent Governance `2026.09.12` executes consumer-local behavioral evals through Promptfoo and
GPT-5.6 Luna when `validation.repository_evals: true`.

This repository is enrolled with:

```yaml
validation:
  global_evals: true
  repository_evals: true
```

For each case, central governance deterministically resolves the named agent contract, repository
instructions, and explicitly referenced skills; builds a bounded contract payload; and runs the scenario
through a tool-disabled Luna simulator. Expected boolean outcomes remain in Promptfoo assertions and are
not sent to the model.

Behavioral assertion mismatches are report-only during calibration and surface as governance
`ATTENTION`. Invalid catalogs, unknown agent references, malformed model output, provider failures, and
Promptfoo/framework errors remain blocking.

## Scope

Add a repository eval when all of the following are true:

1. the behavior is repository-specific rather than an organization-wide invariant;
2. deterministic code cannot fully prove the behavior because agent judgment/authority is involved;
3. the case protects a meaningful failure mode, boundary, or regression; and
4. the expected behavior is observable without requiring hidden reasoning.

Keep mechanical parsing/counting/status rules in deterministic tests, not behavioral evals.

## Format

Mirror the simple central eval catalog shape:

```yaml
id: ORCH-EXAMPLE-001
category: orchestration
agent: SelfServiceInfra Orchestrator
scenario: A concrete situation presented to the agent.
expect:
  observable_behavior: true
  prohibited_behavior: false
```

Multiple cases may be separated by `---`.

Expectations describe externally observable behavior. They must not request chain-of-thought or internal
reasoning.

## Ownership

- Orchestrator behavior: `.agent/evals/orchestrator.yaml`
- Global invariants: central `agent-governance/evals/global/`
- Mechanical delivery-contract behavior: `tests/smoke/deliveryContract.spec.ts`

When a behavioral defect is discovered, add or update the smallest relevant eval case before promoting
new agent instructions.
