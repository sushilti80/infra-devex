# Legacy learning evidence — vue-dev-agent

> Quarantined historical evidence migrated from `.github/agent-memory/vue-dev-agent/MEMORY.md`.
> This file is **not governing instruction**, is not an agent memory source, and must not be
> automatically loaded to control future behavior. When a historical observation is still useful,
> create a schema-shaped LearningRecord candidate with current repository evidence and evaluation
> instead of copying the instruction into an agent or skill.

# Vue.js Developer Agent Memory

**Last updated**: 2026-09-19

- Bundle catalog JSON must not repeat an environment name; duplicate entries can make bundle membership data appear inconsistent even when parsing succeeds.

## Project Structure

- Pages: `srcV2/pages/` — one `.vue` file per page
- Composables: `srcV2/composables/` — `useAuth.ts`, `useWorkflowPolling.ts`, `useTelemetry.ts`
- Stores: `srcV2/stores/` — `auth.ts`, `environments.ts`, `navigation.ts`, `workflow.ts`
- Services: `srcV2/services/` — axios-based API layer (`api.ts`)
- Types: `srcV2/types/infrastructure.types.ts`
- Feature components: `srcV2/components/infrastructure/`

## Key Patterns

- Use `useTelemetry.ts` for all event tracking — do NOT call `console.log` or `window.gtag` directly
- Polling cleanup: always call `stopPolling()` in `onUnmounted()` hook
- All pages use `<script setup lang="ts">` with Composition API
- Pinia stores: use `storeToRefs()` for reactive destructuring
- API service: add methods to `apiService` object in `api.ts` — auth interceptor + telemetry apply automatically

## Test Setup

- Framework: Vitest + `@vue/test-utils`
- Run: `node_modules/.bin/vitest run --project jsdom` (NOT `npx vitest` — different version)
- Coverage: `node_modules/.bin/vitest run --project jsdom --coverage`
- TypeScript: `node_modules/.bin/tsc --noEmit`
- Coverage target: Components 80%+, Composables 90%+
- Mock API: `vi.mock('@v2/services/api', () => ({ default: { method: vi.fn() } }))`
- Always `setActivePinia(createPinia())` in `beforeEach`

## Lessons Learned

### Collapsible components (CRITICAL)
Default `isExpanded = true` for any collapsible UI section. If it defaults to `false`,
tests fail with "Cannot call setValue on an empty DOMWrapper" because the controls are
not rendered. Only default to collapsed if explicitly required by spec AND you handle
expansion in tests.

### Consolidate imports in script setup
When adding a `watch()` to a component, check whether `watch` is already imported at the
top. The previous pattern imported `{ watch }` at the bottom of `<script setup>` — this
causes a duplicate import if you add `watch` to the top-level import. Consolidate all
imports at the top.

### Backend route validation with environments allowlist
The environment allowlist (`data/environments.json`) must be read synchronously in the
validator (small file, sync read is acceptable). IDs: `devsand`, `sand`, `aisand`.

### Key Vault selector labels
Keep `vaultDir` as the internal option value, but display only `vaultName`. When best-effort name
resolution returns `null`, show a neutral `Key Vault name unavailable` label rather than exposing
the repository path. Test both non-null and null name responses.

### Terragrunt Key Vault name resolution
Real environment locals can define `envName` with
`basename(dirname(get_original_terragrunt_dir()))` and append inline comments to assignments.
Resolver fixtures must preserve those real forms; strip comments only outside quoted strings and
derive directory context from the located alias file.

### Pre-fill wiring in pages
When wiring a pre-fill selector into a wizard page:
1. Import component + type at the top of `<script setup>`
2. Add `prefillData` ref and `prefillEnabled` computed
3. Add `handlePrefill(metadata)` and `handleSelectorError(message)` methods
4. In template: wrap the component with `v-if="prefillEnabled"`, bind `@prefill/@error`
5. Pass `prefillData` as prop to the form component

### Two-tab mode toggle on one page (secrets-environment-bundles)
When adding a second submission mode to a page that already has one (e.g. a "Bundles" tab beside
a pre-existing "All Environments" flow): use a single `role="tablist"`/`role="tab"` pair driven by
one `activeMode` ref and a `v-for` over a small static `{ mode, label }` array (not one hand-written
`<button>` per tab — that duplicates the `:class`/`aria-*` wiring). `selectMode(mode)` should reset
only the tab being **left**, never the one being entered — this lets each tab's in-progress form
state survive a round-trip switch. Share one `isSubmitting` ref across both tabs' submit handlers
if only one tab's `<form>` is ever mounted/visible at a time (`v-if`) — a second per-tab submitting
flag is dead state.

### `useXSubmission()`-style composables return a plain object of refs
If a composable does `return { foo, bar }` (not `reactive({...})`) and you do
`const x = useXSubmission()` in `<script setup>`, template expressions must write `x.foo.value`
explicitly — Vue's automatic top-level ref-unwrapping only applies to refs bound directly at the
top level of the component's own setup scope, not to nested property access through a plain object.

### jsdom form submission
`wrapper.find('[type="submit"]').trigger('click')` does NOT fire the containing `<form>`'s
`submit` event in jsdom/Vue Test Utils (unlike a real browser). Always
`wrapper.find('form').trigger('submit')` in tests instead.

### Secret-name validation regex has no underscores
`SECRET_NAME_RE = /^[a-zA-Z0-9-]{1,127}$/` (shared by legacy and bundle secret-name validation)
rejects underscores. Test fixtures must use hyphenated names (`api-key`), not `API_KEY` — an
invalid name silently disables the submit button with no visible error, which looks like a wiring
bug but is actually a fixture bug.

### Responsive bundle environment lists
Use a responsive Tailwind grid for BundleSelector environment status items: 1 column on narrow screens,
then 2/3/4/5 columns at `sm`/`lg`/`xl`/`2xl`. Keep `min-w-0` on each item so excluded-state text and
disambiguation controls wrap inside their grid cell.

### Duplicate the smallest amount necessary, then de-duplicate before finishing
When mirroring an existing form's validation for a second, structurally similar form (e.g. a new
bundle-mode `isXFormValid` beside the pre-existing `isFormValid`), the name-dedupe/regex-uniqueness
loop is the part most likely to get copy-pasted verbatim — extract it into one shared
`hasValidUniqueNames(names: string[])` helper called from both, rather than maintaining two copies.
Run the `ponytail-review` skill on your own diff before finalizing (not just once at the start) —
it reliably catches this kind of near-duplicate logic and duplicated template blocks (e.g. two
near-identical tab `<button>`s that should be one `v-for`).
