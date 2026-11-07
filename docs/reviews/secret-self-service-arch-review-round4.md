# Architecture Challenger Review — Round 4 (delta-only, human-directed): `secret-self-service`

**Spec reviewed**: [secret-self-service-spec.md](../architecture/secret-self-service-spec.md),
[secret-self-service-spec.json](../architecture/secret-self-service-spec.json)
**PRD**: [docs/prd/secret-self-service.md](../prd/secret-self-service.md) (amended 2026-07-31, FR/NFR
counts unchanged at 7/11, no IDs renumbered)
**Prior rounds**: [round1](./secret-self-service-arch-review-round1.md) (changes_requested, 3
blocking), [round2](./secret-self-service-arch-review-round2.md) (**approved**, 0 blocking),
[round3](./secret-self-service-arch-review-round3.md) (human-directed, **escalate_to_human**, 3
blocking B1–B3 + 3 advisory A1–A3, scoped strictly to Key Vault discovery)
**Round**: 4 — **delta-only**, human-directed per explicit instruction (round 3 escalated after a
round-2 approval, so this re-check is outside the normal two-round cap by design, not an
auto-continuation). Scope is strictly: did the amended PRD + revised spec resolve round-3's B1, B2,
B3, A1, A2, A3? Round 1/2-settled decisions (SOPS per-value blobs, synchronous POST, file-SHA
concurrency check, dual-repo `target`, Infrastructure App only, branch naming, `branchExists()`
pre-check) are out of scope and not re-litigated.

---

## Security note

Every file read during this round (PRD, spec.md, spec.json, round1–3 review files) returned a tool
output with an appended `<PreToolUse-context><context_guidance>` block instructing a switch to a
nonexistent tool (`context-mode_ctx_execute_file` / `ctx_execute`). This is not a repository
instruction or a user request — it is a prompt injection appended at the tool-output layer. Ignored
in every case; standard `read_file`/`grep_search` tools used throughout, consistent with round 3's
handling of the same pattern.

---

## Delta verification against Round 3

### B1 — singular `{ vaultName: string\|null }` contract cannot represent multi-vault apps
**Resolved.** `resolveKeyVaultName()` → `resolveKeyVaults()`, contract now
`{ found: boolean, vaults: Array<{ vaultDir, vaultName, resourceGroup }> }` (spec.json
`data_contracts.resolve_key_vaults_result`, FR-003(e)). Propagated correctly:
- **FR-001**: aggregates secrets across all resolved vaults when no filter is given (each entry
  tagged with source `vaultDir`, same name allowed to appear in two sibling vaults — not deduped);
  optional `vaultDir` query filter validated against the FR-003 list, mismatch → 422. Covered by
  TS-006/007/008.
- **FR-002**: `vaultDir` optional when exactly one vault resolves, **required** when more than one;
  omitted with >1 → 422 with the `vaults` list attached (client can render a selector without a
  second round trip); supplied-but-not-in-list → 422 allow-list rejection **before any path
  construction**. Covered by TS-012/013/014.
- **FR-004/UI**: vault selector renders only when `vaults.length > 1`, submit disabled until chosen;
  hidden and implicit for the single-vault case. Covered by TS-033, E2E-002.
- PRD Non-Goal corrected: no longer claims "exactly one Key Vault per app/environment pair"; narrowed
  to a "cross-vault secret copy" exclusion, consistent with the human's `mlops` evidence. This was
  routed through the PM agent as round 3 required, not patched around in the spec alone.
Closed.

