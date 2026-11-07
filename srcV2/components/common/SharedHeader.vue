<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useNavigationStore, type PageId } from '../../stores/navigation'
import { useEnvironmentsStore } from '../../stores/environments'
import { useAuth } from '../../composables/useAuth'
import LoginButton from '../LoginButton.vue'

// Navigation store and auth
const navigationStore = useNavigationStore()
const environmentsStore = useEnvironmentsStore()
const { isAuthenticated } = useAuth()
const currentPage = computed(() => navigationStore.currentPage)

interface NavItem {
  id: PageId
  label: string
  requiresAuth: boolean
  hidden?: boolean
}

// All navigation items. `hidden` keeps a route reachable (e.g. via the home page card)
// without consuming header width - used here for Template Deploy to recover space for Logout.
const allNavItems: NavItem[] = [
  { id: 'home', label: 'Home', requiresAuth: false },
  { id: 'docs', label: 'Quick Start', requiresAuth: false },
  { id: 'custom', label: 'Custom Infrastructure', requiresAuth: true },
  { id: 'template', label: 'Template Deploy', requiresAuth: true, hidden: true },
  { id: 'aks', label: 'AKS Playground', requiresAuth: true },
  { id: 'apps', label: 'Installed Apps', requiresAuth: true },
  { id: 'secrets', label: 'Secrets', requiresAuth: true },
  { id: 'feedback', label: 'Request Feature/Bugfix', requiresAuth: true }
]

onMounted(() => {
  if (environmentsStore.environments.length === 0) environmentsStore.fetchEnvironments()
})

// Filter navigation items based on authentication
const navItems = computed(() => {
  if (isAuthenticated.value) {
    // Show all non-hidden items when authenticated
    return allNavItems.filter(item => !item.hidden && (item.id !== 'secrets' || environmentsStore.secretsEnabled))
  } else {
    // Only show Home when not authenticated
    return allNavItems.filter(item => !item.requiresAuth)
  }
})

// Check if navigation item is active
function isActive(itemId: PageId): boolean {
  return currentPage.value === itemId
}

// Handle navigation click
function handleNavClick(event: Event, itemId: PageId) {
  event.preventDefault()
  navigationStore.navigateToPage(itemId)
}
</script>

<template>
  <header class="sticky top-0 z-50 w-full bg-white dark:bg-background-dark border-b border-brand-border dark:border-white/10 h-16 flex items-center shadow-sm">
    <div class="max-w-[2560px] w-full mx-auto px-10 flex items-center justify-between">
      <!-- Logo Group -->
      <div class="flex items-center gap-3 shrink-0" data-testid="logo-group">
        <div class="text-brand-blue flex items-center justify-center">
          <span class="material-symbols-outlined text-3xl">view_in_ar</span>
        </div>
        <div class="text-brand-dark dark:text-white text-[18px] font-semibold tracking-tight">
          Self Service Catalog
        </div>
      </div>

      <!-- Navigation Menu -->
      <nav class="flex items-center gap-10 h-16">
        <!-- Archie AI External Link (only when authenticated) -->
        <a
          v-if="isAuthenticated"
          href="https://archie.ayahealthcare.com/"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-2 h-16 text-[15px] font-medium text-text-secondary dark:text-white/70 hover:text-brand-blue dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 px-3 rounded-lg transition-all cursor-pointer"
        >
          <span class="material-symbols-outlined text-xl">smart_toy</span>
          Consult Archie
        </a>

        <a
          v-for="item in navItems"
          :key="item.id"
          :data-testid="`nav-link-${item.id}`"
          :class="[
            'relative flex items-center h-16 text-[15px] font-medium transition-all cursor-pointer',
            isActive(item.id)
              ? 'nav-link-active'
              : 'text-text-secondary dark:text-white/70 hover:text-brand-blue dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 px-3 rounded-lg'
          ]"
          href="#"
          @click="(e) => handleNavClick(e, item.id)"
        >
          {{ item.label }}
        </a>
      </nav>

      <!-- Authentication -->
      <div class="shrink-0">
        <LoginButton />
      </div>
    </div>
  </header>
</template>

<style scoped>
.nav-link-active {
  color: #2563eb;
  background-color: #eff6ff;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  border-radius: 0.5rem;
  border-bottom: 2px solid #2563eb;
}
</style>
