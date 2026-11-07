<script setup lang="ts">
import { computed } from 'vue'
import type { BundleCatalogEntry } from '@v2/types/infrastructure.types'
import type { BundleDisambiguation, BundleEligibilityStatus, BundleExcludedCandidates } from '@v2/composables/useBundleSubmission'

interface AppEnvironmentEntry {
  environment: string
  bundleId: string | null
}

const props = defineProps<{
  bundles: BundleCatalogEntry[]
  /** The subset of GET /api/secrets/apps' `data[]` entries for the currently selected app —
   * spec.md §2.2's `bundleEnvironmentsForApp()` is a pure client-side filter of this array. */
  appEnvironments: AppEnvironmentEntry[]
  selectedBundleId: string
  eligibility: Record<string, BundleEligibilityStatus>
  exclusionReason: Record<string, string>
  excludedCandidates: Record<string, BundleExcludedCandidates>
}>()

const emit = defineEmits<{
  'update:selectedBundleId': [bundleId: string]
  disambiguate: [payload: { environment: string; vaultDir?: string; qualifier?: string }]
}>()

function environmentsForBundle(bundleId: string): string[] {
  return props.appEnvironments.filter(entry => entry.bundleId === bundleId).map(entry => entry.environment)
}

/** FR-002(f): a bundle tab is shown only when at least one of its declared environments is
 * actually deployed for the selected app. */
const availableBundles = computed(() =>
  [...props.bundles]
    .filter(bundle => environmentsForBundle(bundle.id).length > 0)
    .sort((a, b) => a.order - b.order)
)

const selectedBundle = computed(() => availableBundles.value.find(bundle => bundle.id === props.selectedBundleId))

const selectedBundleEnvironments = computed(() =>
  props.selectedBundleId ? environmentsForBundle(props.selectedBundleId) : []
)

function onBundleChange(event: Event): void {
  emit('update:selectedBundleId', (event.target as HTMLSelectElement).value)
}

function onDisambiguate(environment: string, event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return
  const [kind, ...rest] = value.split(':')
  const candidate = rest.join(':')
  if (kind === 'vault') emit('disambiguate', { environment, vaultDir: candidate })
  else if (kind === 'qualifier') emit('disambiguate', { environment, qualifier: candidate })
}
</script>

<template>
  <div class="space-y-3">
    <div>
      <label for="bundle-select-input" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Bundle</label>
      <select
        id="bundle-select-input"
        data-testid="bundle-select"
        :value="selectedBundleId"
        class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
        @change="onBundleChange"
      >
        <option value="" disabled>Select a bundle</option>
        <option v-for="bundle in availableBundles" :key="bundle.id" :value="bundle.id">{{ bundle.displayName }}</option>
      </select>
    </div>

    <p
      v-if="selectedBundle?.releaseControlled"
      data-testid="bundle-release-indicator"
      class="inline-flex items-center rounded-md bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-200"
    >
      [RELEASE]
    </p>

    <ul v-if="selectedBundle" class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      <li
        v-for="environment in selectedBundleEnvironments"
        :key="environment"
        data-testid="bundle-environment-status-row"
        class="min-w-0 rounded-md border border-gray-200 p-2.5 text-sm dark:border-gray-700"
      >
        <template v-if="eligibility[environment] === 'excluded'">
          <div data-testid="bundle-excluded-environment" class="space-y-1.5">
            <p class="font-medium text-gray-800 dark:text-gray-200">{{ environment }} — excluded</p>
            <p class="text-red-700 dark:text-red-300" role="status">{{ exclusionReason[environment] }}</p>
            <label :for="`bundle-disambiguation-${environment}`" class="sr-only">Disambiguate {{ environment }}</label>
            <select
              :id="`bundle-disambiguation-${environment}`"
              data-testid="bundle-disambiguation-select"
              class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              @change="onDisambiguate(environment, $event)"
            >
              <option value="" disabled selected>Choose one to disambiguate…</option>
              <option v-for="vault in excludedCandidates[environment]?.vaults || []" :key="`vault-${vault.vaultDir}`" :value="`vault:${vault.vaultDir}`">
                {{ vault.vaultName || vault.vaultDir }}
              </option>
              <option v-for="qualifier in excludedCandidates[environment]?.qualifiers || []" :key="`qualifier-${qualifier}`" :value="`qualifier:${qualifier}`">
                {{ qualifier }}
              </option>
            </select>
          </div>
        </template>
        <template v-else>
          <span class="font-medium text-gray-800 dark:text-gray-200">{{ environment }}</span>
          <span class="ml-2 text-gray-500 dark:text-gray-400">
            {{ eligibility[environment] === 'eligible' ? 'Eligible' : 'Checking…' }}
          </span>
        </template>
      </li>
    </ul>
  </div>
</template>
