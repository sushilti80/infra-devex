# Architecture Challenger Review — Round 2 (delta-only): `secret-self-service`

**Spec reviewed**: [secret-self-service-spec.md](../architecture/secret-self-service-spec.md),
[secret-self-service-spec.json](../architecture/secret-self-service-spec.json)
**Round 1 review**: [secret-self-service-arch-review-round1.md](./secret-self-service-arch-review-round1.md)
**Round**: 2 (delta-only — verifying only Round 1 Blocking findings were resolved)

---

## Delta verification

### B1 — SOPS multi-key MAC / decrypt problem
**Resolved.** `technical.data_contracts.secrets_enc_yaml_format` (spec.json) and §4a (spec.md) now
specify `secrets.enc.yaml` as a plain YAML map of independently self-contained, per-value SOPS blobs,
each with its own embedded metadata/MAC. Adding/updating one secret replaces only that key's blob;
no whole-document MAC recomputation and no decrypt of unrelated values is required. This reconciles
FR-001(f) (plaintext keys), FR-002(e) (single sibling file), and NFR-SEC-003 (portal never holds
unwrapKey) without contradicting any PRD wording. `secretsService.js`'s `component_changes` entry and
new test `TS-017` reflect this. Closed.

### B2 — cache stampede under concurrent burst
**Resolved.** `secretsService.js`'s `component_changes` entry now specifies the cache stores the
in-flight `Promise`, keyed by `${target}:${appName}:${environment}`, with TTL applied after
resolution. New test `TS-012` explicitly asserts the underlying GitHub call fires exactly once even
when 10 callers arrive before the first resolves. Closed.

### B3 — `createBranch` throws on an already-existing deterministic branch
**Resolved.** New `githubService.branchExists()` helper added to `component_changes`;
`submitSecretViaGitOps` now checks it before calling `createBranch`, committing to the existing
branch's HEAD when found (covers the FR-002(h) update-existing-branch path). New test `TS-016`
verifies `createBranch` is not called when the branch already exists. Closed.

### A1 — sops CLI / Dockerfile
Resolved — `Dockerfile` added to `component_changes` as an SRE DevOps action item.

### A2 — `findOpenPullRequest` head-filter format
Resolved — documented as `${owner}:${branchName}` in `githubService.js`'s `component_changes`
description.

---

## Verdict

<!-- ARCH-CHALLENGER-VERDICT
feature: secret-self-service
round: 2
verdict: approved
blocking_count: 0
advisory_count: 0
carried_from_round1_blocking: 3
carried_from_round1_advisory: 2
all_resolved: true
-->

All three Round 1 Blocking findings (B1, B2, B3) and both Advisory items (A1, A2) are resolved in the
current spec. No new issues introduced by the delta. **Approved** — Phase 2 (Vue.js Dev, QA Engineer,
SRE DevOps) may proceed against `secret-self-service-spec.json` as authorization.
