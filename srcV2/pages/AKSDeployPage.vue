<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <!-- Page Header -->
    <div class="mb-8">
      <div class="flex items-center gap-3 mb-2">
        <span class="material-symbols-outlined text-4xl text-orange-600 dark:text-orange-400">
          cloud_upload
        </span>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
          Deploy to Sand AKS
        </h1>
      </div>
      <p class="text-gray-600 dark:text-gray-400 ml-12">
        Deploy containerized applications to Azure Kubernetes Service
      </p>
    </div>

    <!-- Form Container -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
      <form @submit.prevent="handleSubmit" class="space-y-6">
        <!-- Environment -->
        <div>
          <label for="environment" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Environment
          </label>
          <select
            id="environment"
            v-model="envname"
            class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            required
          >
            <option
              v-for="env in envStore.aksEnabledEnvironments"
              :key="env.id"
              :value="env.id"
            >
              {{ env.displayName }}
            </option>
          </select>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Only environments with AKS enabled are shown
          </p>
        </div>

        <!-- Application Name -->
        <div>
          <label for="appname" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Application Name <span class="text-red-500">*</span>
          </label>
          <input
            id="appname"
            v-model="appname"
            type="text"
            class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="e.g., my-web-app"
            pattern="^[a-z0-9]([a-z0-9\-]*[a-z0-9])?$"
            title="Must be lowercase alphanumeric with hyphens, start and end with alphanumeric"
            required
          />
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Kubernetes-compliant name (lowercase, hyphens allowed)
          </p>
        </div>

        <!-- Namespace -->
        <div>
          <label for="namespace" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Namespace <span class="text-red-500">*</span>
          </label>
          <input
            id="namespace"
            v-model="namespace"
            type="text"
            class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="Will auto-populate from app name"
            pattern="^[a-z0-9]([a-z0-9\-]*[a-z0-9])?$"
            title="Must be lowercase alphanumeric with hyphens, start and end with alphanumeric"
            required
          />
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Kubernetes namespace (defaults to app name)
          </p>
        </div>

        <!-- Container Image -->
        <div>
          <label for="imageName" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Container Image <span class="text-red-500">*</span>
          </label>
          <input
            id="imageName"
            v-model="imageName"
            type="text"
            class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="e.g., exampleregistry.azurecr.io/my-app"
            pattern="^[a-zA-Z0-9._/\-]+$"
            title="Valid container registry path"
            required
          />
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Full container image path including registry
          </p>
        </div>

        <!-- Image Tag -->
        <div>
          <label for="imageTag" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Image Tag <span class="text-red-500">*</span>
          </label>
          <input
            id="imageTag"
            v-model="imageTag"
            type="text"
            class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="e.g., 0.0.1 or 1.2.3"
            required
          />
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Use an existing ACR tag (default: 0.0.1). Flux later selects the newest eligible semver tag.
          </p>
        </div>

        <!-- ── Web App Config ─────────────────────────────────────────────── -->
        <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <span class="material-symbols-outlined text-orange-600">tune</span>
            Web App Configuration
          </h2>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <!-- Team Label -->
            <div>
              <label for="teamLabel" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Team Label <span class="text-red-500">*</span>
              </label>
              <input
                id="teamLabel"
                v-model="teamLabel"
                type="text"
                list="teamLabelSuggestions"
                class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="e.g., software-engineering"
                required
              />
              <datalist id="teamLabelSuggestions">
                <option value="software-engineering" />
                <option value="devsecops" />
                <option value="qa-engineer" />
              </datalist>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Applied to the Kubernetes namespace
              </p>
            </div>

            <!-- Port -->
            <div>
              <label for="port" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Application Port
              </label>
              <input
                id="port"
                v-model="port"
                type="number"
                min="1"
                max="65535"
                class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="80"
              />
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Port your container listens on (default: 80)
              </p>
            </div>

            <!-- Health Path -->
            <div>
              <label for="healthPath" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Health Check Path
              </label>
              <input
                id="healthPath"
                v-model="healthPath"
                type="text"
                class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="/healthz"
              />
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Endpoint for liveness and readiness probes (default: /healthz)
              </p>
            </div>
          </div>
        </div>

        <!-- ── Application exposure (opt-in) ───────────────────────────── -->
        <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
          <label for="exposureMode" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Application exposure via Kong Gateway</label>
          <select id="exposureMode" v-model="exposureMode"
            class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="legacy">Legacy ingress (current default)</option>
            <option v-if="(envname === 'devsand' || envname === 'sand') && appname === namespace" value="private-gateway">
              Kong Gateway — private hostname (sand / devsand)
            </option>
          </select>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Legacy ingress remains the default during validation. Kong Gateway creates separate TLS,
            routing and DNS releases, initially suspended for review. Private DNS alone does not restrict
            gateway access. After successful testing and security approval, Kong Gateway will become the
            default and legacy ingress will be retired.
          </p>
        </div>

        <!-- Optional PostgreSQL database on an existing Terraform-managed Flexible Server -->
        <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
          <label class="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input id="createPostgresDb" v-model="createPostgresDb" type="checkbox"
              :disabled="!postgresDatabaseEligible"
              class="w-4 h-4 accent-orange-600" />
            Create PostgreSQL database
          </label>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Uses the existing Terraform-managed PostgreSQL Flexible Server in the selected environment.
            Available for new sand / devsand applications with matching app name and namespace
            (maximum 60 characters). No new PostgreSQL server is created.
          </p>
          <p v-if="appname && ['sand', 'devsand'].includes(envname) && !postgresDatabaseEligible"
             class="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Use an application name of 60 characters or fewer, and keep the namespace identical to the application name.
          </p>
          <p v-if="createPostgresDb && appname" class="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            Database name: <code id="postgresDatabaseName">{{ appname }}db1</code>
          </p>
        </div>

        <!-- ── Static Environment Variables ──────────────────────────────── -->
        <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-blue-500">variable_insert</span>
              Environment Variables
            </h2>
            <button
              type="button"
              @click="addEnvVar"
              class="flex items-center gap-1 text-sm text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 font-medium"
            >
              <span class="material-symbols-outlined text-base">add_circle</span>
              Add Env Var
            </button>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Static environment variables injected into the container at runtime.
          </p>

          <div v-if="envVars.length === 0" class="text-sm text-gray-400 dark:text-gray-500 italic py-2">
            No environment variables added.
          </div>

          <div
            v-for="(item, index) in envVars"
            :key="index"
            class="flex gap-2 mb-2 items-start"
          >
            <input
              v-model="item.name"
              type="text"
              placeholder="NAME"
              class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono uppercase"
            />
            <input
              v-model="item.value"
              type="text"
              placeholder="value"
              class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
            <button
              type="button"
              @click="removeEnvVar(index)"
              class="mt-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              title="Remove"
            >
              <span class="material-symbols-outlined text-xl">remove_circle</span>
            </button>
          </div>
        </div>

        <!-- ── Secret Env Vars (from k8s secret) ─────────────────────────── -->
        <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-purple-500">lock</span>
              Secret Env Vars
              <span class="text-xs font-normal text-gray-500 dark:text-gray-400">(from Kubernetes secret)</span>
            </h2>
            <button
              type="button"
              @click="addSecretEnvVar"
              class="flex items-center gap-1 text-sm text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 font-medium"
            >
              <span class="material-symbols-outlined text-base">add_circle</span>
              Add Secret Var
            </button>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Environment variables sourced from a Kubernetes secret.
            <code class="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">name</code> is the env var name in the container;
            <code class="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">key</code> is the key inside the k8s secret.
          </p>

          <div v-if="secretEnvVars.length === 0" class="text-sm text-gray-400 dark:text-gray-500 italic py-2">
            No secret env vars added.
          </div>

          <div
            v-for="(item, index) in secretEnvVars"
            :key="index"
            class="flex gap-2 mb-2 items-start"
          >
            <div class="flex-1">
              <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Env Var Name</label>
              <input
                v-model="item.name"
                type="text"
                placeholder="GITHUB_APP_ID"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono uppercase"
              />
            </div>
            <div class="flex-1">
              <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Secret Key</label>
              <input
                v-model="item.key"
                type="text"
                placeholder="GITHUB_APP_ID"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono"
              />
            </div>
            <button
              type="button"
              @click="removeSecretEnvVar(index)"
              class="mt-6 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              title="Remove"
            >
              <span class="material-symbols-outlined text-xl">remove_circle</span>
            </button>
          </div>
        </div>

        <!-- ── Key Vault Integration (ExternalSecret) ─────────────────────── -->
        <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-green-600">key</span>
              Key Vault Integration
              <span class="text-xs font-normal text-gray-500 dark:text-gray-400">(ExternalSecret)</span>
            </h2>
            <!-- Toggle -->
            <button
              type="button"
              role="switch"
              :aria-checked="externalSecretEnabled"
              @click="externalSecretEnabled = !externalSecretEnabled"
              :class="[
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500',
                externalSecretEnabled ? 'bg-orange-600' : 'bg-gray-300 dark:bg-gray-600'
              ]"
            >
              <span
                :class="[
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  externalSecretEnabled ? 'translate-x-6' : 'translate-x-1'
                ]"
              />
            </button>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">
            When enabled, an <code class="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">ExternalSecret</code> resource
            is created to sync secrets from Azure Key Vault into Kubernetes.
          </p>

          <!-- KV Secrets rows (only when toggle is on) -->
          <template v-if="externalSecretEnabled">
            <!-- Advisory banner -->
            <div
              v-if="kvSecrets.length > 0"
              class="mb-4 flex gap-3 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950 p-4"
            >
              <span class="material-symbols-outlined text-amber-600 dark:text-amber-400 mt-0.5 shrink-0">warning</span>
              <div class="text-sm text-amber-800 dark:text-amber-200">
                <p class="font-semibold mb-1">Action required before merging the PR</p>
                <p>
                  Ensure all Key Vault secret names listed in the <strong>KV Secret Name</strong> column below
                  exist in the Azure Key Vault for the <strong>{{ envname }}</strong> environment.
                  Missing secrets will prevent pods from starting.
                </p>
                <ul class="mt-2 space-y-0.5 list-disc list-inside font-mono text-xs">
                  <li v-for="(s, i) in kvSecrets.filter(x => x.kvName)" :key="i">
                    {{ s.kvName }}
                  </li>
                </ul>
              </div>
            </div>

            <div class="flex items-center justify-between mb-2">
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Map Key Vault secrets to Kubernetes secret keys.
              </p>
              <button
                type="button"
                @click="addKvSecret"
                class="flex items-center gap-1 text-sm text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 font-medium"
              >
                <span class="material-symbols-outlined text-base">add_circle</span>
                Add KV Secret
              </button>
            </div>

            <div v-if="kvSecrets.length === 0" class="text-sm text-gray-400 dark:text-gray-500 italic py-2">
              No Key Vault secrets added.
            </div>

            <div
              v-for="(item, index) in kvSecrets"
              :key="index"
              class="flex gap-2 mb-2 items-start"
            >
              <div class="flex-1">
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">KV Secret Name</label>
                <input
                  v-model="item.kvName"
                  type="text"
                  placeholder="github-app-id"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono"
                />
              </div>
              <div class="flex-1">
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">k8s Secret Key</label>
                <input
                  v-model="item.k8sKey"
                  type="text"
                  placeholder="GITHUB_APP_ID"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono uppercase"
                />
              </div>
              <button
                type="button"
                @click="removeKvSecret(index)"
                class="mt-6 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                title="Remove"
              >
                <span class="material-symbols-outlined text-xl">remove_circle</span>
              </button>
            </div>
          </template>
        </div>
        <!-- ── End Web App Config ──────────────────────────────────────────── -->

        <!-- ── External Resource Access ───────────────────────────────────── -->
        <WorkloadIdentitySection
          v-model="workloadIdentityGrants"
          :appname="appname"
          :envname="envname"
        />

        <!-- Form Actions -->
        <div class="flex gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            @click="handleCancel"
            class="px-6 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            :disabled="isSubmitting"
            class="flex-1 px-6 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span v-if="!isSubmitting">Deploy to AKS</span>
            <span v-else class="flex items-center justify-center gap-2">
              <span class="animate-spin material-symbols-outlined">progress_activity</span>
              Deploying...
            </span>
          </button>
        </div>
      </form>
    </div>

    <!-- Status Modal -->
    <StatusModal
      v-if="showStatusModal"
      :is-visible="showStatusModal"
      :correlation-id="currentCorrelationId"
      workflow-type="aks"
      @close="closeStatusModal"
      @success="handleSuccess"
      @failure="handleFailure"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useNavigationStore } from '@v2/stores/navigation'
