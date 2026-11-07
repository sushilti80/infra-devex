<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useNavigationStore } from '@v2/stores/navigation'
import { useEnvironmentsStore } from '@v2/stores/environments'
import { useShipStore } from '@v2/stores/ship'
import { useShipPolling } from '@v2/composables/useShipPolling'
import { readShipParam, setShipQueryParam } from '@v2/utils/shipHelpers'
import type { ShipApiError, ShipStatus } from '@v2/types/ship.types'
import ShipStateNotice from '@v2/components/ship/ShipStateNotice.vue'
import ShipConfigForm from '@v2/components/ship/ShipConfigForm.vue'
import ShipProgress from '@v2/components/ship/ShipProgress.vue'
import ShipResult from '@v2/components/ship/ShipResult.vue'
import ShipFailurePanel from '@v2/components/ship/ShipFailurePanel.vue'
import ShipLogViewer from '@v2/components/ship/ShipLogViewer.vue'
import ShipRecentList from '@v2/components/ship/ShipRecentList.vue'

/**
 * Ship from Repo page: state machine S0-S7 (spec §3.10.2). Polling goes through the thin useShipPolling interface
 * (open decision H-8) and is stopped on unmount and on navigation via the navigation store's cleanup registry.
 */
const navigation = useNavigationStore()
const environments = useEnvironmentsStore()
const ship = useShipStore()

const poller = useShipPolling({
  fetchStatus: ship.fetchStatus,
  onStatus: ship.applyStatus,
  onError: ship.applyStatusError,
  isFatal: ship.isFatalStatusError
})

type View = 'S0' | 'S0e' | 'S1' | 'S3' | 'S5' | 'S6' | 'S7' | 'unavailable'

const view = computed<View>(() => {
  if (!environments.shipEnabled) return 'S1'
  if (ship.configStatus === 'idle' || ship.configStatus === 'loading') return 'S0'
  if (ship.configStatus === 'error') return 'S0e'
  const a = ship.active
  if (!a) return 'S3'
  if (a.unavailable) return 'unavailable'
  if (!a.status) return a.start ? 'S5' : 'S0'
  if (a.status.state === 'succeeded') return 'S6'
  if (a.status.state === 'failed' || a.status.state === 'cancelled') return 'S7'
  return 'S5'
})

const identityBlocked = computed(() => ship.configStatus === 'ready' && !ship.identityLinked)

/** Until the first poll lands, show the five labels with the first one in progress. */
const shown = computed<ShipStatus | null>(() => {
  const a = ship.active
  if (!a) return null
  if (a.status) return a.status
  if (!a.start) return null
  return {
    correlationId: a.correlationId, app: a.start.app, env: a.start.env, repo: a.start.repo, startedAt: a.start.startedAt,
    state: 'queued', terminal: false, attempt: 1, queuedBehind: false, runResolved: false, preview: { state: 'pending' },
    stages: (['queued', 'prepare', 'build', 'scan', 'publish', 'config_pr', 'preview'] as const).map((id, i) => ({ id, state: i === 0 ? 'running' : 'pending' }))
  }
})

const branchForActive = computed(() => ship.active?.start?.branch ?? ship.active?.status?.settings?.branch ?? ship.recent.find(r => r.correlationId === ship.active?.correlationId)?.branch)

const actionMessage = computed(() => {
  const e: ShipApiError | null | undefined = ship.active?.actionError
  if (!e) return ''
  if (e.code === 'CANCEL_NOT_ALLOWED') return "You can't cancel once publishing has started."
  if (e.code === 'RETRY_NOT_APPLICABLE') return "Retrying the pull request step isn't possible any more. Ship again instead."
  if (e.status === 403) return 'Only the person who started this ship, or the platform team, can do that.'
  return "That didn't work. Please try again."
})

function openAndPoll(correlationId: string, opts: { minAttempt?: number } = {}) {
  ship.openShip(correlationId)
  setShipQueryParam(correlationId)
  poller.start(correlationId, opts)
}

async function load() {
  await ship.loadConfig()
  if (ship.configStatus !== 'ready') return
  const deepLink = readShipParam(window.location.search)
  if (deepLink) openAndPoll(deepLink)
  if (ship.identityLinked) void ship.loadRepos()
  void ship.refreshRecent()
}

async function onSubmit() {
  const started = await ship.submit()
  if (started) {
    setShipQueryParam(started.correlationId)
    poller.start(started.correlationId)
  }
}

function leaveShip() {
  poller.stop()
  setShipQueryParam(null)
}

function closeShip() {
  leaveShip()
  ship.closeActive()
}

async function shipAgain() {
  const status = ship.active?.status
  if (!status) return closeShip()
  leaveShip()
  await ship.prefillFromShip(status)
  if (ship.identityLinked) void ship.loadRepos()
}

