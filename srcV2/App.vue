<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import SharedHeader from './components/common/SharedHeader.vue'
import DocsPage from './pages/DocsPage.vue'
import FaqPage from './pages/FaqPage.vue'
import CustomInfrastructurePage from './pages/CustomInfrastructurePage.vue'
import TemplateDeployPage from './pages/TemplateDeployPage.vue'
import AKSDeployPage from './pages/AKSDeployPage.vue'
import AKSInstalledAppsPage from './pages/AKSInstalledAppsPage.vue'
import InstalledAppsPage from './pages/InstalledAppsPage.vue'
import ExistingInfraChangePage from './pages/ExistingInfraChangePage.vue'
import FeedbackPage from './pages/FeedbackPage.vue'
import SecretsPage from './pages/SecretsPage.vue'
import ShipFromRepoPage from './pages/ShipFromRepoPage.vue'
import { useNavigationStore } from './stores/navigation'
import { useEnvironmentsStore } from './stores/environments'
import { useAuth } from './composables/useAuth'
import { readShipParam, setShipQueryParam, storePendingDeepLink, takePendingDeepLink } from './utils/shipHelpers'

const navigationStore = useNavigationStore()
const environmentsStore = useEnvironmentsStore()
const { isAuthenticated, login, isLoading } = useAuth()

// Dark mode support
const isDarkMode = ref(false)

/**
 * Ship deep link (?ship=<correlationId>, AC-013-3). The MSAL login redirect drops the query string (A-10 #3), so an
 * unauthenticated visitor's validated ID is parked in sessionStorage and restored (then cleared) after sign-in.
 */
function handleShipDeepLink() {
  const fromUrl = readShipParam(window.location.search)
  if (!isAuthenticated.value) {
    if (fromUrl) storePendingDeepLink(fromUrl)
    return
  }
  const pending = takePendingDeepLink() // always clears the key
  const id = fromUrl ?? pending
  if (id) {
    setShipQueryParam(id)
    navigationStore.navigateToPage('ship')
  }
}

watch(isAuthenticated, signedIn => { if (signedIn) handleShipDeepLink() })

onMounted(() => {
  handleShipDeepLink()

  // Check for saved dark mode preference
  const savedDarkMode = localStorage.getItem('darkMode')
  if (savedDarkMode) {
    isDarkMode.value = savedDarkMode === 'true'
  } else {
    // Check system preference
    isDarkMode.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  // Apply dark mode class
  if (isDarkMode.value) {
    document.documentElement.classList.add('dark')
  }
})

function toggleDarkMode() {
  isDarkMode.value = !isDarkMode.value

  if (isDarkMode.value) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }

  // Save preference
  localStorage.setItem('darkMode', isDarkMode.value.toString())
}
</script>

