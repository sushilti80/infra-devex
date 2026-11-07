import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/index.css'
import { initializeMsal, setActiveAccount } from './services/authService'
import { useAuthStore } from './stores/auth'
import { useEnvironmentsStore } from './stores/environments'

// Initialize MSAL before creating Vue app
async function initializeApp() {
  // Initialize MSAL library
  const account = await initializeMsal()
  
  // Create Vue app and Pinia
  const app = createApp(App)
  const pinia = createPinia()
  
  app.use(pinia)
  
  // Load environments configuration
  const envStore = useEnvironmentsStore()
  await envStore.fetchEnvironments()
  
  // Restore authentication session if account exists
  if (account) {
    setActiveAccount(account)
    const authStore = useAuthStore()
    await authStore.restoreSession()
  }
  
  // Mount app
  app.mount('#app')
  
  console.log('[App] Application initialized')
}

// Start app initialization
initializeApp().catch(err => {
  console.error('[App] Initialization failed:', err)
  // Still mount app even if auth fails
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.mount('#app')
})