import StatusModal from '@v2/components/modals/StatusModal.vue'
import WorkloadIdentitySection from '@v2/components/aks/WorkloadIdentitySection.vue'
import api from '@v2/services/api'
import type { WorkloadIdentityGrant } from '@v2/types/infrastructure.types'
import { useEnvironmentsStore } from '../stores/environments'

const navigationStore = useNavigationStore()
const envStore = useEnvironmentsStore()

// ── Core form fields ──────────────────────────────────────────────────────────
const getDefaultEnvironment = () =>
  envStore.aksEnabledEnvironments.find(env => env.id === envStore.defaultEnvironment)?.id ||
  envStore.aksEnabledEnvironments[0]?.id ||
  ''

const envname = ref(getDefaultEnvironment())
const appname = ref('')
const namespace = ref('')
const imageName = ref('')
const imageTag = ref('0.0.1')

// ── Web app config ────────────────────────────────────────────────────────────
const teamLabel = ref('software-engineering')
const port = ref<number | string>(80)
const healthPath = ref('/healthz')
const exposureMode = ref<'legacy' | 'private-gateway'>('legacy')
const createPostgresDb = ref(false)
const postgresDatabaseEligible = computed(() =>
  ['devsand', 'sand'].includes(envname.value) &&
  appname.value.length > 0 && appname.value.length <= 60 &&
  /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(appname.value) &&
  appname.value === namespace.value
)

