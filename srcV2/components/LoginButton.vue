<script setup lang="ts">
import { useAuth } from '@v2/composables/useAuth'

const { login, logout, isAuthenticated, user, isLoading, error, clearError } = useAuth()

async function handleLogin() {
  try {
    await login()
  } catch (err: any) {
    console.error('Login error:', err)
    // Error is already stored in auth store
  }
}

async function handleLogout() {
  try {
    await logout()
  } catch (err: any) {
    console.error('Logout error:', err)
  }
}
</script>

<template>
  <div class="login-button">
    <!-- Error Message -->
    <div v-if="error" class="error-banner">
      <span class="error-text">{{ error }}</span>
      <button @click="clearError" class="error-close">&times;</button>
    </div>

    <!-- Not authenticated -->
    <button
      v-if="!isAuthenticated"
      @click="handleLogin"
      :disabled="isLoading"
      data-testid="login-button"
      class="btn btn-primary"
      :class="{ 'btn-loading': isLoading }"
    >
      <svg v-if="!isLoading" class="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
      </svg>
      <span v-if="isLoading" class="spinner"></span>
      <span>{{ isLoading ? 'Signing in...' : 'Login with Entra ID' }}</span>
    </button>
    
    <!-- Authenticated -->
    <div v-else class="user-menu" data-testid="user-menu">
      <div class="user-info">
        <svg class="user-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <div class="user-details">
          <span class="user-name">{{ user?.name }}</span>
          <span class="user-email">{{ user?.email }}</span>
        </div>
      </div>
      <button
        @click="handleLogout"
        :disabled="isLoading"
        class="btn btn-secondary"
        :class="{ 'btn-loading': isLoading }"
      >
        <svg v-if="!isLoading" class="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        <span v-if="isLoading" class="spinner"></span>
        <span>{{ isLoading ? 'Signing out...' : 'Logout' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-button {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  font-size: 0.875rem;
}

.error-text {
  flex: 1;
}

.error-close {
  background: none;
  border: none;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  color: #dc2626;
  padding: 0;
  width: 20px;
  height: 20px;
}

.error-close:hover {
  color: #b91c1c;
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background-color: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.user-icon {
  width: 32px;
  height: 32px;
  color: #6b7280;
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.user-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: #111827;
}

.user-email {
  font-size: 0.75rem;
  color: #6b7280;
}

.btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-loading {
  pointer-events: none;
}

.btn-primary {
  background-color: #0078d4;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #106ebe;
}

.btn-secondary {
  background-color: #f3f2f1;
  color: #323130;
  border: 1px solid #d2d0ce;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #e1dfdd;
}

.icon {
  width: 18px;
  height: 18px;
  stroke-width: 2;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Responsive */
@media (max-width: 640px) {
  .user-info {
    padding: 0.375rem 0.5rem;
  }

  .user-icon {
    width: 24px;
    height: 24px;
  }

  .user-name {
    font-size: 0.8125rem;
  }

  .user-email {
    font-size: 0.6875rem;
  }

  .btn {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
  }
}
</style>
