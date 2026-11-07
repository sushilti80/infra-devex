<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ShipStatus } from '@v2/types/ship.types'
import { safeHttpsUrl, safePreviewUrl } from '@v2/utils/shipHelpers'

/** S6: result (version, PR link, preview per §3.8, duration) + collapsed Technical details (AC-013-4). */
const props = defineProps<{ status: ShipStatus; branch?: string }>()
const emit = defineEmits<{ (e: 'new-version'): void }>()

const showTech = ref(false)
const copied = ref(false)

const prUrl = computed(() => safeHttpsUrl(props.status.pr?.url))
const previewUrl = computed(() => (props.status.preview.state === 'available' ? safePreviewUrl(props.status.preview.url) : null))
const postMerge = computed(() => props.status.rollout === 'flux_auto_roll')
const branchName = computed(() => props.branch || props.status.settings?.branch || 'your branch')
const duration = computed(() => {
  const s = props.status.durationSec
  if (s === undefined || s === null) return ''
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
})

async function copyPreview() {
  if (!previewUrl.value) return
  try {
    await navigator.clipboard.writeText(previewUrl.value)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section aria-labelledby="ship-result-title" class="space-y-5">
    <h2 id="ship-result-title" class="text-xl font-semibold text-green-700 dark:text-green-400">Shipped {{ status.app }}</h2>

    <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <div>
        <dt class="text-gray-500 dark:text-gray-400">Version</dt>
        <dd class="text-gray-900 dark:text-white font-medium" data-testid="ship-version">{{ status.version ?? '—' }}</dd>
      </div>
      <div v-if="duration">
        <dt class="text-gray-500 dark:text-gray-400">Duration</dt>
        <dd class="text-gray-900 dark:text-white font-medium">{{ duration }}</dd>
      </div>
    </dl>

    <!-- Post-merge: Flux rolls the new version out; no PR/preview is created -->
    <p v-if="postMerge" class="text-sm text-gray-700 dark:text-gray-300" data-testid="ship-post-merge-note">
      Version {{ status.version }} will roll out automatically in a few minutes.
    </p>

    <div v-if="status.pr" class="space-y-1" data-testid="ship-pr">
      <p v-if="status.pr.state === 'merged'" class="text-sm text-gray-700 dark:text-gray-300">The pull request was merged.</p>
      <p v-else-if="status.pr.state === 'closed'" class="text-sm text-amber-700 dark:text-amber-300">
        The pull request was closed without merging, so the preview was cleaned up. Shipping again opens a new pull request with a new preview link.
      </p>
      <a
        v-if="prUrl && status.pr.state !== 'closed'"
        :href="prUrl" target="_blank" rel="noopener noreferrer"
        class="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline font-medium"
      >
        Request production deploy via this PR (#{{ status.pr.number }})
      </a>
    </div>

    <!-- Preview block (spec §3.8) -->
    <div v-if="!postMerge" class="space-y-1" data-testid="ship-preview">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Preview</h3>
      <template v-if="status.preview.state === 'available' && previewUrl">
        <div class="flex flex-wrap items-center gap-3">
          <a :href="previewUrl" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline break-all">{{ previewUrl }}</a>
          <button type="button" class="text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700" @click="copyPreview">
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          The preview can take a few minutes to become reachable. It is served by the platform's preview ingress; who can reach it depends on that setup.
        </p>
      </template>
      <p v-else-if="status.preview.state === 'not_configured'" class="text-sm text-gray-600 dark:text-gray-400">
        Preview link will be added once the platform team finishes setup. Use the pull request link above.
      </p>
      <p v-else-if="status.preview.state === 'unavailable_chart'" class="text-sm text-gray-600 dark:text-gray-400">Preview isn't available for this app.</p>
      <p v-else class="text-sm text-gray-600 dark:text-gray-400">Preview URL available after the config PR is created.</p>
    </div>

    <div class="space-y-2">
      <button
        type="button"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        @click="emit('new-version')"
      >
        Ship new version
      </button>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        Your changes are not deployed automatically. Push your code to <code>{{ branchName }}</code>, then click Ship new version.
      </p>
    </div>

    <div>
      <button
        type="button"
        class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        :aria-expanded="showTech" aria-controls="ship-tech"
        @click="showTech = !showTech"
      >
        {{ showTech ? 'Hide technical details' : 'Technical details' }}
      </button>
      <dl v-if="showTech" id="ship-tech" class="mt-2 text-sm space-y-1 border border-gray-200 dark:border-gray-700 rounded-lg p-4" data-testid="ship-tech">
        <div><dt class="inline text-gray-500 dark:text-gray-400">Source: </dt><dd class="inline break-all">{{ status.repo }}@{{ status.shortSha ?? status.sha ?? 'unknown' }}</dd></div>
        <div v-if="status.imageRef"><dt class="inline text-gray-500 dark:text-gray-400">Image: </dt><dd class="inline break-all">{{ status.imageRef }}</dd></div>
        <div v-if="status.digest"><dt class="inline text-gray-500 dark:text-gray-400">Digest: </dt><dd class="inline break-all">{{ status.digest }}</dd></div>
      </dl>
    </div>
  </section>
</template>
