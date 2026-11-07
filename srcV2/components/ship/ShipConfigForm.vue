<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ShipCombobox from './ShipCombobox.vue'
import ShipStateNotice from './ShipStateNotice.vue'
import { useShipStore } from '@v2/stores/ship'
import { useEnvironmentsStore } from '@v2/stores/environments'
import { noticeKindForError } from '@v2/utils/shipHelpers'

/** S3/S4: repo, branch, app name, environment, Ship; collapsed Advanced (AC-001-8, AC-002-*). */
const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ (e: 'submit'): void }>()

const ship = useShipStore()
const environments = useEnvironmentsStore()

const repoText = ref(ship.draft.repo)
const showAdvanced = ref(false)
const touched = ref<Record<string, boolean>>({})
const touch = (field: string) => { touched.value = { ...touched.value, [field]: true } }

watch(() => ship.draft.repo, v => { repoText.value = v })

const repoOptions = computed(() => ship.repos.map(r => ({ value: r.fullName, label: r.fullName, hint: r.private ? 'private' : undefined })))
const branchOptions = computed(() => ship.branches.map(b => ({ value: b.name, label: b.name, hint: b.isDefault ? 'default' : undefined })))
const envChoices = computed(() => environments.shipEnvironments)
const singleEnv = computed(() => (envChoices.value.length === 1 ? envChoices.value[0] : null))
const orgs = computed(() => ship.config?.allowedOrgs ?? [])

const shown = (field: string) => (touched.value[field] ? ship.allErrors[field] : ship.fieldErrors[field]) ?? ''
const reposNotice = computed(() => (ship.reposStatus === 'error' ? noticeKindForError(ship.reposError) : null))
const branchNotice = computed(() => (ship.branchesStatus === 'error' ? noticeKindForError(ship.branchesError) : null))
const startNotice = computed(() => noticeKindForError(ship.startError))
const reposEmpty = computed(() => ship.reposStatus === 'ready' && ship.repos.length === 0 && ship.identityLinked)
const busy = computed(() => ship.submitting)
const locked = computed(() => props.disabled || busy.value)

function commitRepo(value: string) {
  touch('repo')
  if (value.trim() && value.trim() !== ship.draft.repo) void ship.selectRepo(value)
}

function onSubmit() {
  touched.value = { repo: true, branch: true, app: true, env: true, namespace: true, teamLabel: true, port: true, healthPath: true }
  if (ship.canSubmit) emit('submit')
}
</script>

