import { describe, expect, it } from 'vitest'
// @ts-ignore - repository tooling is intentionally implemented as an ESM .mjs script.
import {
  validatePhase2Objects,
  validatePrdText,
  validateReviewText,
  validateSpecObject,
  validateSreArtifact,
} from '../../scripts/validate-delivery-contract.mjs'

describe('delivery contract validator', () => {
  const validPrd = `# PRD: Demo
## Problem Statement
A user needs a deterministic demo.
## Goals and Success Metrics
- Success metric: 100% of demo cases pass.
## Requirement Classification Matrix
| Capability | Classification |
|---|---|
| demo | new-feature |
## Functional Requirements (FR)
### FR-001: Demo
**Acceptance Criteria**:
- The demo works.
## Non-Functional Requirements (NFR)
### NFR-PERF-001: Fast
- p95 < 1s
## API and Data Impact
No API change.
## Risks and Assumptions
- Assumption: fixture only.
<!-- ORCHESTRATOR-READY
feature: demo
prd_path: docs/prd/demo.md
status: approved
fr_count: 1
nfr_count: 1
-->`

  it('accepts a mechanically complete PRD contract', () => {
    const result = validatePrdText(validPrd, {
      feature: 'demo',
      prdPath: 'docs/prd/demo.md',
    })
    expect(result.decision).toBe('CONTINUE')
    expect(result.code).toBe('PRD_VALID')
  })

  it('rejects a stale PRD handoff count', () => {
    const result = validatePrdText(validPrd.replace('fr_count: 1', 'fr_count: 2'), {
      feature: 'demo',
      prdPath: 'docs/prd/demo.md',
    })
    expect(result.decision).toBe('STOP')
    expect(result.errors.some((entry: { code: string }) => entry.code === 'FR_COUNT_MISMATCH')).toBe(true)
  })

  it('accepts the required architecture JSON shape', () => {
    const result = validateSpecObject({
      status: 'ready_for_challenger',
      feature: { name: 'demo', summary: 'Demo summary' },
      acceptance: { user_stories: [{}], acceptance_criteria: ['works'] },
      technical: { api_endpoints: [], data_contracts: {}, error_scenarios: ['failure'] },
      testing: { functional_test_scenarios: ['scenario'] },
      nfrs: { performance: { target: '<1s' } },
      dependencies: {},
    }, { feature: 'demo' })
    expect(result.decision).toBe('CONTINUE')
  })

  it('maps a non-approved round 2 review to escalation', () => {
    const review = `# Review
<!-- CHALLENGER-VERDICT
feature: demo
round: 2
verdict: changes_requested
blocking_count: 1
advisory_count: 0
-->`
    const result = validateReviewText(review, { feature: 'demo', round: 2, type: 'prd' })
    expect(result.decision).toBe('ESCALATE')
  })

  it('accepts both architecture challenger marker spellings', () => {
    for (const marker of ['ARCH-CHALLENGER-VERDICT', 'ARCHITECTURE-CHALLENGER-VERDICT']) {
      const review = `# Review
<!-- ${marker}
feature: demo
round: 1
verdict: approved
blocking_count: 0
advisory_count: 0
-->`
      const result = validateReviewText(review, { feature: 'demo', round: 1, type: 'arch' })
      expect(result.decision).toBe('CONTINUE')
      expect(result.facts.marker).toBe(marker)
    }
  })

  it('never lets an extra review round authorize automatic continuation', () => {
    const review = `# Review
<!-- CHALLENGER-VERDICT
feature: demo
round: 3
verdict: approved
blocking_count: 0
advisory_count: 0
-->`
    const result = validateReviewText(review, { feature: 'demo', round: 3, type: 'prd' })
    expect(result.decision).toBe('ESCALATE')
    expect(result.code).toBe('EXTRA_ROUND_REQUIRES_HUMAN')
    expect(result.blocking).toBe(true)
  })

  it('rejects empty review count metadata', () => {
    const review = `# Review
<!-- CHALLENGER-VERDICT
feature: demo
round: 1
verdict: approved
blocking_count:
advisory_count: 0
-->`
    const result = validateReviewText(review, { feature: 'demo', round: 1, type: 'prd' })
    expect(result.decision).toBe('STOP')
    expect(result.errors.some((entry: { code: string }) => entry.code === 'BLOCKING_COUNT_INVALID')).toBe(true)
  })

  it('accepts current Dev status complete', () => {
    const result = validatePhase2Objects({
      dev: { feature: 'demo', status: 'complete' },
      qa: { feature: 'demo', status: 'pass' },
      sre: { feature: 'demo', gate: 'pass', remediation_plan: [] },
    }, { feature: 'demo' })

    expect(result.decision).toBe('GO_ELIGIBLE')
    expect(result.facts.dev_status).toBe('complete')
  })

  it('allows SRE warn only with remediation and keeps normal phase 2 GO-eligible', () => {
    expect(validateSreArtifact({ feature: 'demo', gate: 'warn' }, { feature: 'demo' }).decision).toBe('STOP')

    const result = validatePhase2Objects({
      dev: { feature: 'demo', status: 'pass' },
      qa: { feature: 'demo', status: 'pass' },
      sre: { feature: 'demo', gate: 'warn', remediation_plan: ['re-scan in CI'] },
    }, { feature: 'demo' })

    expect(result.decision).toBe('GO_ELIGIBLE')
    expect(result.warnings).toHaveLength(1)
  })
})
