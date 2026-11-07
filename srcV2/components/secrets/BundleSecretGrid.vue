<script setup lang="ts">
/**
 * secrets-environment-bundles (spec.md §2.7): secretName x eligible-environment grid used by the
 * "Bundles" tab of SecretsPage.vue. Rows are secret names (added/removed once, shared across the
 * bundle — mirrors the legacy `secretEntries` add/remove convention); columns are the eligible
 * environments resolved by `useBundleSubmission`. Each cell is an independent
 * `{ value, confirmation }` pair (FR-006(c)/(d)): a value is never copied across environments and
 * each cell's match is validated independently, not once globally.
 *
 * Accessibility (Round 1 Advisory A3): a semantic `<table>` with native `<input>` elements and a
 * visually-hidden `<label>` per input, instead of a hand-rolled ARIA grid — see spec.md §2.7 for
 * the rationale (native Tab/Shift+Tab cell traversal, no roving-tabindex code needed).
 */
const MAX_SECRET_ROWS = 20

interface GridCell {
  value: string
  confirmation: string
}

const props = defineProps<{
  secretNames: string[]
  environments: string[]
  gridValues: Record<string, Record<string, GridCell>>
  isCellValid: (secretName: string, environment: string) => boolean
}>()

const emit = defineEmits<{
  'add-row': []
  'remove-row': [index: number]
  'rename-row': [payload: { index: number; name: string }]
  'update-cell': [payload: { secretName: string; environment: string; field: 'value' | 'confirmation'; value: string }]
}>()

function cellValue(name: string, environment: string, field: keyof GridCell): string {
  return props.gridValues[name]?.[environment]?.[field] ?? ''
}

function onRename(index: number, event: Event): void {
  emit('rename-row', { index, name: (event.target as HTMLInputElement).value })
}

function onCellInput(name: string, environment: string, field: 'value' | 'confirmation', event: Event): void {
  if (!name.trim()) return
  emit('update-cell', { secretName: name, environment, field, value: (event.target as HTMLInputElement).value })
}

function onAddRow(): void {
  emit('add-row')
}

function onRemoveRow(index: number): void {
  emit('remove-row', index)
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="environments.length === 0" data-testid="bundle-grid-empty" class="text-sm text-gray-500 dark:text-gray-400">
      Resolve at least one eligible environment before entering secret values.
    </p>

    <div v-else class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table data-testid="bundle-secret-grid" class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <caption class="sr-only">Secret values per environment for this bundle submission</caption>
        <thead class="bg-gray-50 dark:bg-gray-900">
          <tr>
            <th scope="col" class="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Secret name
            </th>
            <th
              v-for="environment in environments"
              :key="environment"
              scope="col"
              class="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
            >
              {{ environment }}
            </th>
            <th scope="col" class="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
          <tr v-for="(name, index) in secretNames" :key="index" data-testid="bundle-secret-row">
            <th scope="row" class="px-3 py-2 align-top">
              <label :for="`bundle-secret-name-${index}`" class="sr-only">Secret name, row {{ index + 1 }}</label>
              <input
                :id="`bundle-secret-name-${index}`"
                data-testid="bundle-secret-name-input"
                :value="name"
                autocomplete="off"
                class="w-40 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                placeholder="SECRET_NAME"
                @input="onRename(index, $event)"
              />
            </th>
            <td
              v-for="environment in environments"
              :key="environment"
              :data-testid="`bundle-cell-${index}-${environment}`"
              class="px-3 py-2 align-top"
            >
              <div class="space-y-1">
                <div>
                  <label :for="`bundle-cell-value-${index}-${environment}`" class="sr-only">{{ name || 'Secret' }} value for {{ environment }}</label>
                  <input
                    :id="`bundle-cell-value-${index}-${environment}`"
                    :data-testid="`bundle-cell-value-${index}-${environment}`"
                    type="password"
                    autocomplete="new-password"
                    :value="cellValue(name, environment, 'value')"
                    :aria-invalid="!isCellValid(name, environment)"
                    class="w-36 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                    placeholder="Value"
                    @input="onCellInput(name, environment, 'value', $event)"
                  />
                </div>
                <div>
                  <label :for="`bundle-cell-confirmation-${index}-${environment}`" class="sr-only">{{ name || 'Secret' }} confirmation for {{ environment }}</label>
                  <input
                    :id="`bundle-cell-confirmation-${index}-${environment}`"
                    :data-testid="`bundle-cell-confirmation-${index}-${environment}`"
                    type="password"
                    autocomplete="new-password"
                    :value="cellValue(name, environment, 'confirmation')"
                    :aria-invalid="!isCellValid(name, environment)"
                    class="w-36 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                    placeholder="Confirm"
                    @input="onCellInput(name, environment, 'confirmation', $event)"
                  />
                </div>
                <p v-if="!isCellValid(name, environment)" role="alert" class="text-xs text-red-600 dark:text-red-400">
                  Values do not match.
                </p>
              </div>
            </td>
            <td class="px-3 py-2 align-top">
              <button
                type="button"
                data-testid="bundle-remove-secret"
                :disabled="secretNames.length <= 1"
                class="text-sm text-red-600 disabled:cursor-not-allowed disabled:text-gray-400"
                @click="onRemoveRow(index)"
              >
                Remove
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <button
      type="button"
      data-testid="bundle-add-secret"
      :disabled="secretNames.length >= MAX_SECRET_ROWS"
      class="inline-flex min-h-11 items-center rounded-md border border-blue-600 px-4 py-2 font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400 dark:hover:bg-blue-900/20"
      @click="onAddRow"
    >
      Add Secret
    </button>
  </div>
</template>
