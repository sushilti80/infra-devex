<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ShipStatus } from '@v2/types/ship.types'
import { buildCopyPayload, safeHttpsUrl } from '@v2/utils/shipHelpers'
import { useNavigationStore } from '@v2/stores/navigation'

const navigation = useNavigationStore()

/**
 * S7: failure / cancelled panel. The default view uses the frontend's own plain-language copy per failure code so the
 * closed label set (AC-001-8) holds regardless of the API wording; the API's message, buildpack id, last lines, findings
 * and the correlation ID are shown only inside Details and in the copied support payload.
 */
const props = defineProps<{ status: ShipStatus; supportedLanguages?: string[]; cancelling?: boolean }>()
const emit = defineEmits<{
  (e: 'retry-config'): void
  (e: 'ship-again'): void
  (e: 'cancel'): void
}>()

interface Copy { message: string; next: string }
const COPY: Record<string, Copy> = {
  REPO_NOT_ACCESSIBLE: { message: "We couldn't access that repository with your GitHub permissions.", next: 'Ask the repository owner for read access and ask the platform team to install the Ship GitHub App on {org}, then ship again.' },
  APP_OWNED_BY_OTHER: { message: 'That app name is already used by a different source repository.', next: 'Choose a different app name, then ship again.' },
  CLONE_FAILED: { message: "We couldn't fetch the branch. It may be missing, too large, or use submodules or Git LFS.", next: 'Check the branch and the repository contents, then ship again.' },
  UNSUPPORTED_LANGUAGE: { message: "We couldn't find a supported language in this repository.", next: 'Make sure the project root has a manifest for a supported language, then ship again.' },
  BUILD_FAILED: { message: 'The build failed — see what went wrong below.', next: 'Fix the problem, then ship again.' },
  BUILD_TIMEOUT: { message: 'The build ran past the 30-minute limit.', next: 'Make the build faster, then ship again.' },
  SECURITY_GATE_FAILED: { message: 'The security check blocked this build. Nothing was published.', next: 'Fix the findings listed in Details, then ship again.' },
  SECURITY_SCAN_UNAVAILABLE: { message: "The security check couldn't run, so nothing was published.", next: 'Try again in a few minutes.' },
  PUBLISH_FAILED: { message: 'Publishing failed.', next: 'Try again in a few minutes.' },
  VERSION_COLLISION: { message: 'The next version number already exists. This is a platform problem, not something you did.', next: 'Copy the details and send them to the platform team.' },
  CONFIG_PR_FAILED: { message: "Your build was published, but the pull request couldn't be created.", next: 'Retry PR creation. Nothing is rebuilt.' },
  RUNNER_UNAVAILABLE: { message: 'No build runner picked up this ship in time.', next: 'Cancel it and try again, or contact the platform team if it keeps happening.' },
  CANCELLED: { message: 'This ship was cancelled.', next: "Ship again when you're ready." },
  SUPERSEDED: { message: 'A newer ship for the same app replaced this one before it was published.', next: 'Check the newer ship, or ship again.' },
  PLATFORM_RATE_LIMITED: { message: 'The platform is busy right now.', next: 'Wait a few minutes, then ship again.' },
  UNKNOWN: { message: 'The ship failed for an unrecognised reason.', next: 'Copy the details and send them to the platform team.' }
}

const failure = computed(() => props.status.failure)
const code = computed(() => (failure.value && COPY[failure.value.code] ? failure.value.code : 'UNKNOWN'))
const copy = computed(() => COPY[code.value])
const title = computed(() => (props.status.state === 'cancelled' ? 'Ship cancelled' : 'Ship failed'))
const retry = computed(() => failure.value?.retry ?? 'fix_then_ship')
const details = computed(() => failure.value?.details)
const org = computed(() => props.status.repo.split('/')[0])
const runUrl = computed(() => safeHttpsUrl(details.value?.runUrl))
const canShipAgain = computed(() => code.value !== 'VERSION_COLLISION')
const canCancel = computed(() => !props.status.terminal && !!details.value?.runStillQueued)
const shipAgainLabel = computed(() => (retry.value === 'reship' ? 'Try again' : 'Ship again'))

const showDetails = ref(false)
const copied = ref(false)

