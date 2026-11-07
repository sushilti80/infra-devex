<template>
  <div class="review-page">
    <div class="review-header">
      <h2 class="text-2xl font-bold mb-2">Review Configuration</h2>
      <p class="text-gray-600 dark:text-gray-400">
        Review your infrastructure configuration before deployment
      </p>
    </div>

    <!-- Project Information Section -->
    <section class="review-section">
      <div class="section-header">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-brand-blue">info</span>
          <h3 class="text-xl font-semibold">Project Information</h3>
        </div>
        <button
          type="button"
          class="btn-edit"
          @click="editStep(0)"
          data-testid="edit-project-info"
        >
          <span class="material-symbols-outlined">edit</span>
          Edit
        </button>
      </div>
      <div class="review-content">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Project Abbreviation:</span>
            <span class="info-value">{{ projectInfo.projectName }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Service Name:</span>
            <span class="info-value">{{ projectInfo.description }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Environment:</span>
            <span class="info-value">
              <span class="badge badge-environment">{{ projectInfo.environment }}</span>
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">Owner:</span>
            <span class="info-value">{{ projectInfo.owner }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Lifecycle:</span>
            <span class="info-value">
              <span class="badge badge-lifecycle">{{ projectInfo.lifecycle }}</span>
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">Project Age:</span>
            <span class="info-value">{{ projectInfo.projectAge }} months</span>
          </div>
          <div class="info-item">
            <span class="info-label">Approval Number:</span>
            <span class="info-value">{{ projectInfo.approvalNumber || 'N/A' }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Selected Modules Section -->
    <section class="review-section">
      <div class="section-header">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-brand-blue">extension</span>
          <h3 class="text-xl font-semibold">Selected Modules</h3>
        </div>
        <button
          type="button"
          class="btn-edit"
          @click="editStep(1)"
          data-testid="edit-modules"
        >
          <span class="material-symbols-outlined">edit</span>
          Edit
        </button>
      </div>
      <div class="review-content">
        <div v-if="selectedModules.length === 0" class="empty-state">
          <span class="material-symbols-outlined">info</span>
          <p>No modules selected</p>
        </div>
        <div v-else class="modules-list">
          <div
            v-for="module in selectedModules"
            :key="module.name"
            class="module-card"
          >
            <div class="module-icon">
              <span class="material-symbols-outlined">{{ getModuleIcon(module.category) }}</span>
            </div>
            <div class="module-info">
              <h4 class="font-semibold">{{ module.name }}</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">{{ module.category }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Resource Instances Section -->
    <section class="review-section">
      <div class="section-header">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-brand-blue">dns</span>
          <h3 class="text-xl font-semibold">Resource Instances</h3>
        </div>
        <button
          type="button"
          class="btn-edit"
          @click="editStep(2)"
          data-testid="edit-instances"
        >
          <span class="material-symbols-outlined">edit</span>
          Edit
        </button>
      </div>
      <div class="review-content">
        <div v-if="resourceInstances.length === 0" class="empty-state">
          <span class="material-symbols-outlined">info</span>
          <p>No resource instances configured</p>
        </div>
        <div v-else class="instances-list">
          <div
            v-for="instance in resourceInstances"
            :key="instance.id"
            class="instance-item"
          >
            <div class="instance-header">
              <span class="material-symbols-outlined">deployed_code</span>
              <span class="instance-name">{{ instance.name }}</span>
            </div>
            <div class="instance-details">
              <span class="text-sm text-gray-600 dark:text-gray-400">
                Type: {{ instance.moduleType }}
              </span>
            </div>
          </div>
        </div>
        <div class="summary-count">
          Total Instances: <strong>{{ resourceInstances.length }}</strong>
        </div>
      </div>
    </section>

    <!-- RBAC Relationships Section -->
    <section class="review-section">
      <div class="section-header">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-brand-blue">security</span>
          <h3 class="text-xl font-semibold">RBAC Relationships</h3>
        </div>
        <button
          type="button"
          class="btn-edit"
          @click="editStep(3)"
          data-testid="edit-rbac"
        >
          <span class="material-symbols-outlined">edit</span>
          Edit
        </button>
      </div>
      <div class="review-content">
        <div v-if="rbacRelationships.length === 0" class="empty-state">
          <span class="material-symbols-outlined">info</span>
          <p>No RBAC relationships defined</p>
        </div>
        <div v-else>
          <div class="relationships-list">
            <div
              v-for="relationship in rbacRelationships"
              :key="relationship.id"
              class="relationship-item"
            >
              <div class="relationship-flow">
                <div class="resource-box source">
                  <span class="material-symbols-outlined">deployed_code</span>
                  <span>{{ relationship.sourceName }}</span>
                </div>
                <div class="arrow-box">
                  <span class="material-symbols-outlined">arrow_forward</span>
                  <span class="role-badge">{{ relationship.role }}</span>
                </div>
                <div class="resource-box target">
                  <span class="material-symbols-outlined">deployed_code</span>
                  <span>{{ relationship.targetName }}</span>
                </div>
              </div>
              <p v-if="relationship.description" class="relationship-description">
                {{ relationship.description }}
              </p>
            </div>
          </div>
          <div class="summary-count">
            Total Relationships: <strong>{{ rbacRelationships.length }}</strong>
          </div>
        </div>
      </div>
    </section>

    <!-- Validation Messages -->
    <div v-if="validationErrors.length > 0" class="validation-errors">
      <div class="alert alert-error">
        <span class="material-symbols-outlined">error</span>
        <div>
          <h4 class="font-semibold">Please fix the following issues:</h4>
          <ul class="mt-2">
            <li v-for="(error, index) in validationErrors" :key="index">
              {{ error }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Summary Stats -->
    <div class="summary-stats">
      <div class="stat-card">
        <span class="material-symbols-outlined">extension</span>
        <div>
          <div class="stat-value">{{ selectedModules.length }}</div>
          <div class="stat-label">Modules</div>
        </div>
      </div>
      <div class="stat-card">
        <span class="material-symbols-outlined">dns</span>
        <div>
          <div class="stat-value">{{ resourceInstances.length }}</div>
          <div class="stat-label">Instances</div>
        </div>
      </div>
      <div class="stat-card">
        <span class="material-symbols-outlined">security</span>
        <div>
          <div class="stat-value">{{ rbacRelationships.length }}</div>
          <div class="stat-label">RBAC Rules</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectInfo, Module, ResourceInstance, RbacRelationship } from '@v2/types/infrastructure.types'

interface Props {
  projectInfo: ProjectInfo
  selectedModules: Module[]
  resourceInstances: ResourceInstance[]
  rbacRelationships: RbacRelationship[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  editStep: [step: number]
}>()

/**
 * Navigate back to a specific step for editing
 */
const editStep = (step: number) => {
  emit('editStep', step)
}

/**
 * Validation errors computed from configuration
 */
const validationErrors = computed<string[]>(() => {
  const errors: string[] = []

  // Check if project info is complete
  if (!props.projectInfo.projectName) {
    errors.push('Project name is required')
  }
  if (!props.projectInfo.description) {
    errors.push('Project description is required')
  }
  if (!props.projectInfo.environment) {
    errors.push('Environment selection is required')
  }
  if (!props.projectInfo.owner) {
    errors.push('Project owner is required')
  }

  // Check if at least one module is selected
  if (props.selectedModules.length === 0) {
    errors.push('At least one module must be selected')
  }

  // Check if resource instances are configured for selected modules
  if (props.selectedModules.length > 0 && props.resourceInstances.length === 0) {
    errors.push('Resource instances must be configured for selected modules')
  }

  return errors
})

/**
 * Get icon for module category
 */
const getModuleIcon = (category: string): string => {
  const icons: Record<string, string> = {
    compute: 'memory',
    storage: 'storage',
    networking: 'lan',
    security: 'security',
    database: 'database',
    monitoring: 'monitoring',
    ai: 'psychology',
    default: 'extension'
  }
  return icons[category.toLowerCase()] || icons.default
}
</script>

<style scoped>
.review-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.review-header {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e5e7eb;
}

.review-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.btn-edit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  color: #1f2937;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.875rem;
}

.btn-edit:hover {
  background: #f9fafb;
  border-color: #2563eb;
  color: #2563eb;
}

.btn-edit .material-symbols-outlined {
  font-size: 18px;
}

.review-content {
  padding-top: 1rem;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.info-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.info-value {
  font-size: 1rem;
  color: #1f2937;
  font-weight: 400;
}

.badge {
  display: inline-flex;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 500;
}

.badge-environment {
  background: #dbeafe;
  color: #1e40af;
}

.badge-lifecycle {
  background: #dcfce7;
  color: #166534;
}

.modules-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

.module-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.module-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #dbeafe;
  color: #2563eb;
  border-radius: 6px;
}

.module-icon .material-symbols-outlined {
  font-size: 24px;
}

.module-info h4 {
  margin: 0;
  font-size: 1rem;
}

.instances-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.instance-item {
  padding: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.instance-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.instance-header .material-symbols-outlined {
  color: #2563eb;
  font-size: 20px;
}

.instance-name {
  font-weight: 600;
  color: #1f2937;
}

.relationships-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.relationship-item {
  padding: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.relationship-flow {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.resource-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  flex: 1;
}

.resource-box.source {
  border-color: #3b82f6;
  background: #eff6ff;
}

.resource-box.target {
  border-color: #10b981;
  background: #f0fdf4;
}

.resource-box .material-symbols-outlined {
  font-size: 18px;
  color: #6b7280;
}

.arrow-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  color: #6b7280;
}

.role-badge {
  padding: 0.25rem 0.5rem;
  background: #fef3c7;
  color: #92400e;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.relationship-description {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
  padding-left: 1.5rem;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  background: #f9fafb;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  color: #6b7280;
}

.empty-state .material-symbols-outlined {
  font-size: 24px;
}

.summary-count {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
  text-align: right;
  color: #6b7280;
  font-size: 0.875rem;
}

.validation-errors {
  margin-bottom: 1.5rem;
}

.alert {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border-radius: 6px;
  align-items: start;
}

.alert-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.alert .material-symbols-outlined {
  font-size: 24px;
  flex-shrink: 0;
}

.alert ul {
  list-style: disc;
  padding-left: 1.5rem;
  margin: 0;
}

.alert li {
  margin-top: 0.25rem;
}

.summary-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin-top: 2rem;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.stat-card .material-symbols-outlined {
  font-size: 36px;
  opacity: 0.9;
}

.stat-value {
  font-size: 2rem;
  font-weight: bold;
  line-height: 1;
}

.stat-label {
  font-size: 0.875rem;
  opacity: 0.9;
  margin-top: 0.25rem;
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .review-header {
    border-bottom-color: #374151;
  }

  .review-section {
    background: #1f2937;
    border-color: #374151;
  }

  .section-header {
    border-bottom-color: #374151;
  }

  .btn-edit {
    background: #374151;
    border-color: #4b5563;
    color: #e5e7eb;
  }

  .btn-edit:hover {
    background: #4b5563;
    border-color: #3b82f6;
    color: #3b82f6;
  }

  .info-label {
    color: #9ca3af;
  }

  .info-value {
    color: #e5e7eb;
  }

  .module-card,
  .instance-item,
  .relationship-item {
    background: #374151;
    border-color: #4b5563;
  }

  .module-icon {
    background: #1e3a8a;
    color: #60a5fa;
  }

  .instance-name {
    color: #e5e7eb;
  }

  .resource-box {
    background: #374151;
    border-color: #4b5563;
  }

  .resource-box.source {
    border-color: #3b82f6;
    background: #1e3a8a;
  }

  .resource-box.target {
    border-color: #10b981;
    background: #065f46;
  }

  .empty-state {
    background: #374151;
    border-color: #4b5563;
    color: #9ca3af;
  }

  .summary-count {
    border-top-color: #374151;
    color: #9ca3af;
  }

  .alert-error {
    background: #7f1d1d;
    border-color: #991b1b;
    color: #fecaca;
  }
}
</style>