async function retryPr() {
  const attempt = await ship.retryConfigPr()
  if (attempt && ship.active) poller.start(ship.active.correlationId, { minAttempt: attempt })
}

function openRecent(correlationId: string) {
  openAndPoll(correlationId)
}

function retryLoad() {
  void load()
}

const stopOnLeave = () => leaveShip()

onMounted(() => {
  ship.reset()
  ship.loadRecent()
  navigation.registerCleanup(stopOnLeave)
  if (environments.shipEnabled) void load()
})

watch(() => environments.shipEnabled, enabled => { if (!enabled) leaveShip() })

onUnmounted(() => {
  navigation.unregisterCleanup(stopOnLeave)
  leaveShip()
})
</script>

<template>
  <div class="space-y-6 max-w-3xl mx-auto">
    <div class="flex items-center justify-between">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Ship an app from GitHub</h1>
      <button
        type="button"
        class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        @click="navigation.navigateToPage('home')"
      >
        Back to Home
      </button>
    </div>

    <!-- S0: loading -->
    <div v-if="view === 'S0'" aria-busy="true" role="status" class="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-pulse space-y-3" data-testid="ship-loading">
      <span class="sr-only">Loading…</span>
      <div class="h-5 w-1/3 bg-gray-200 dark:bg-gray-700 rounded" />
      <div class="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
      <div class="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
    </div>

    <!-- S0e: load error -->
    <ShipStateNotice v-else-if="view === 'S0e'" kind="load_error" @retry="retryLoad" />

    <!-- S1: no environment enabled -->
    <ShipStateNotice v-else-if="view === 'S1'" kind="no_environment" @home="navigation.navigateToPage('home')" />

    <!-- ship no longer available (403/404 on the status of the opened ship) -->
    <div v-else-if="view === 'unavailable'" class="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-3" role="status" data-testid="ship-unavailable">
      <p class="font-medium text-gray-900 dark:text-white">This ship isn't available.</p>
      <p class="text-sm text-gray-600 dark:text-gray-400">It may be too old, or you may not have access to it.</p>
      <button type="button" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg" @click="closeShip">Ship an app</button>
    </div>

    <!-- S5 progress -->
    <div v-else-if="view === 'S5' && shown" class="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <ShipProgress :status="shown" :cancelling="ship.active?.cancelling" @cancel="ship.cancel()">
        <template #details-extra>
          <ShipLogViewer :correlation-id="shown.correlationId" :stages="shown.stages" />
        </template>
      </ShipProgress>
      <p v-if="ship.active?.loadError" class="text-sm text-amber-700 dark:text-amber-300" role="status">Couldn't refresh the status — we'll keep trying.</p>
      <p v-if="actionMessage" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ actionMessage }}</p>
      <button type="button" class="text-sm text-blue-600 dark:text-blue-400 hover:underline" @click="closeShip">Ship another app</button>
    </div>

    <!-- S6 result -->
    <div v-else-if="view === 'S6' && shown" class="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <ShipResult :status="shown" :branch="branchForActive" @new-version="shipAgain" />
      <button type="button" class="text-sm text-blue-600 dark:text-blue-400 hover:underline" @click="closeShip">Ship another app</button>
    </div>

    <!-- S7 failure / cancelled -->
    <div v-else-if="view === 'S7' && shown" class="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <ShipFailurePanel
        :status="shown"
        :supported-languages="ship.config?.supportedLanguages"
        :cancelling="ship.active?.cancelling"
        @retry-config="retryPr"
        @ship-again="shipAgain"
        @cancel="ship.cancel()"
      >
        <template #details-extra>
          <ShipLogViewer :correlation-id="shown.correlationId" :stages="shown.stages" />
        </template>
      </ShipFailurePanel>
      <p v-if="actionMessage" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ actionMessage }}</p>
      <button type="button" class="text-sm text-blue-600 dark:text-blue-400 hover:underline" @click="closeShip">Ship another app</button>
    </div>

    <!-- S2 / S3 / S4: form (disabled when the GitHub account can't be verified) + recent ships -->
    <template v-else>
      <p class="text-gray-600 dark:text-gray-400">
        Pick a repository and branch. We build it, run a security check, publish it and open a pull request so you can review and preview it.
      </p>
      <ShipStateNotice v-if="identityBlocked" kind="not_linked" />
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <ShipConfigForm :disabled="identityBlocked" @submit="onSubmit" />
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <ShipRecentList
          :entries="ship.recent"
          :states="ship.recentStates"
          @open="openRecent"
          @retry="ship.retryRecent"
          @remove="ship.removeRecentEntry"
          @clear="ship.clearRecentList"
        />
      </div>
    </template>
  </div>
</template>