<template>
  <form class="space-y-5" novalidate :aria-busy="busy ? 'true' : undefined" @submit.prevent="onSubmit">
    <ShipStateNotice v-if="reposNotice" :kind="reposNotice" :org="ship.selectedOrg" @retry="ship.loadRepos('', true)" />

    <div>
      <ShipCombobox
        id="ship-repo"
        label="Repository"
        :model-value="repoText"
        :options="repoOptions"
        placeholder="org/name or a GitHub URL"
        :loading="ship.reposStatus === 'loading'"
        :disabled="locked"
        :error="shown('repo')"
        empty-text="No matching repositories"
        @update:model-value="v => { repoText = v }"
        @select="v => { touch('repo'); void ship.selectRepo(v) }"
        @commit="commitRepo"
      />
      <p v-if="ship.reposTruncated" class="mt-2 text-xs text-gray-500 dark:text-gray-400" data-testid="ship-repos-truncated">
        Only the first {{ ship.repos.length }} repositories are listed. Type or paste org/name to use any other.
      </p>
      <p v-if="reposEmpty" class="mt-2 text-sm text-gray-600 dark:text-gray-400" role="status">
        No repositories found. We only list repositories you can read and that the Ship GitHub App can also read
        <template v-if="orgs.length">in {{ orgs.join(', ') }}</template>. To get one listed, ask an organization admin to install the Ship GitHub App on it.
      </p>
    </div>

    <ShipStateNotice v-if="branchNotice" :kind="branchNotice" :org="ship.selectedOrg" />

    <ShipCombobox
      id="ship-branch"
      label="Branch"
      :model-value="ship.draft.branch"
      :options="branchOptions"
      :placeholder="ship.draft.repo ? 'Choose or type a branch' : 'Choose a repository first'"
      :loading="ship.branchesStatus === 'loading'"
      :disabled="locked || !ship.draft.repo"
      :error="shown('branch')"
      empty-text="No matching branches — the name you type is used as is"
      @update:model-value="v => { ship.draft.branch = v }"
      @select="touch('branch')"
      @commit="touch('branch')"
    />

    <div>
      <label for="ship-app" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">App name</label>
      <input
        id="ship-app"
        type="text"
        :value="ship.draft.app"
        :disabled="locked"
        autocomplete="off"
        spellcheck="false"
        :aria-invalid="shown('app') ? 'true' : undefined"
        :aria-describedby="shown('app') ? 'ship-app-error' : undefined"
        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
        @input="ship.setApp(($event.target as HTMLInputElement).value)"
        @blur="touch('app')"
      />
      <p v-if="shown('app')" id="ship-app-error" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ shown('app') }}</p>
      <p v-else-if="ship.advisory?.appState === 'preview_open'" class="mt-1 text-xs text-gray-500 dark:text-gray-400" role="status">
        This app already has an open pull request. Shipping again updates it and keeps the same preview link.
      </p>
      <p v-else-if="ship.advisory?.appState === 'closed_unmerged'" class="mt-1 text-xs text-gray-500 dark:text-gray-400" role="status">
        The previous pull request was closed without merging. Shipping again opens a new pull request with a new preview link.
      </p>
      <p v-else-if="ship.postMerge" class="mt-1 text-xs text-gray-500 dark:text-gray-400" role="status">
        This app is already approved. New versions roll out automatically.
      </p>
    </div>

    <div v-if="singleEnv">
      <span class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Environment</span>
      <p class="text-gray-900 dark:text-white" data-testid="ship-env-text">{{ singleEnv.displayName }}</p>
    </div>
    <div v-else>
      <label for="ship-env" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Environment</label>
      <select
        id="ship-env"
        v-model="ship.draft.env"
        :disabled="locked"
        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="" disabled>Choose an environment</option>
        <option v-for="e in envChoices" :key="e.id" :value="e.id">{{ e.displayName }}</option>
      </select>
    </div>

    <div>
      <button
        type="button"
        class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        :aria-expanded="showAdvanced"
        aria-controls="ship-advanced"
        @click="showAdvanced = !showAdvanced"
      >
        {{ showAdvanced ? 'Hide advanced settings' : 'Advanced settings' }}
      </button>

      <fieldset v-if="showAdvanced" id="ship-advanced" class="mt-3 space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <legend class="px-1 text-sm font-medium text-gray-700 dark:text-gray-300">Advanced</legend>

        <div v-if="ship.postMerge" data-testid="ship-post-merge">
          <p class="text-sm text-gray-700 dark:text-gray-300">Port: <strong>{{ ship.draft.port }}</strong></p>
          <p class="text-sm text-gray-700 dark:text-gray-300">Health path: <strong>{{ ship.draft.healthPath }}</strong></p>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Settings are fixed after your app is approved. Ask the platform team to change them.</p>
        </div>
        <template v-else>
          <div>
            <label for="ship-port" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
            <input
              id="ship-port" v-model="ship.draft.port" type="number" inputmode="numeric" :disabled="locked"
              :aria-invalid="shown('port') ? 'true' : undefined" aria-describedby="ship-port-help"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              @blur="touch('port')"
            />
            <p id="ship-port-help" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Your app must listen on the port given by the $PORT environment variable. It will be set to {{ ship.draft.port }}.
            </p>
            <p v-if="shown('port')" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ shown('port') }}</p>
          </div>
          <div>
            <label for="ship-health" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Health path</label>
            <input
              id="ship-health" v-model="ship.draft.healthPath" type="text" :disabled="locked" spellcheck="false"
              :aria-invalid="shown('healthPath') ? 'true' : undefined" aria-describedby="ship-health-help"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              @blur="touch('healthPath')"
            />
            <p id="ship-health-help" class="mt-1 text-xs text-gray-500 dark:text-gray-400">Many apps use /health instead of /healthz.</p>
            <p v-if="shown('healthPath')" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ shown('healthPath') }}</p>
          </div>
        </template>

        <div>
          <label for="ship-bump" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Version bump</label>
          <select id="ship-bump" v-model="ship.draft.bump" :disabled="locked" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="patch">patch</option>
            <option value="minor">minor</option>
            <option value="major">major</option>
          </select>
        </div>
        <div>
          <label for="ship-namespace" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Namespace</label>
          <input
            id="ship-namespace" v-model="ship.draft.namespace" type="text" :disabled="locked" spellcheck="false"
            :placeholder="ship.draft.app || 'defaults to the app name'"
            :aria-invalid="shown('namespace') ? 'true' : undefined"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            @blur="touch('namespace')"
          />
          <p v-if="shown('namespace')" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ shown('namespace') }}</p>
        </div>
        <div>
          <label for="ship-team" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Team label</label>
          <input
            id="ship-team" v-model="ship.draft.teamLabel" type="text" :disabled="locked" spellcheck="false"
            :aria-invalid="shown('teamLabel') ? 'true' : undefined"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            @blur="touch('teamLabel')"
          />
          <p v-if="shown('teamLabel')" class="mt-1 text-sm text-red-600 dark:text-red-400">{{ shown('teamLabel') }}</p>
        </div>
      </fieldset>
    </div>

    <ShipStateNotice
      v-if="startNotice"
      :kind="startNotice"
      :org="ship.selectedOrg"
      :retry-after-sec="ship.startError?.retryAfterSec"
    />

    <button
      type="submit"
      :disabled="locked || !ship.canSubmit"
      class="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
    >
      {{ busy ? 'Shipping…' : 'Ship' }}
    </button>
  </form>
</template>
