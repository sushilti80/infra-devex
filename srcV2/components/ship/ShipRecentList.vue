<script setup lang="ts">
import type { RecentShipEntry } from '@v2/types/ship.types'
import type { RecentRowState } from '@v2/stores/ship'
import { safeHttpsUrl } from '@v2/utils/shipHelpers'

/** FR-015 recent ships. Everything from localStorage renders as text (never v-html). */
defineProps<{ entries: RecentShipEntry[]; states: Record<string, RecentRowState> }>()
const emit = defineEmits<{
  (e: 'open', correlationId: string): void
  (e: 'retry', correlationId: string): void
  (e: 'remove', correlationId: string): void
  (e: 'clear'): void
}>()

const RUN_TEXT: Record<string, string> = { queued: 'Queued', running: 'In progress', succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled' }
const when = (iso: string) => new Date(iso).toLocaleString()
</script>

<template>
  <section aria-labelledby="ship-recent-title" class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 id="ship-recent-title" class="text-lg font-semibold text-gray-900 dark:text-white">Recent ships</h2>
      <button v-if="entries.length" type="button" class="text-sm text-gray-600 dark:text-gray-400 hover:underline" @click="emit('clear')">Clear list</button>
    </div>

    <p v-if="!entries.length" class="text-sm text-gray-600 dark:text-gray-400">Ships you start will appear here.</p>

    <ul v-else class="divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
      <li v-for="e in entries" :key="e.correlationId" class="flex flex-wrap items-center justify-between gap-2 p-3" :data-cid="e.correlationId">
        <div class="min-w-0">
          <button
            type="button"
            class="font-medium text-blue-600 dark:text-blue-400 hover:underline text-left focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            :disabled="states[e.correlationId]?.state === 'unavailable'"
            @click="emit('open', e.correlationId)"
          >{{ e.app }}</button>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ e.branch }} · {{ when(e.startedAt) }}</p>
        </div>

        <div class="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-3">
          <template v-if="states[e.correlationId]?.state === 'unavailable'">
            <span>No longer available</span>
            <button type="button" class="text-blue-600 dark:text-blue-400 hover:underline" @click="emit('remove', e.correlationId)">Remove</button>
          </template>
          <template v-else-if="states[e.correlationId]?.state === 'error'">
            <span>Couldn't load status — try again</span>
            <button type="button" class="text-blue-600 dark:text-blue-400 hover:underline" @click="emit('retry', e.correlationId)">Try again</button>
          </template>
          <template v-else-if="e.terminal">
            <span>{{ RUN_TEXT[e.terminal.state] }}<template v-if="e.terminal.version"> · {{ e.terminal.version }}</template></span>
            <a v-if="safeHttpsUrl(e.terminal.prUrl)" :href="safeHttpsUrl(e.terminal.prUrl)!" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">PR</a>
          </template>
          <template v-else-if="states[e.correlationId]?.state === 'loading'"><span>Checking…</span></template>
          <template v-else-if="states[e.correlationId]?.runState"><span>{{ RUN_TEXT[states[e.correlationId].runState!] }}</span></template>
          <template v-else><span>In progress</span></template>
        </div>
      </li>
    </ul>
  </section>
</template>