// ── Dynamic env var lists ─────────────────────────────────────────────────────
const envVars = ref<{ name: string; value: string }[]>([])
const secretEnvVars = ref<{ name: string; key: string }[]>([])

// ── Key Vault / ExternalSecret ────────────────────────────────────────────────
const externalSecretEnabled = ref(false)
const kvSecrets = ref<{ kvName: string; k8sKey: string }[]>([])

// ── External Resource Access (Workload Identity grants) ───────────────────────
const workloadIdentityGrants = ref<WorkloadIdentityGrant[]>([])

// ── UI state ──────────────────────────────────────────────────────────────────
const isSubmitting = ref(false)
const showStatusModal = ref(false)
const currentCorrelationId = ref('')

// Auto-populate namespace from appname
watch([envname, appname, namespace], () => {
  if (!['devsand', 'sand'].includes(envname.value) || appname.value !== namespace.value) exposureMode.value = 'legacy'
  if (!postgresDatabaseEligible.value) createPostgresDb.value = false
})

watch(appname, (newName) => {
  if (newName) {
    const sanitized = newName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    namespace.value = sanitized
  }
})

// Auto-populate image name from appname
watch(appname, (newName) => {
  if (newName && !imageName.value.includes(newName)) {
    const defaultRegistry = 'exampleregistry.azurecr.io'
    imageName.value = `${defaultRegistry}/${newName}`
  }
})

