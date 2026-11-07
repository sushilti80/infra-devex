# Architecture Challenger Review — Round 1: `secret-self-service`

**Spec reviewed**: [secret-self-service-spec.md](../architecture/secret-self-service-spec.md) (primary),
[secret-self-service-spec.json](../architecture/secret-self-service-spec.json) (consistency spot-check)
**PRD**: [docs/prd/secret-self-service.md](../prd/secret-self-service.md)
**Round**: 1 (full review)

---

## Blocking Findings

### B1 — No mechanism specified for adding a key to an existing multi-secret SOPS document without decrypt access

FR-002(e)/FR-001(f) require a **single** `secrets.enc.yaml` per app/environment holding **multiple**
secret keys, with names readable in plaintext. FR-002(k) is explicit that the portal backend holds
**wrapKey-only** access and never `unwrapKey`/decrypt, and that it "cannot semantically merge two
independently SOPS-encrypted documents" because SOPS's whole-document MAC changes on every edit.

The architecture (`component_changes` → `services/secretsService.js`) says
`submitSecretViaGitOps(...)` "SOPS-encrypts value ... commits ... secrets.enc.yaml", but does not
explain **how a single new key is added into an already-encrypted multi-key document** without
recomputing SOPS's document-wide MAC — and recomputing that MAC over the *existing* keys normally
requires decrypting them first (standard `sops --set` behavior against an existing file decrypts the
whole document to preserve/re-authenticate all other values). This is the same class of problem
FR-002(k) already solved for *cross-branch* merges, but the architecture doesn't solve it for the
*single-branch, add-one-key-to-an-existing-document* case, which is the normal/only write path FR-002
describes.

**Required fix**: Either (a) specify that each secret is stored as its own independently-encrypted
YAML document (e.g., `secrets/{secretName}.enc.yaml` or one SOPS document per key) so no cross-key MAC
recomputation is ever needed and no decrypt is ever required — reconciling this with FR-001(f)'s
"single document" language — or (b) explicitly document a concrete SOPS mechanism (e.g.
`--mac-only-encrypted` combined with SOPS's per-value encryption so unrelated keys' ciphertext is
copied byte-for-byte from the previous version without needing plaintext) and state exactly which
`sops` CLI invocation achieves an append-only edit with **zero decrypt calls**. Given this is
architecture, not PRD, scope, this is fixable here without reopening the PRD — but it must be
concrete enough for the Vue.js Dev/SRE agents to implement without inventing crypto behavior
themselves.

### B2 — `resolveKeyVaultName` cache does not prevent a concurrent-burst stampede

NFR-SCALE-001 requires "10 concurrent requests for the same target/app/environment triggers at most 1
GitHub API call." The architecture specifies "in-process 5-minute TTL cache (Map)" but a plain
value-keyed Map only prevents *repeat* calls once the *first* call has *resolved* — it does not
prevent N concurrent callers that all arrive before the first GitHub round-trip completes from each
independently missing the cache and firing their own GitHub call. The spec must cache the **in-flight
Promise** (not just the resolved value) so concurrent callers within the same burst await the same
pending request.

**Required fix**: Update `services/secretsService.js` component description to state the cache stores
`Promise<ResolveResult>` keyed by `target:appName:environment`, and callers `await` the cached
promise directly (not "check cache, else call, else cache result" — that ordering is exactly what
allows the stampede).

### B3 — `submitSecretViaGitOps` branch handling doesn't account for `createBranch` failing on an already-existing branch

FR-002(h) states the deterministic branch `secrets/{appName}-{environment}-{secretName}` may already
exist (same secret updated again, or first PR was closed without merging) and the backend must
"push a fresh commit to that branch (creating it if needed)". The existing `githubService.createBranch()`
helper (reused per the architecture) calls `git.createRef`, which throws (422 "Reference already
exists") if the branch is already present — there is no get-or-create semantics in the current
helper, and the architecture's flow/sequence diagram doesn't show a check-then-create-or-reuse step.
As written, the second submission for the same secret name (the exact update scenario FR-002(h)
describes) will throw an unhandled error instead of reusing the branch.

**Required fix**: Specify that `submitSecretViaGitOps` first attempts `githubService` branch lookup
(e.g. `git.getRef('heads/{branch}')`) and only calls `createBranch` on 404; on success it commits to
the existing branch's current HEAD instead. Note in `component_changes` whether this requires a new
`githubService` helper (e.g. `branchExists`/`getOrCreateBranch`) or whether `secretsService.js` calls
existing octokit methods directly for this one check.

---

## Advisory (non-blocking)

### A1 — `sops` CLI availability not tied to a concrete Dockerfile action item
`dependencies.external_tools` correctly flags that the `sops` binary must be in the runtime image, but
no `component_changes` entry touches the `Dockerfile`. Recommend adding a `Dockerfile` line item
(SRE DevOps phase) so this isn't silently missed.

### A2 — `findOpenPullRequest` owner/repo argument shape unspecified
The addition to `githubService.js` doesn't specify whether `branchName` is passed bare (`secrets/foo`)
or requires the `owner:` prefix required by the GitHub `pulls.list({ head })` parameter — worth a
one-line clarification so the Dev agent doesn't guess.

---

## Verdict

<!-- ARCH-CHALLENGER-VERDICT
feature: secret-self-service
round: 1
verdict: changes_requested
blocking_count: 3
advisory_count: 2
-->

Route back to the Architect for one revision addressing B1–B3 (A1/A2 optional but recommended in the
same pass), then re-review via Round 2 (delta-only).
