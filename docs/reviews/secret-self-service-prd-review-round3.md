# PRD Challenger Review: secret-self-service (Round 3)
Date: 2026-07-24
PRD: docs/prd/secret-self-service.md

## Note on Round Framing

This file is numbered Round 3 to follow the artifact-paths sequential convention (round1 and
round2 already exist for this feature), **but this is conducted as a full Round-1-equivalent
review, not a delta check against Round 2.** Round 1 and Round 2 reviewed an earlier, materially
different scope (FR-007 Authorized Secret Value Reveal, FR-008 Secret Rotation Request, no
live/sand dual-target design). Since then the PM Agent removed those FRs, added the current
FR-007 (Infrastructure Target Selection), and resolved all open questions. Per Round Discipline,
a material scope change resets the review to a fresh full pass across every dimension — this
review does not assume anything from Round 1/2 remains valid and re-examines the entire document.

## Verdict
changes_requested

## Blocking Findings

- [ ] **`resolveKeyVaultName()` return contract doesn't distinguish "not found" from "found but
  name unresolvable"** — Section 8 (New Service Methods table) vs. FR-003(d)/(e). Section 8
  documents the return shape as `{ vaultName, resourceGroup }` **or** `null`. FR-003(e) requires
  two distinct outcomes to be separately observable: (1) the `keyvault/` directory doesn't exist
  at all → FR-001(g) 404, and (2) the directory exists but the computed `keyvaultname` expression
  can't be statically reconstructed → still a 200 with `vaultName: null` (FR-001(f), FR-003(e)).
  A binary "object-or-null" return cannot represent both without additional structure, so as
  written the contract is ambiguous/unimplementable for case (2) vs (1). **Fix**: define a
  concrete shape, e.g. `{ found: boolean, vaultName: string|null, resourceGroup: string|null }`,
  where `found=false` drives the FR-001(g) 404 path and `found=true` (regardless of `vaultName`)
  drives the 200 path.

- [ ] **Test plan has no case for the "found directory, unresolvable vault name" path** —
  Section 12 (`resolveKeyVaultName()` row): coverage is listed as "Found (primary path), found
  (fallback scan), not found (404), graceful degradation (unconfigured target repo)" — none of
  these is the FR-003(d) scenario (directory exists, `substr` length varies per app, name can't
  be statically rebuilt, returns `vaultName: null` but is still a **success** path). This is the
  specific behavior the most recent PM revision introduced/corrected, and it has no defined test
  case. **Fix**: add an explicit row/case: "found directory, vault name unresolvable → 200 with
  `vaultName: null`" to Section 12.

- [ ] **FR-002(k)'s "rebase" conflict-resolution mechanism is not compatible with SOPS's
  document-encryption model** — FR-002(k). SOPS encrypts a document's values under a per-file
  data key and embeds a whole-document MAC. Two branches independently produced by two separate
  `POST /api/secrets` calls (each SOPS-encrypting only its own secret into `secrets.enc.yaml`)
  are two files with two different data keys/MACs. A plain git "rebase the branch's encrypted
  change onto [default branch HEAD]" is a text-level operation and cannot reconcile two
  independently-encrypted SOPS documents into one that still passes SOPS's MAC/integrity check on
  decrypt — it needs an explicit decrypt → merge-plaintext → re-encrypt step (and a decision on
  which identity performs it, since NFR-SEC-003 says only the CI identity — not the portal
  backend — holds `unwrapKey`). As written, the AC describes a git operation that doesn't achieve
  the stated outcome. **Fix**: either rewrite FR-002(k) to name the decrypt-merge-reencrypt step
  and the identity that performs it, or move this to an explicit Architecture-phase decision in
  Section 10 rather than asserting "rebase" as already-decided.

- [ ] **FR-002(i)'s 5-minute polling timeout contradicts the Section 9 user journey** —
  FR-002(g)/(i), NFR-UX-001, Section 9 (steps 7–11). Section 9 describes one continuous
  status-modal session spanning: PR opened (step 8–9) → **human platform-engineer review and
  merge** (step 10) → CI decrypt-and-sync (step 10–11) → "Sync complete" shown (step 11).
  FR-002(i) caps the same poll at a 5-minute timeout. A human PR review/merge essentially never
  happens within 5 minutes, so on the documented happy path the modal will time out before
  "Sync complete" can ever render, even for a fully successful submission. NFR-UX-001 additionally
  mandates reusing `useWorkflowPolling.ts` as-is, which was designed for short automated
  `workflow_dispatch` runs, not a flow gated on human PR review. **Fix**: split the UX into two
  states — a short poll ending at a terminal "PR opened, awaiting approval" success state matching
  FR-002(g)'s immediate response, and a separate (non-polling, e.g. PR-link/webhook-based)
  mechanism for surfacing eventual sync completion — don't require the same bounded poll to reach
  "Sync complete."

