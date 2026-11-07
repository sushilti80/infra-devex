# PRD Challenger Review: ship-from-repo (Round 3)
Date: 2026-10-21
PRD: docs/prd/ship-from-repo.md
Prior reviews: docs/reviews/ship-from-repo-prd-review-round1.md, docs/reviews/ship-from-repo-prd-review-round2.md

## Verdict
escalate_to_human

Round 3 was explicitly requested by the human product owner (this is the only authority for a round beyond 2). Scope is **delta-only**: `git diff cc660e1..HEAD -- docs/prd/ship-from-repo.md`
(commits 86fa322, 2b4cc1e), checked against the surrounding FRs/NFRs and against the code the new ACs lean on (`services/infrastructureService.js#getAKSInstalledApps`,
`routes/api.js` `/aks-apps`, `services/aksService.js`, `srcV2/stores/navigation.ts`). The product-owner decisions themselves (dedicated page, manual re-ship, auto-ship deferred,
AKS pages untouched, persona rename) are treated as settled; the findings are about how well they are specified and whether they contradict the rest of the PRD.
Because Blocking findings exist after the round-2 limit, the decision rules require escalation: no further automatic round.

Mechanical check: `validate-delivery-contract.mjs prd` on HEAD → `CONTINUE / PRD_VALID` (16 FR, 12 NFR). §13 counts are re-verified (see Round Context) and correct.

## Blocking Findings

