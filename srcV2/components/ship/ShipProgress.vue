<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ShipStageState, ShipStatus } from '@v2/types/ship.types'
import { toDisplayStages } from '@v2/utils/shipHelpers'

/** S5: five-label progress (AC-001-8 / AC-013-1); internal stages and the correlation ID only inside Details. */
const props = defineProps<{ status: ShipStatus; cancelling?: boolean }>()
const emit = defineEmits<{ (e: 'cancel'): void }>()

const showDetails = ref(false)
const display = computed(() => toDisplayStages(props.status.stages))

const STATE_TEXT: Record<ShipStageState, string> = {
  pending: 'Waiting', running: 'In progress', succeeded: 'Done', failed: 'Failed', skipped: 'Skipped'
}
const INTERNAL_LABEL: Record<string, string> = {
  queued: 'Queued', prepare: 'Prepare', build: 'Build', scan: 'Scan', publish: 'Publish', config_pr: 'Config PR', preview: 'Preview URL'
}

const current = computed(() => display.value.find(s => s.state === 'running') ?? display.value.find(s => s.state === 'pending'))
const liveText = computed(() => (current.value ? `${current.value.label}: ${STATE_TEXT[current.value.state]}` : 'All steps finished'))
const publishStarted = computed(() => (props.status.stages.find(s => s.id === 'publish')?.state ?? 'pending') !== 'pending')
const canCancel = computed(() => !props.status.terminal && (props.status.state === 'queued' || props.status.state === 'running') && !publishStarted.value)

const icon = (s: ShipStageState) => ({ pending: 'radio_button_unchecked', running: 'progress_activity', succeeded: 'check_circle', failed: 'error', skipped: 'remove_circle_outline' }[s])
const tone = (s: ShipStageState) => ({
  pending: 'text-gray-400', running: 'text-blue-600 dark:text-blue-400', succeeded: 'text-green-600 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400', skipped: 'text-gray-400'
}[s])
</script>

<template>
  <section aria-labelledby="ship-progress-title" class="space-y-4">
    <h2 id="ship-progress-title" class="text-xl font-semibold text-gray-900 dark:text-white">
      Shipping {{ status.app }}
    </h2>

    <div aria-live="polite" role="status" class="sr-only" data-testid="ship-live">{{ liveText }}</div>

    <ol class="space-y-2" data-testid="ship-stages">
      <li v-for="s in display" :key="s.label" class="flex items-center gap-3" :data-state="s.state">
        <span :class="['material-symbols-outlined', tone(s.state), s.state === 'running' ? 'animate-spin' : '']" aria-hidden="true">{{ icon(s.state) }}</span>
        <span class="text-gray-900 dark:text-white font-medium">{{ s.label }}</span>
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ STATE_TEXT[s.state] }}</span>
      </li>
    </ol>

    <p v-if="status.queuedBehind" class="text-sm text-gray-600 dark:text-gray-400">Queued behind another ship of this app.</p>
    <p v-if="cancelling" class="text-sm text-gray-600 dark:text-gray-400" role="status">Cancelling…</p>

    <div class="flex flex-wrap items-center gap-3">
      <button
        v-if="canCancel"
        type="button"
        :disabled="cancelling"
        class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        :aria-expanded="showDetails"
        aria-controls="ship-progress-details"
        @click="showDetails = !showDetails"
      >
        {{ showDetails ? 'Hide details' : 'Details' }}
      </button>
    </div>

    <div v-if="showDetails" id="ship-progress-details" class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3" data-testid="ship-details">
      <p class="text-sm text-gray-700 dark:text-gray-300">Correlation ID: <code class="break-all">{{ status.correlationId }}</code></p>
      <ul class="text-sm text-gray-700 dark:text-gray-300 space-y-1">
        <li v-for="s in status.stages" :key="s.id">{{ INTERNAL_LABEL[s.id] ?? s.id }}: {{ STATE_TEXT[s.state] }}</li>
      </ul>
      <slot name="details-extra" />
    </div>
  </section>
</template>