- [ ] **Section 5 classification matrix row 8 ("SOPS encryption key management") is stale** —
  Section 5 vs. Section 10 (OQ-001). The row's Proposed Action still reads "Document as blocking
  open question; see Section 10," but Section 10/OQ-001 has since been fully resolved with a
  concrete design (SOPS native Azure Key Vault encryption, `wrapKey`/`unwrapKey` role split,
  common platform Key Vault). This row was missed in the revision pass that updated Sections 10,
  13, and 14, and as written could mislead the Architect into re-opening a discovery task that's
  already closed. **Fix**: update the row's Proposed Action to reference the resolved OQ-001
  design instead of "document as blocking open question."

- [ ] **NFR-OBS-001's required log/metric fields omit `target`** — NFR-OBS-001 vs. FR-006(a) and
  FR-007(e). FR-006(a) requires every handler to log `correlationId, user, target, appName,
  environment` on every code path, and FR-007(e) separately requires `target` in every structured
  log event so audit records show which infrastructure scope changed. NFR-OBS-001's own "Events
  include" list, however, enumerates only `correlationId, user (email), appName, environment,
  latency_ms` — `target` is missing. **Fix**: add `target` to NFR-OBS-001's field list so it
  matches FR-006(a)/FR-007(e).

## Advisory Findings

- NFR-PERF-001's 2000 ms p95 budget is a notable deviation from the platform's usual <500 ms p95
  default (per PM agent conventions) and the NFR text itself doesn't state why (the implicit
  reason — a live GitHub API/HCL-parse round trip in FR-003 — only appears elsewhere). One
  sentence of rationale in NFR-PERF-001 would preempt reviewer confusion.
- Section 5 classifies "Auto-discover Key Vault from the selected repo" as `existing-extend`, but
  FR-003(d)'s locals-based reconstruction of a computed `substr` expression is logic that doesn't
  exist in `hclParser.js` today in any form — closer to a hybrid extend+new-feature than a pure
  extension. Not blocking since FR-003's ACs already fully specify the new behavior regardless of
  the label.
- NFR-SCALE-001's measurable target ("10 concurrent requests ... trigger at most 1 GitHub API
  call") implicitly assumes a single backend replica; the proposed cache is in-process, so in a
  multi-replica AKS deployment each pod has its own cache and the target only holds for a
  single-instance test, not necessarily production. Worth a one-line caveat.
- Section 8's example JSON for `GET /api/secrets` only shows a literal `vaultName` value; it
  doesn't illustrate the `null` case established by FR-001(f)/FR-003(d)(e). Minor documentation
  completeness gap, related to the two Blocking findings above on the same contract.
- FR-004(a)/NFR-UX-002 gate the Secrets page on `features.secrets` in `data/environments.json`
  (a per-portal-deployment-environment flag), while FR-001(d) notes that same file doesn't include
  every live target environment (e.g. `prod`, `int`) a developer might pick as their app's target
  environment. The two different meanings of "environment" (portal deployment env for gating vs.
  app's own target env for the operation) are easy to conflate; one clarifying sentence would
  help — though this ambiguity is inherited from the existing `aks`/`customInfra` flag pattern,
  not newly introduced here.

## Summary of Cross-Section Traceability Checks Performed

- FR-003(d)'s best-effort/nullable `vaultName` design: consistently reflected in FR-001(f),
  FR-003(e), the risk table, and assumption 2 — **except** in the `resolveKeyVaultName()` return
  contract (Section 8) and the test plan (Section 12), both flagged above.
- Dual-repo (`live`/`sand`) target threading: consistently present in FR-001–FR-004, FR-006,
  FR-007, NFR-REL-001, NFR-SCALE-001, NFR-SEC-003, Section 8, Section 9, Section 10 risk/assumption
  rows — **except** NFR-OBS-001's field list, flagged above.
- OQ-001/OQ-002/OQ-003 "RESOLVED" claims: all three are consistently framed as resolved with only
  non-blocking implementation-detail follow-ups (exact KV resource name, OIDC subject claims,
  CODEOWNERS, CI workflow authoring) — no hidden "pending sign-off" language found in Section 10,
  the Phase 1/2 delivery-plan gates, or Section 13/14 — **except** Section 5's stale row 8,
  flagged above.
- FR/NFR counts: 7 `### FR-` headers and 11 `### NFR-` headers confirmed by direct count; both
  match the Summary Table (Section 13) and the `ORCHESTRATOR-READY` block. No count discrepancy.
- No dangling references to the removed FR-007 (old)/FR-008/OQ-004/OQ-005 (reveal, rotation)
  found anywhere in the document; Non-Goals, classification matrix, and Section 10 assumptions
  are all consistent with their removal.

<!-- CHALLENGER-VERDICT
feature: secret-self-service
round: 3
verdict: changes_requested
blocking_count: 6
advisory_count: 5
-->