- [ ] **B-1 "Update settings" runs outside the serialized section and contradicts AC-008-6 / AC-012-2 / OQ-3** — AC-012-3 vs AC-008-6, AC-007-7, AC-012-2, §12 test (d) — AC-008-6 says "no downgrade"
  is *"guaranteed by running inside the serialized section (AC-007-7)"*. AC-012-3 instead has the backend dispatch `generate-webapp-config` **directly** via `services/aksService.js`, which is not
  inside the `ship-<app>` concurrency group. An Update settings click during an in-flight ship (or right after a publish) can write a stale "currently deployed tag" and downgrade the PR tag; "currently
  deployed" is also undefined (open-PR branch tag? main? Flux-updated tag? `meta.image_tag` in metadata, which Flux does not update?). Post-merge it also does exactly what AC-012-2 forbids
  ("does NOT run `generate-webapp-config` … to avoid overwriting Flux-updated tags"), with no statement of how Flux-bumped tags are preserved; and it is not in OQ-3's scope. The §12 downgrade test (d) covers only re-ship.
  **Fix:** either (a) route Update settings through the same ship workflow in a config-only mode inside `concurrency: ship-<app>` so AC-008-6/AC-007-7 apply unchanged, or (b) add explicit ACs:
  it takes the same concurrency lock and is rejected with a plain message while a ship for the app is queued/running; "currently deployed tag" is defined as the max semver of the tag on the open PR branch (if any) and on aya-flux
  `main`; post-merge behavior is stated (opens a reviewed PR that carries that tag, and Flux's later bump wins/never lowered); add test (f) "Update settings during in-flight ship and after Flux bump never lowers the tag".

- [ ] **B-2 "Update settings" has no authorization, tracking, audit, failure UX or tests** — AC-012-3 vs FR-016, FR-013, FR-014, FR-011, §12 — A new user-visible action that dispatches a workflow
  that mutates an aya-flux PR for a running app is specified only as "dispatches generate-webapp-config … opens/updates the PR". Missing: (1) who may click it — FR-016 (repo-read + first-repo ownership,
  AC-016-2/-3/-4) is enforced in `prepare`/`publish`, which Update settings never passes through, so as written any authenticated user could change another team's app's port/health path via the dispatch;
  (2) `triggered_by` and correlation ID/run-name so it is lookup-able by FR-013 (AC-013-3 resolves ship runs by `run-name`; `aksService.searchWorkflowByCorrelationId` is a job-log search), and whether stage list/AC-013-6 authorization apply;
  (3) audit — AC-014-6 scopes audit to "dispatched ships" and does not say Update settings counts; (4) failure UX — FR-011 has no code or message for a failed settings update
  (AC-011-1a lists `CONFIG_PR_FAILED` as "retry-config-only" for ships, i.e. re-run with an existing image, not an arbitrary settings change); (5) input validation (AC-002-3 port/health path), and that AC-008-1's "always empty"
  `kv_secrets/env_vars/workload_identity_grants` are preserved/emptied rather than wiping whatever someone set through the AKS playground (AC-015-4 explicitly accepts that those pages can still edit the same app);
  (6) no acceptance test in §12 or §11.
  **Fix:** add a short ACs block under FR-012 (or a new FR-012a): authorization = same FR-016 checks as ship with 403/`APP_OWNED_BY_OTHER`/`REPO_NOT_ACCESSIBLE` mapping; server-set `triggered_by` + correlation ID returned by the API and shown in the same progress view;
  audit scope extended in AC-014-6; a named failure code (or explicit reuse of `CONFIG_PR_FAILED` with message "Settings were not updated; the running version is unchanged") in FR-011 and AC-011-1a; validation reusing AC-002-3; explicit statement on secrets/env fields; and E2E + authorization tests in §12.

- [ ] **B-3 "My shipped apps" data source cannot satisfy AC-015-1, and "apps created by this feature" has no testable identification** — AC-015-1/-2, §8 Data Contracts, §5 — (1) `getAKSInstalledApps` reads
  `selfserve-metadata/` at `ref: main` only. AC-015-1 promises per app "PR state (open/merged/closed)" and "preview URL while the PR is open", i.e. apps whose PR is still **open**, which by definition are not on `main`;
  as written the main-branch list cannot show the primary pre-merge usage (FR-012's "main usage pattern") and no AC says where open-PR apps come from. (2) The existing metadata has no source repo, branch, or "shipped by this feature"
  field (the normalised shape is project/appname/namespace/environment/imageName/imageTag/port/healthPath/teamLabel/owner(=triggered_by)/…); AC-015-2 leaves "filtered to apps created by this feature" as "any metadata field additions … scoped by the Architect".
  Nothing says who writes those fields (the cross-repo aya-flux `generate-webapp-config` is not given `source_repo`/`branch` inputs in AC-008-1, and is not in FR-015 Dependencies), so the filter predicate, the "Ship new version" prefill (AC-012-6: same repo, branch, settings) and the
  "latest shipped version" column (metadata `image_tag` vs highest ACR tag after Flux rolls) are all unverifiable. (3) "Mine" is ambiguous: `owner` = `triggered_by` (the last clicker), whereas FR-016 authorizes by source-repo read — a
  user who can read the repo but did not trigger the ship, and legacy/BYO-image apps with no ship history, have no defined inclusion rule. (4) `/api/aks-apps` returns every app to any authenticated user today; the new list is a separate endpoint but no AC requires server-side filtering.
  **Fix:** make the contract explicit in the PRD (not deferred): name the metadata fields (e.g. `meta.source_repo`, `meta.source_branch`, `meta.shipped_by = "ship-from-repo"`), assign the aya-flux writer (add to AC-008-1 inputs and FR-015 Dependencies), define the filter as
  "`shipped_by` marker present AND requester has read on `source_repo` (FR-016 check)", state that apps with an open PR and no merged metadata are sourced from the `auto/gen-<env>-<app>` PR branch (or explicitly drop open-PR rows/preview URL from AC-015-1),
  define "version" (max semver of tag on main vs PR) and add a test: user B cannot see user A's private-repo app; legacy/BYO apps are excluded; a ship with an open PR appears with PR state `open` and preview URL.

- [ ] **B-4 "My shipped apps" is outside the NFR-011 / NFR-002 budget and its per-row authorization cost is unbounded** — AC-015-1/-2 vs NFR-011, NFR-002, AC-016-2 — `getAKSInstalledApps` is uncached and costs
  1 + N `getContent` calls where N = **all** AKS apps on the platform; AC-015-1 adds one PR-state read per app and AC-015-2 adds a per-app FR-016 repo-read check for the requester. None of this appears in NFR-011 (the per-ship ceiling of 200 explicitly counts only ship lifecycle calls, and the 5-min cache
  list covers only repo/branch lists), no latency target exists for the list in NFR-002, and the page loads the list whenever the page is opened — including by every viewer on every visit. With the 2 400 calls/h ship budget at 48% of 5 000, an N=100-app list refreshed by a few users can silently consume the remaining headroom,
  which is the exact failure the Round 2 B-6 fix was meant to prevent. The same list also reloads after each ship/Update settings (state change), multiplying cost.
  **Fix:** add to NFR-011: list endpoint is single-flight cached (suggest TTL 60 s, bypass-once after the user's own ship/update), enumerates the contents once, uses a metadata-only read (no per-app PR/permission call on the hot path; PR state and repo-read results come from a bounded, cached batch or are fetched lazily for visible rows only), with an explicit per-refresh call ceiling as a function of N and a guard when `x-ratelimit-remaining` < 1 000. Add a p95 latency target (e.g. ≤ 3 s for N ≤ 100) to NFR-002 and a rate-limit test to §12.

- [ ] **B-5 AC-001-8 "simple by default" contradicts other ACs and is not objectively testable** — AC-001-8 vs AC-012-2, AC-011-2, AC-013-4, AC-013-1, FR-002 — (1) AC-001-8 forbids the terms "image tag, HelmRelease, Flux, namespace" outside Advanced/Details, but AC-012-2 mandates the UI text
  "Flux will roll out version X.Y.Z automatically", AC-013-4's default final summary shows "image reference, digest, PR link", AC-011-2 shows the "failing buildpack id", AC-011-10 names LFS/submodules, and AC-013-1 shows stage names Prepare/Build/Scan/Publish/Config PR which differ from AC-001-8's plain-language
  stages ("Building → Checking security → Publishing → Preview ready"). (2) The forbidden-term list is open-ended ("platform terms (…)"), so a test cannot determine pass/fail. (3) AC-001-8's "first view asks only for repo, branch and app name" omits FR-002's **team label** and **environment**
  (AC-002-1 environment choices; AC-008-1 requires `teamLabel`), which are not listed under Advanced either — so either the first view asks for more than AC-001-8 allows or the ship cannot be dispatched. (4) AC-001-7/-8 also say the page "shows the whole lifecycle", but no AC says what the page shows when the list is empty, still loading, or the user has no ship-enabled environment.
  **Fix:** replace the open term list with a closed, test-friendly one (e.g. a `forbiddenTerms` constant: `image tag`, `HelmRelease`, `Flux`, `ACR`, `namespace`, `digest`, `buildpack`, `aya-flux`) and an explicit allowed-location rule ("only inside the collapsed Advanced/Details panels and the copy-details payload");
  rewrite AC-012-2's message ("Your new version X.Y.Z will go live automatically"), map AC-013-1's seven backend stages to the four plain-language labels in one table and state which view uses which; say where team label and environment appear (default environment `devsand`, team label default/derivation or under Advanced); add empty/loading/disabled states for the page. Accept with a Vitest assertion over rendered default-view text.

## Advisory Findings

- **Navigation/deep-link mechanism** — AC-001-7 / AC-013-3 — The app has no vue-router; `navigation.ts` is a `PageId` store (spec file enumerates the IDs). AC-013-3 relies on "correlation ID in the URL" for refresh/reopen and AC-013-5 on returning to a ship; adding `'ship'` also needs `navigation.spec.ts`, the home-card and `App.vue` render branch updates. State how the correlation ID is carried (query string/hash handled by the store) so it is testable.
- **Shipped apps editable through the AKS page** — AC-015-4 / §8 — Accepted by the product owner, but then a BYO redeploy of a shipped app (any authenticated user, no ownership check) can change image/tag/port, making list data and the AC-012-6 prefill stale, and can bump a higher semver than the Flux ImagePolicy expects. Add a Risk entry (R-n) and, ideally, a Ship-page notice when metadata `imageName` != `selfserve/<app>`.
- **AC-012-6 prefill source** — "same repo, branch, app name and settings pre-filled" is on the *result* page; from "My shipped apps" it depends on B-3's metadata fields. State the fallback when the fields are missing (blank form with app name locked). Also state that Ship new version runs the full FR-016 checks again (it does via `prepare`, but the API fast-fail path should be named).
- **AC-012-6 timing copy** — "Push your code to `<branch>`, then click Ship new version" gives no cue that the platform builds the **latest commit of the branch at click time** (SHA is pinned then, AC-014-1). Add a one-line statement so Sam does not expect an old commit.
- **FR-015 priority `should` vs AC-001-7** — AC-001-7 puts the list in the "whole ship lifecycle … happens on this page" and AC-012-6/AC-012-3 actions are surfaced from it; if FR-015 is cut, Update settings and prefilled Ship new version from the list have no entry point. Either raise FR-015 to `must` (§13 priority split becomes must 16 / should 0) or state the fallback entry point on the result page.
- **§5 classification of FR-015** — `new-feature (reuses backend read path)` is defensible, but AC-015-2 modifies `getAKSInstalledApps`/metadata (field additions) and needs an aya-flux workflow change; `existing-extend` for the read path plus new UI would be more truthful. Not blocking because the classification evidence is real and the §13 counts match the matrix. Also add an "Update settings" row (FR-012, `existing-extend`) to §5.
- **FR-011 empty/error state for the list** — beyond B-2/B-4: a metadata read failure (`getAKSInstalledApps` swallows errors and returns `[]`, so a GitHub outage looks like "you have no shipped apps") needs a distinct error state; require the new endpoint to surface `PLATFORM_RATE_LIMITED`/error rather than an empty list.
- **Status vs marker (carried from Round 2)** — Metadata Status is `review` (OQ-1 open) while the `ORCHESTRATOR-READY` marker says `status: approved`. The marker is validator-driven, not a sign-off; the Orchestrator must not read it as clearing OQ-1 or this round's escalation.
- **OQ-21** — Fine as a non-blocking post-MVP question; add "authorization of a webhook-triggered ship (no human click, FR-016) and Wiz/API budget" — the entry already lists most of them. No change required for MVP.
- **Persona wording** — "limited platform knowledge" is consistent in §2, FR-011 rationale, NFR-010 (NFR-010's "5 users … without assistance" is testable; add "Sam-profile recruiting criteria" for the usability test).
- **Carried from Round 2 (still open):** AC-013-5 `should`/`must` split; NFR-011 single-replica precondition in the Architect spec; `build` job artifact-channel case in the hostile-repo test; third simultaneous ship cancellation vs user cancel.

## Round Context
Round 3 = delta-only review at the human product owner's explicit request. Round 1/2 Blocking items B-1..B-6 are not re-opened; the delta does not undo them, **except** that AC-012-3 (Update settings) bypasses the AC-008-6/AC-007-7 serialization and the FR-016 authorization model they established (B-1, B-2 here), and FR-015's new list is outside the NFR-011 budget fixed in Round 2 (B-4).

Specific checks requested:
- **Testability of new ACs** — AC-001-7 is objectively testable (route/PageId/home card present; AKS pages unchanged — verify by diff). AC-015-4 testable by diff. AC-012-6 testable for the button and static copy, not for prefill source (Advisory). AC-001-8 and AC-015-2 are **not** testable as written (B-5, B-3). AC-012-3 is not testable for "never lower" (B-1).
- **Contradictions** — AC-012-3 vs AC-008-6 / AC-012-2 / OQ-3 (B-1); AC-001-8 vs AC-012-2/AC-013-4/AC-011-2/FR-002 (B-5); AC-015-1 (open PR) vs `getAKSInstalledApps` main-only read (B-3); AC-015-2 "readable by the requester (FR-016)" vs `triggered_by` ownership (B-3).
- **FR-016 for Update settings and the list filter** — not specified (B-2, B-3).
- **NFR-011 for the new list** — not budgeted (B-4).
- **Failure UX in FR-011 for new actions** — Update settings has none (B-2); list error/empty state has none (Advisory); Ship new version reuses ship failures (acceptable).
- **§13 counts/classifications** — verified: 16 FR, 12 NFR; `new-feature` 12 (001, 003, 004, 005, 006, 007, 009, 010, 011, 014, 015, 016) = 12 ✓; `existing-extend` 4 (002, 008, 012, 013) ✓; 12 + 4 = 16 ✓; priority must 15 / should 1 ✓ (stale only if FR-015 is raised, Advisory). The §5 FR-015 reclassification matches §13. §15 revision log rows for both product-owner commits are present.

Escalation: Blocking count 5 after Round 2 limit → `escalate_to_human`. The product owner should decide whether to (i) accept the PRD with these risks recorded, (ii) have the PM revise B-1…B-5 and have a human-initiated Round 4 delta check, or (iii) descope Update settings / the list for MVP to keep the original, reviewed FR-012/FR-015 boundaries.

<!-- CHALLENGER-VERDICT
feature: ship-from-repo
round: 3
verdict: escalate_to_human
blocking_count: 5
advisory_count: 11
-->