async function copyDetails() {
  try {
    await navigator.clipboard.writeText(buildCopyPayload(props.status))
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section aria-labelledby="ship-failure-title" class="space-y-4" role="alert" :data-code="code">
    <h2 id="ship-failure-title" class="text-xl font-semibold text-red-700 dark:text-red-400">{{ title }}</h2>

    <p v-if="code === 'BUILD_FAILED' && details?.errorLine" class="font-mono text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 break-words" data-testid="ship-error-line">{{ details.errorLine }}</p>

    <p class="text-gray-900 dark:text-white">{{ copy.message }}</p>
    <p v-if="code === 'BUILD_FAILED'" class="text-sm text-gray-600 dark:text-gray-400">
      Private package feeds, build-time secrets, submodules and Git LFS aren't supported.
    </p>
    <p class="text-sm text-gray-600 dark:text-gray-400">{{ copy.next.replace('{org}', org) }}</p>

    <div v-if="code === 'UNSUPPORTED_LANGUAGE'" class="text-sm text-gray-700 dark:text-gray-300" data-testid="ship-languages">
      <p>Supported languages: {{ (supportedLanguages ?? []).join(', ') || 'see the documentation' }}.</p>
      <button type="button" class="mt-1 text-blue-600 dark:text-blue-400 hover:underline" @click="navigation.navigateToPage('docs')">
        Read the Ship from Repo documentation
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <button
        v-if="retry === 'retry_config' && status.terminal"
        type="button"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg"
        @click="emit('retry-config')"
      >
        Retry PR creation
      </button>
      <button
        v-if="canShipAgain"
        type="button"
        :class="retry === 'retry_config' && status.terminal ? 'px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg' : 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg'"
        @click="emit('ship-again')"
      >
        {{ shipAgainLabel }}
      </button>
      <button v-if="canCancel" type="button" :disabled="cancelling" class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-60" @click="emit('cancel')">
        Cancel
      </button>
      <button type="button" class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700" @click="copyDetails">
        {{ copied ? 'Copied' : 'Copy details' }}
      </button>
      <button
        type="button"
        class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        :aria-expanded="showDetails" aria-controls="ship-failure-details"
        @click="showDetails = !showDetails"
      >
        {{ showDetails ? 'Hide details' : 'Details' }}
      </button>
    </div>

    <div v-if="showDetails" id="ship-failure-details" class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3 text-sm text-gray-700 dark:text-gray-300" data-testid="ship-failure-details">
      <p>Correlation ID: <code class="break-all">{{ status.correlationId }}</code></p>
      <p>Failure code: {{ failure?.code ?? 'UNKNOWN' }}</p>
      <p v-if="failure?.message">Message: {{ failure.message }}</p>
      <p v-if="details?.buildpackId">Buildpack: {{ details.buildpackId }}</p>
      <p v-if="details?.errorLine && code !== 'BUILD_FAILED'">Error: {{ details.errorLine }}</p>
      <template v-if="details?.severityCounts">
        <p>Severity counts: {{ Object.entries(details.severityCounts).map(([k, v]) => `${k}: ${v}`).join(', ') }}</p>
      </template>
      <table v-if="details?.findings?.length" class="w-full text-left">
        <caption class="sr-only">Top findings</caption>
        <thead><tr><th scope="col">Package</th><th scope="col">Version</th><th scope="col">Fixed in</th><th scope="col">Severity</th></tr></thead>
        <tbody>
          <tr v-for="(f, i) in details.findings" :key="i"><td>{{ f.package }}</td><td>{{ f.version }}</td><td>{{ f.fixedIn ?? '—' }}</td><td>{{ f.severity }}</td></tr>
        </tbody>
      </table>
      <div v-if="details?.lastLines?.length">
        <p class="font-medium">Last {{ Math.min(details.lastLines.length, 50) }} lines</p>
        <pre class="mt-1 max-h-64 overflow-auto bg-gray-100 dark:bg-gray-900 rounded p-2 text-xs whitespace-pre-wrap" tabindex="0" aria-label="Last log lines">{{ details.lastLines.slice(-50).join('\n') }}</pre>
      </div>
      <p v-if="runUrl"><a :href="runUrl" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">Open the workflow run</a></p>
      <slot name="details-extra" />
    </div>
  </section>
</template>