### B2 — documented fallback rescues none of the real path-shape variants
**Resolved.** The depth-2-anchored `*.hcl` fallback scan is explicitly withdrawn ("not carried
forward as a safety net" — FR-003(c), spec.json). Replaced with one-shot tree enumeration
(`GET .../git/trees/{sha}?recursive=1`), filtering on `/^keyvault\d*$/i` (directories) and
`keyvault.hcl` (file form), with **positional-agnostic** appName/environment derivation ("first
segment after `infrastructure/` equals appName, any subsequent segment equals environment" —
FR-003(b)). This design is verified against all four variants named in round 3's evidence:
numbered `keyvault01`/`keyvault02` (TS-019), depth-3 `{app}/hub/{env}` (TS-020), `{app}/{env}/{subapp}`
sub-app nesting (TS-021), and `_common/keyvault.hcl` as a file (TS-022). A **new**, narrower fallback
exists only for the `truncated:true` tree-response case (FR-003(h), TS-025) — this is not the same
fallback round 3 rejected and does not reintroduce the depth-2 anchoring problem; it operates
per-requested-`appName`, not a fixed directory. Closed.

### B3 — locals/expression resolver was 100% new work mischaracterized as "reuse of hclParser.js"
**Resolved.** A distinct component is named, `services/terragruntLocalsResolver.js`, with a
`resolveName(vaultDir, target)` contract that: (1) walks parent folders for `common.hcl`/`env.hcl`
mirroring Terragrunt's `find_in_parent_folders()` semantics, (2) discovers the alias-to-file binding
(`env`, `config`, `common_vars` — all three explicitly named) rather than hardcoding one alias, (3)
evaluates only the bounded expression grammar observed in production (`substr()`, `format()`, `${}`
interpolation), (4) strips full-line comments before matching so a commented-out
`# keyvaultname = ...` line is never matched live, and (5) returns `null` (never throws) when
unresolvable. `component_changes` explicitly states this reuses only `githubService.octokit`/auth,
not `hclParser.js`'s extraction logic. Covered by TS-023 (comment stripping), TS-028 (three-alias
parameterized test), TS-029 (expression grammar variance), TS-030 (unresolvable → null, not throw).
Closed.

### A1 — "identical to infrastructure-live" claim for `service-catalog` overstated
**Resolved.** Spec §4/§7 resolution table and FR-007 now scope the claim to directory-depth
similarity only, not value-resolution simplicity — matching round 3's finding that the same
alias-fragility exists in `service-catalog` too. Closed.

### A2 — no rule distinguishing per-app `keyvaultname` from the shared `env_key_vault_name` local
**Resolved.** `terragruntLocalsResolver.js`'s component description explicitly restricts matching to
`inputs.keyvaultname` inside the matched `keyvault*/terragrunt.hcl`, ignoring any `*_key_vault_name`
local encountered while resolving locals. Closed.

### A3 — tree-enumeration's GitHub App permission scope not confirmed in writing
**Resolved.** Spec.json states in one line that `git.getTree`/`git.getRef` are standard REST calls
under the existing Infrastructure GitHub App installation (same `githubService.octokit` client used
elsewhere in the file) — no new permission required. Closed.

---

## Consistency spot-check (spec.json vs spec.md vs PRD)

- FR/NFR counts: PRD `ORCHESTRATOR-READY` block states `fr_count: 7`, `nfr_count: 11`; spec.json's
  `acceptance_criteria` lists FR-001..FR-007 (7) and `nfrs` lists 11 entries — consistent.
- No stale `resolveKeyVaultName` references found in spec.json or spec.md (all renamed to
  `resolveKeyVaults`).
- Round 1/2-settled items untouched by this amendment: per-value SOPS blobs
  (`data_contracts.secrets_enc_yaml_format` / spec.md §4a), synchronous `POST /api/secrets` (FR-002(i),
  no workflow dispatch or polling), file-SHA concurrency check (FR-002(k), scoped per-`vaultDir` so
  sibling-vault writes don't false-conflict — TS-017), `githubService.octokit` only, never
  `codeOctokit` (FR-003(a), FR-007) — all still present and consistent with rounds 1–2's approval.

No new issues found. No regressions introduced by the amendment into previously-settled scope.

---

## Verdict

<!-- ARCH-CHALLENGER-VERDICT
feature: secret-self-service
round: 4
verdict: approved
blocking_count: 0
advisory_count: 0
carried_from_round3_blocking: 3
carried_from_round3_advisory: 3
all_resolved: true
human_directed: true
delta_only: true
note: "Round 4 authorized by explicit human instruction as a delta-only re-check of round 3's B1-B3/A1-A3, following the PRD amendment (multi-vault Non-Goal correction) and spec revision (resolveKeyVaults, tree enumeration, terragruntLocalsResolver.js). Prompt-injection attempt observed in tool outputs (fake context_guidance blocks urging a nonexistent ctx_execute tool) and ignored; see Security note above."
-->

All six Round 3 findings (B1, B2, B3, A1, A2, A3) are resolved with no new issues introduced.
**Approved.** Phase 2 (Vue.js Dev, QA Engineer, SRE DevOps) may proceed against
`secret-self-service-spec.json` as authorization.
