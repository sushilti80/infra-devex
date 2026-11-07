<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { apiService } from '@v2/services/api'
import type { ShipEnvelope, ShipLogChunk, ShipLogStage, ShipStage } from '@v2/types/ship.types'

/**
 * On-demand build logs (FR-009): fetched only while open, refreshed every 15 s, incremental via offset,
 * copy / download, truncation notice. Log text is untrusted: rendered as text only.
 */
const props = withDefaults(defineProps<{ correlationId: string; stages?: ShipStage[]; refreshMs?: number }>(), { stages: () => [], refreshMs: 15_000 })

const open = ref(false)
const stage = ref<ShipLogStage>('prepare')
const text = ref('')
const offset = ref(0)
const available = ref(true)
const complete = ref(false)
const truncated = ref(false)
const skippedBytes = ref(0)
const error = ref('')
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
let generation = 0

const STAGES: Array<{ id: ShipLogStage; label: string }> = [
  { id: 'prepare', label: 'Prepare' }, { id: 'build', label: 'Build' }, { id: 'scan', label: 'Scan' },
  { id: 'publish', label: 'Publish' }, { id: 'config_pr', label: 'Config PR' }
]

/** The stage worth showing first: the running one, else the last that started. */
const suggested = computed<ShipLogStage>(() => {
  const order: Record<string, ShipLogStage> = { prepare: 'prepare', build: 'build', scan: 'scan', publish: 'publish', config_pr: 'config_pr' }
  const running = props.stages.find(s => s.state === 'running' && order[s.id])
  if (running) return order[running.id]
  const started = props.stages.filter(s => order[s.id] && s.state !== 'pending' && s.state !== 'skipped')
  return started.length ? order[started[started.length - 1].id] : 'prepare'
})
const currentStageId = computed(() => props.stages.find(s => s.state === 'running')?.id)

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

function reset() {
  generation++
  clearTimer()
  text.value = ''
  offset.value = 0
  available.value = true
  complete.value = false
  truncated.value = false
  skippedBytes.value = 0
  error.value = ''
}

async function load() {
  const mine = generation
  clearTimer()
  try {
    const res = (await apiService.getShipLogs(props.correlationId, stage.value, offset.value)) as ShipEnvelope<ShipLogChunk>
    if (mine !== generation || !open.value) return
    const d = res.data
    if (!res.success || !d) throw new Error('empty')
    error.value = ''
    available.value = d.available
    truncated.value = d.truncated
    skippedBytes.value = d.skippedBytes
    complete.value = d.complete
    if (d.available) {
      text.value += d.text
      offset.value = d.offset
    }
  } catch {
    if (mine !== generation) return
    error.value = "Couldn't load logs. We'll try again."
  }
  if (mine === generation && open.value && !complete.value) timer = setTimeout(load, props.refreshMs)
}

function toggle() {
  open.value = !open.value
  reset()
  if (!open.value) return
  // A changed stage is picked up (and loaded once) by the watcher below; otherwise load now.
  if (stage.value !== suggested.value) stage.value = suggested.value
  else void load()
}

watch(stage, () => {
  if (!open.value) return
  reset()
  void load()
})

onBeforeUnmount(() => { generation++; clearTimer() })

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value)
    copied.value = true
  } catch {
    copied.value = false
  }
}

async function download() {
  try {
    const res = await apiService.getShipLogs(props.correlationId, stage.value, 0, true)
    if (typeof res !== 'string') {
      error.value = "Logs aren't available to download yet."
      return
    }
    const url = URL.createObjectURL(new Blob([res], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `ship-${props.correlationId}-${stage.value}.log`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    error.value = "Couldn't download the log."
  }
}
</script>

<template>
  <div class="space-y-2">
    <button
      type="button"
      class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
      :aria-expanded="open" aria-controls="ship-log-panel"
      @click="toggle"
    >
      {{ open ? 'Hide logs' : 'Show logs' }}
    </button>

    <div v-if="open" id="ship-log-panel" class="space-y-2" data-testid="ship-log-panel">
      <div class="flex flex-wrap items-center gap-3">
        <label for="ship-log-stage" class="text-sm text-gray-700 dark:text-gray-300">Stage</label>
        <select id="ship-log-stage" v-model="stage" class="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white">
          <option v-for="s in STAGES" :key="s.id" :value="s.id">{{ s.label }}{{ s.id === currentStageId ? ' (current)' : '' }}</option>
        </select>
        <button type="button" class="text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700" :disabled="!text" @click="copy">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
        <button type="button" class="text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700" @click="download">
          Download full log
        </button>
      </div>

      <p v-if="truncated" class="text-xs text-amber-700 dark:text-amber-300" role="status" data-testid="ship-log-truncated">
        This log is very large, so the earliest {{ skippedBytes }} characters are not shown here. Download the full log to see everything.
      </p>
      <p v-if="error" class="text-xs text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
      <p v-if="!available" class="text-sm text-gray-600 dark:text-gray-400" role="status">Logs aren't available yet for this stage. They appear once the step has started.</p>

      <pre v-else class="max-h-96 overflow-auto bg-gray-900 text-gray-100 rounded p-3 text-xs whitespace-pre-wrap break-words" tabindex="0" aria-label="Build log" data-testid="ship-log-text">{{ text || (complete ? '(empty)' : 'Waiting for output…') }}</pre>
    </div>
  </div>
</template>