<template>
  <div id="app" class="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
    <!-- Header -->
    <SharedHeader />

    <!-- Main Content Area -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Home Page -->
      <div v-if="navigationStore.currentPage === 'home'" class="space-y-8">
        <!-- Unauthenticated Landing Page -->
        <div v-if="!isAuthenticated" class="flex flex-col items-center justify-center min-h-[600px] space-y-8">
          <div class="text-center space-y-6 max-w-3xl">
            <div class="mb-8">
              <svg class="mx-auto h-24 w-24 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>

            <h1 class="text-5xl font-bold text-gray-900 dark:text-white">
              Self-Service Infrastructure Catalog
            </h1>

            <p class="text-2xl text-gray-600 dark:text-gray-300">
              Provision, deploy, and manage Azure infrastructure using standardized Terraform modules
            </p>

            <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mt-8">
              <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Sign in to get started
              </h2>
              <p class="text-gray-600 dark:text-gray-400 mb-6">
                Use your Microsoft work account to access the infrastructure catalog and manage your Azure resources.
              </p>

              <button
                @click="login"
                :disabled="isLoading"
                class="inline-flex items-center px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-lg font-medium rounded-lg transition-colors duration-200 shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
              >
                <svg v-if="!isLoading" class="w-6 h-6 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.5 0L0 6.75V10.5C0 16.7 3.9 22.4 11.5 24C19.1 22.4 23 16.7 23 10.5V6.75L11.5 0M11.5 2.2L21 7.5V10.5C21 15.7 17.8 20.5 11.5 21.9C5.2 20.5 2 15.7 2 10.5V7.5L11.5 2.2M10.5 6V9H6V11H10.5V14L15 10L10.5 6Z"/>
                </svg>
                <svg v-else class="animate-spin h-6 w-6 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ isLoading ? 'Signing in...' : 'Sign in with EntraId' }}
              </button>
            </div>

            <div class="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
              <div class="space-y-2">
                <div class="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span class="font-semibold">Custom Infrastructure</span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-400 ml-8">
                  Build custom solutions by composing Terraform modules
                </p>
              </div>

              <div class="space-y-2">
                <div class="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span class="font-semibold">Template Deploy</span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-400 ml-8">
                  Deploy pre-configured templates for common scenarios
                </p>
              </div>

              <div class="space-y-2">
                <div class="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span class="font-semibold">AKS Playground</span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-400 ml-8">
                  Deploy containerized applications to Azure Kubernetes
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Authenticated Dashboard -->
        <div v-else class="space-y-8">
        <div class="text-center space-y-4">
          <h1 class="text-4xl font-bold text-gray-900 dark:text-white">
            Welcome to Self Service Catalog
          </h1>
          <p class="text-xl text-gray-600 dark:text-gray-300">
            Provision, deploy, and manage Azure infrastructure using standardized Terraform modules
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <!-- Custom Infrastructure Card -->
          <div
            class="bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
            @click="navigationStore.navigateToPage('custom')"
          >
            <div class="flex flex-col items-center text-center space-y-4">
              <div class="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl text-blue-600 dark:text-blue-400">
                  build
                </span>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Custom Infrastructure
                </h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Build custom infrastructure by selecting and composing modules
                </p>
              </div>
            </div>
          </div>

          <!-- Template Deploy Card hidden to match SharedHeader nav (still reachable via /template route) -->

          <!-- Installed Apps Card -->
          <div
            class="bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
            @click="navigationStore.navigateToPage('apps')"
          >
            <div class="flex flex-col items-center text-center space-y-4">
              <div class="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl text-green-600 dark:text-green-400">
                  apps
                </span>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Installed Apps
                </h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  View and manage your provisioned infrastructure
                </p>
              </div>
            </div>
          </div>

          <!-- AKS Playground Card -->
          <div
            class="bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
            @click="navigationStore.navigateToPage('aks')"
          >
            <div class="flex flex-col items-center text-center space-y-4">
              <div class="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl text-orange-600 dark:text-orange-400">
                  cloud_upload
                </span>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  AKS Playground
                </h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Deploy containerized applications to Azure Kubernetes
                </p>
              </div>
            </div>
          </div>

          <!-- AKS Apps Card -->
          <div
            class="bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
            @click="navigationStore.navigateToPage('aks-apps')"
          >
            <div class="flex flex-col items-center text-center space-y-4">
              <div class="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl text-orange-600 dark:text-orange-400">
                  dns
                </span>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  AKS Apps
                </h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Review deployed AKS applications
                </p>
              </div>
            </div>
          </div>

          <!-- Existing Infrastructure Change Card -->
          <div
            class="bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
            @click="navigationStore.navigateToPage('change')"
          >
            <div class="flex flex-col items-center text-center space-y-4">
              <div class="w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl text-teal-600 dark:text-teal-400">
                  edit_square
                </span>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Existing Infrastructure Change
                </h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Modify existing infrastructure using specialized agents
                </p>
              </div>
            </div>
          </div>

          <!-- Secrets Card (FR-005(c): gated by secretsEnabledEnvironments) -->
          <div
            v-if="environmentsStore.secretsEnabledEnvironments.length > 0"
            class="bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
            @click="navigationStore.navigateToPage('secrets')"
          >
            <div class="flex flex-col items-center text-center space-y-4">
              <div class="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl text-red-600 dark:text-red-400">
                  key
                </span>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Secrets
                </h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Create and view Key Vault secrets for your application
                </p>
              </div>
            </div>
          </div>

          <!-- Ship an app from GitHub Card (visible only when an environment has features.shipFromRepo) -->
          <button
            v-if="environmentsStore.shipEnabled"
            type="button"
            class="w-full bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
            data-testid="ship-card"
            @click="navigationStore.navigateToPage('ship')"
          >
            <div class="flex flex-col items-center text-center space-y-4">
              <div class="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl text-purple-600 dark:text-purple-400">
                  rocket_launch
                </span>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Ship an app from GitHub
                </h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Build and preview an app straight from a GitHub repository
                </p>
              </div>
            </div>
          </button>

          <!-- FAQ Card -->
          <button
            type="button"
            class="w-full bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
            data-testid="faq-card"
            @click="navigationStore.navigateToPage('faq')"
          >
            <div class="flex flex-col items-center text-center space-y-4">
              <div class="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl text-blue-600 dark:text-blue-400">
                  help
                </span>
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  FAQ &amp; Use Cases
                </h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Common questions and real-world scenarios for each feature
                </p>
              </div>
            </div>
          </button>
        </div>
        </div>
        <!-- End Authenticated Dashboard -->
      </div>

      <!-- Documentation Page (Public - No Auth Required) -->
      <DocsPage v-else-if="navigationStore.currentPage === 'docs'" />

      <!-- FAQ Page (Public - No Auth Required) -->
      <FaqPage v-else-if="navigationStore.currentPage === 'faq'" />

      <!-- Custom Infrastructure Page (Protected) -->
      <div v-else-if="navigationStore.currentPage === 'custom' && isAuthenticated">
        <CustomInfrastructurePage />
      </div>

      <!-- Template Deploy Page (Protected) -->
      <div v-else-if="navigationStore.currentPage === 'template' && isAuthenticated" class="space-y-6">
        <div class="flex items-center justify-between">
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
            Template Deploy
          </h1>
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            @click="navigationStore.navigateToPage('home')"
          >
            <span class="material-symbols-outlined text-lg mr-2 inline-block align-middle">
              arrow_back
            </span>
            <span class="align-middle">Back to Home</span>
          </button>
        </div>

        <TemplateDeployPage />
      </div>

      <!-- AKS Playground Page (Protected) -->
      <div v-else-if="navigationStore.currentPage === 'aks' && isAuthenticated">
        <AKSDeployPage />
      </div>

      <!-- AKS Installed Apps Page (Protected) -->
      <div v-else-if="navigationStore.currentPage === 'aks-apps' && isAuthenticated">
        <AKSInstalledAppsPage />
      </div>

      <!-- Installed Apps Page (Protected) -->
      <div v-else-if="navigationStore.currentPage === 'apps' && isAuthenticated">
        <InstalledAppsPage />
      </div>

      <!-- Existing Infrastructure Change Page (Protected) -->
      <div v-else-if="navigationStore.currentPage === 'change' && isAuthenticated">
        <ExistingInfraChangePage />
      </div>

      <!-- Feedback Page (Protected) -->
      <div v-else-if="navigationStore.currentPage === 'feedback' && isAuthenticated">
        <FeedbackPage />
      </div>

      <div v-else-if="navigationStore.currentPage === 'secrets' && isAuthenticated">
        <SecretsPage />
      </div>

      <!-- Ship from Repo Page (Protected; the page itself shows "not available" when no environment has the flag) -->
      <div v-else-if="navigationStore.currentPage === 'ship' && isAuthenticated">
        <ShipFromRepoPage />
      </div>
    </main>

    <!-- Dark Mode Toggle (Floating Button) -->
    <button
      type="button"
      class="fixed bottom-6 right-6 w-12 h-12 bg-gray-800 dark:bg-gray-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center"
      @click="toggleDarkMode"
      title="Toggle dark mode"
    >
      <span class="material-symbols-outlined text-2xl">
        {{ isDarkMode ? 'light_mode' : 'dark_mode' }}
      </span>
    </button>
  </div>
</template>

<style scoped>
/* Smooth transitions for dark mode */
* {
  transition-property: background-color, border-color, color;
  transition-duration: 200ms;
  transition-timing-function: ease-in-out;
}
</style>
