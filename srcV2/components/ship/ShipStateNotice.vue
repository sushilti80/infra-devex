<script setup lang="ts">
import type { NoticeKind } from '@v2/utils/shipHelpers'

/**
 * Plain-language notices for S0e / S1 / S2 and the fail-closed API responses (403 REPO_NOT_ACCESSIBLE,
 * IDENTITY_NOT_LINKED, 503 SHIP_UNAVAILABLE, 429/503 rate limits). Never a generic error for these.
 */
export type ShipNoticeKind = Exclude<NoticeKind, null> | 'no_environment' | 'load_error'

const props = defineProps<{
  kind: ShipNoticeKind
  org?: string
  retryAfterSec?: number
}>()

const emit = defineEmits<{ (e: 'retry'): void; (e: 'home'): void }>()

const isError = (k: ShipNoticeKind) => k !== 'no_environment' && k !== 'not_linked'
</script>

<template>
  <div
    :role="isError(props.kind) ? 'alert' : 'status'"
    :data-kind="props.kind"
    :class="[
      'rounded-lg border p-4 text-sm',
      isError(props.kind)
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
    ]"
  >
    <template v-if="props.kind === 'no_environment'">
      <p class="font-medium">Ship from Repo isn't available in any environment right now.</p>
      <button type="button" class="mt-3 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700" @click="emit('home')">
        Back to home
      </button>
    </template>

    <template v-else-if="props.kind === 'load_error'">
      <p class="font-medium">Couldn't load Ship from Repo</p>
      <p class="mt-1">Something went wrong while loading. Please try again.</p>
      <button type="button" class="mt-3 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg" @click="emit('retry')">
        Try again
      </button>
    </template>

    <template v-else-if="props.kind === 'not_linked'">
      <p class="font-medium">We couldn't verify your GitHub account, so shipping is turned off for you.</p>
      <p class="mt-1">Ask the platform team to link it.</p>
    </template>

    <template v-else-if="props.kind === 'not_accessible'">
      <p class="font-medium">We couldn't access that repository with your GitHub permissions.</p>
      <p class="mt-1">
        Ask the repository owner for read access, and ask the platform team to install the Ship GitHub App on
        {{ props.org ? `the ${props.org} organization` : 'that organization' }}.
      </p>
    </template>

    <template v-else-if="props.kind === 'unavailable'">
      <p class="font-medium">Ship from Repo is temporarily unavailable.</p>
      <p class="mt-1">Please try again later, or contact the platform team if this keeps happening.</p>
    </template>

    <template v-else-if="props.kind === 'rate_limited'">
      <p class="font-medium">There are too many ships running right now.</p>
      <p class="mt-1">
        {{ props.retryAfterSec ? `Please try again in about ${props.retryAfterSec} seconds.` : 'Please wait a few minutes, then try again.' }}
      </p>
    </template>

    <template v-else-if="props.kind === 'validation'">
      <p class="font-medium">Please fix the highlighted fields and try again.</p>
    </template>

    <template v-else>
      <p class="font-medium">We couldn't start your ship.</p>
      <p class="mt-1">Something went wrong. Please try again.</p>
    </template>
  </div>
</template>
