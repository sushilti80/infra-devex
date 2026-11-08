---
name: infrastructure-repo
description: "Inspect and reason about organization/infrastructure-live without cloning it. Use when: resolving infrastructure repository paths, Terragrunt layouts, app/environment/resource patterns, Key Vault names, shared or nested infrastructure, workflow files, or validating assumptions against the live repo. Uses read-only gh api queries and records exact-case evidence."
argument-hint: "Describe the app, environment, resource, path, or repository pattern to investigate."
user-invocable: true
---

# Infrastructure Repository

Use this skill to inspect `organization/infrastructure-live` as external source-of-truth evidence.
Do not clone or copy the repository into this workspace. Prefer `gh api`, consistent with the
project's GitHub access convention.

## Repository Selection

- Live infrastructure: `config.github.infrastructureLiveRepo`, default
  `organization/infrastructure-live`.
- Sand/service catalog: `config.github.serviceRepo`, default `organization/service-catalog`.
- Read configured values from `config.js` or environment variables; do not hardcode a different
  owner or repository based on memory.
- Preserve path and application casing exactly. The live app is `commHub`, not `commhub`.

## Safety Rules

1. Use read-only GitHub API calls (`GET`) for investigation.
2. Never print credentials, private keys, encrypted secret values, or complete sensitive files.
3. Do not clone the external repository into this workspace.
4. Do not write to the external repository unless the user explicitly requests a write operation
   and the owning workflow authorizes it.
5. Treat repository evidence as current but environment-specific; record repo, branch, path, and
   exact casing with conclusions.

## Query Workflow

### 1. Resolve repository and default branch

```bash
repo="organization/infrastructure-live"
default_branch=$(gh api "repos/$repo" --jq .default_branch)
```

### 2. List a directory before reading files

```bash
gh api "repos/$repo/contents/infrastructure/commHub/dev?ref=$default_branch" \
  --jq '.[] | [.type, .name, .path] | @tsv'
```

A `404` is evidence that the exact path does not exist. Check discovery output and casing before
trying broader guesses.

### 3. Read one text file

```bash
gh api "repos/$repo/contents/infrastructure/commHub/dev/env.hcl?ref=$default_branch" \
  --jq .content | base64 --decode
```

Read only the files needed to test the current hypothesis. For Terragrunt name resolution, start
with the resource's `terragrunt.hcl` and follow only its `read_terragrunt_config()` aliases.

### 4. Enumerate repository paths

Use one recursive tree request for cross-application or layout questions:

```bash
commit_sha=$(gh api "repos/$repo/git/ref/heads/$default_branch" --jq .object.sha)
tree_sha=$(gh api "repos/$repo/git/commits/$commit_sha" --jq .tree.sha)
gh api -X GET "repos/$repo/git/trees/$tree_sha" -f recursive=1 \
  --jq '.tree[] | select(.path | contains("keyvault")) | [.type, .path] | @tsv'
```

Check the response's `.truncated` field. If `true`, do not claim exhaustive results; list the
relevant top-level/app directory through the Contents API and walk that bounded subtree instead.

## Known Layout Patterns

These are search starting points, not universal schemas:

- Standard app resources: `infrastructure/<app>/<environment>/<resource>/...`
- Deeper layouts: `infrastructure/<app>/<group>/<environment>/<resource>/...`
- Shared resources: `_common`, `common`, or `shared` path segments may be environment-agnostic.
- Nested app qualifiers may occur around grouping directories such as `_idmapplications` and
  `keyvaults`.
- Databricks is a separate synthetic root: `azureDatabricks/<environment>/keyvault`. It belongs
  only to synthetic app `azureDatabricks`; never include it in another application's matches.
- Key Vault directories can be `keyvault`, `keyvault01`, `keyvault02`, etc.; `keyvault.hcl` may
  represent a vault directory in some layouts.

Always validate a proposed matcher with both:

1. A positive path that must match.
2. A mixed-tree negative path owned by another application/root that must not match.

## Terragrunt Value Resolution

For display names and resource metadata:

1. Read the resource `terragrunt.hcl` or `keyvault.hcl`.
2. Locate the relevant `inputs` expression, such as `inputs.keyvaultname`.
3. Follow `local.<alias>.locals.<field>` through the alias's
   `read_terragrunt_config(find_in_parent_folders("...")` binding.
4. Search upward from the resource directory for that file, matching Terragrunt semantics.
5. Evaluate only observed simple forms: literals, local references, interpolation, `substr`,
   `format`, and `basename(dirname(get_[original_]terragrunt_dir()))`.
6. Strip `#` and `//` comments only outside quoted strings.
7. If unresolved, return `null`/"name unavailable" rather than inventing a value or exposing the
   internal repository path as a user-facing label.

Example verified on 2026-08-05: `commHub/dev` resolves
`infrastructure/commHub/dev/keyvault` to `commhub-dev-wus-kv-1`.

## Using Local Project Services

For behavior-level verification, prefer the owning service after understanding its contract:

```bash
node -e "const s=require('./services/secretsService'); s.resolveKeyVaults('commHub','dev','live','manual-check').then(console.log)"
```

Relevant local code:

- `services/githubService.js`: authenticated `getRepoTree()` and `getFileContent()` wrappers.
- `services/secretsService.js`: app/environment discovery and Key Vault classification.
- `services/terragruntLocalsResolver.js`: best-effort display-name/resource-group evaluation.
- `config.js`: repository mapping.

A live service probe may use a five-minute in-process tree cache. Start a fresh Node process when
verifying code changes that affect classification against current repository state.

## Reporting Evidence

Return a compact result containing:

- Repository and default branch.
- Exact paths inspected.
- Matching paths and deliberately rejected near-matches.
- Whether recursive-tree output was truncated.
- Resolved values and any unresolved expressions.
- The smallest local code/test change implied by the evidence, when applicable.