// ── Dynamic list helpers ──────────────────────────────────────────────────────
function addEnvVar() { envVars.value.push({ name: '', value: '' }) }
function removeEnvVar(i: number) { envVars.value.splice(i, 1) }

function addSecretEnvVar() { secretEnvVars.value.push({ name: '', key: '' }) }
function removeSecretEnvVar(i: number) { secretEnvVars.value.splice(i, 1) }

function addKvSecret() { kvSecrets.value.push({ kvName: '', k8sKey: '' }) }
function removeKvSecret(i: number) { kvSecrets.value.splice(i, 1) }

// ── Utilities ─────────────────────────────────────────────────────────────────
function generateCorrelationId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 6)
  return `aks-${timestamp}-${random}`
}

// ── Form submission ───────────────────────────────────────────────────────────
async function handleSubmit() {
  if (isSubmitting.value) return

  try {
    isSubmitting.value = true
    currentCorrelationId.value = generateCorrelationId()

    const payload: Record<string, unknown> = {
      envname: envname.value,
      appname: appname.value,
      namespace: namespace.value,
      is_web_app: true,
      image_name: imageName.value,
      image_tag: imageTag.value,
      correlation_id: currentCorrelationId.value,
      team_label: teamLabel.value,
      port: String(port.value || '80'),
      health_path: healthPath.value || '/healthz',
      exposure_mode: ['devsand', 'sand'].includes(envname.value) && appname.value === namespace.value ? exposureMode.value : 'legacy',
      create_postgres_db: String(createPostgresDb.value && postgresDatabaseEligible.value),
      env_vars: JSON.stringify(envVars.value.filter(e => e.name)),
      secret_env_vars: JSON.stringify(secretEnvVars.value.filter(e => e.name)),
      external_secret_enabled: String(externalSecretEnabled.value),
      kv_secrets: JSON.stringify(kvSecrets.value.filter(s => s.kvName)),
      workload_identity_grants: JSON.stringify(
        workloadIdentityGrants.value.filter(g => g.resourceType && g.resourceName && g.role)
      )
    }

    const response = await api.deployToAKS(payload)

    if (response.success) {
      showStatusModal.value = true
      console.log('[AKSDeployPage] Status modal opened with correlationId:', currentCorrelationId.value)
    } else {
      const errorMessage = response.message || 'Failed to deploy to AKS'
      const details = response.details || []

      let errorText = errorMessage
      if (Array.isArray(details) && details.length > 0) {
        errorText += '\n\nValidation Errors:\n' + details.map((err: any) => `• ${err.msg}`).join('\n')
      } else if (typeof details === 'string') {
        errorText += '\n\n' + details
      }

      alert(errorText)
    }
  } catch (error: any) {
    console.error('[AKSDeployPage] Deployment error:', error)
    alert(`Failed to deploy to AKS: ${error.message || 'Unknown error'}`)
  } finally {
    isSubmitting.value = false
  }
}

function handleCancel() {
  navigationStore.navigateToPage('home')
}

function closeStatusModal() {
  showStatusModal.value = false
  currentCorrelationId.value = ''
}

function handleSuccess(data: any) {
  console.log('[AKSDeployPage] Deployment successful:', data)
  resetForm()
}

function handleFailure(error: any) {
  console.error('[AKSDeployPage] Deployment failed:', error)
}

watch(
  [() => envStore.aksEnabledEnvironments, () => envStore.defaultEnvironment],
  () => {
    if (envStore.aksEnabledEnvironments.length > 0) {
      envname.value = getDefaultEnvironment()
    }
  },
  { deep: true }
)

function resetForm() {
  envname.value = getDefaultEnvironment()
  appname.value = ''
  namespace.value = ''
  imageName.value = ''
  imageTag.value = '0.0.1'
  teamLabel.value = 'software-engineering'
  port.value = 80
  healthPath.value = '/healthz'
  exposureMode.value = 'legacy'
  createPostgresDb.value = false
  envVars.value = []
  secretEnvVars.value = []
  externalSecretEnabled.value = false
  kvSecrets.value = []
  workloadIdentityGrants.value = []
}
</script>
