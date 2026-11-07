<template>
  <div class="rbac-manager">
    <!-- Info Alert -->
    <div class="alert alert-info">
      <i class="fas fa-info-circle"></i>
      <strong>What is RBAC?</strong> Role-Based Access Control (RBAC) defines which
      resources can access other resources. For example, granting your App Service
      read access to Key Vault secrets.
    </div>

    <!-- Add Relationship Button -->
    <div class="relationship-actions">
      <button
        type="button"
        class="btn btn-primary"
        :disabled="availableResources.length === 0"
        @click="showAddRelationshipModal = true"
      >
        <i class="fas fa-plus"></i>
        Add Relationship
      </button>
      <span v-if="availableResources.length === 0" class="text-muted ms-2">
        Select modules first to define relationships
      </span>
    </div>

    <!-- Relationships Table -->
    <div class="relationships-section" v-if="modelValue.length > 0">
      <h4>Defined Relationships ({{ modelValue.length }})</h4>
      <table class="table table-hover">
        <thead>
          <tr>
            <th style="width: 25%">Source Resource</th>
            <th style="width: 20%">Role</th>
            <th style="width: 25%">Target Resource</th>
            <th style="width: 20%">Description</th>
            <th style="width: 10%">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="relationship in modelValue" :key="relationship.id">
            <td>
              <i :class="`fas fa-${getResourceIcon(relationship.sourceId)}`"></i>
              {{ relationship.sourceName }}
            </td>
            <td>
              <span class="badge bg-primary">{{ relationship.role }}</span>
            </td>
            <td>
              <i :class="`fas fa-${getResourceIcon(relationship.targetId)}`"></i>
              {{ relationship.targetName }}
            </td>
            <td class="text-muted">
              {{ relationship.description || `Grants ${relationship.role} to ${relationship.targetName}` }}
            </td>
            <td>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                @click="removeRelationship(relationship.id)"
                title="Delete relationship"
              >
                <i class="fas fa-trash"></i>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <i class="fas fa-project-diagram fa-3x text-muted mb-3"></i>
      <p class="text-muted">
        No RBAC relationships defined yet. Click "Add Relationship" to create access
        control rules between your resources.
      </p>
    </div>

    <!-- Add Relationship Modal -->
    <div
      v-if="showAddRelationshipModal"
      class="modal-overlay"
      @click.self="closeAddRelationshipModal"
    >
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h4>Add RBAC Relationship</h4>
            <button
              type="button"
              class="btn-close"
              @click="closeAddRelationshipModal"
            >
              &times;
            </button>
          </div>

          <div class="modal-body">
            <div class="alert alert-light">
              <p class="mb-0">
                <strong>Source:</strong> Who needs access •
                <strong>Role:</strong> What permissions •
                <strong>Target:</strong> What is being accessed
              </p>
            </div>

            <form @submit.prevent="addRelationship">
              <div class="form-group">
                <label for="source-resource">
                  Source Resource <span class="text-danger">*</span>
                </label>
                <select
                  id="source-resource"
                  v-model="newRelationship.sourceId"
                  class="form-control"
                  required
                >
                  <option value="">Select source resource</option>
                  <option
                    v-for="resource in availableResources"
                    :key="resource.id"
                    :value="resource.id"
                  >
                    {{ resource.name }} ({{ resource.type }})
                  </option>
                </select>
                <small class="form-text text-muted">
                  The resource that needs to access other resources
                </small>
              </div>

              <div class="form-group">
                <label for="role">
                  Role Assignment <span class="text-danger">*</span>
                </label>
                <select
                  id="role"
                  v-model="newRelationship.role"
                  class="form-control"
                  required
                  @change="updateRoleDescription"
                >
                  <option value="">Select role</option>
                  <optgroup
                    v-for="scope in rolesByScope"
                    :key="scope.name"
                    :label="scope.name"
                  >
                    <option
                      v-for="role in scope.roles"
                      :key="role.id"
                      :value="role.name"
                      :data-description="role.description"
                    >
                      {{ role.name }}
                    </option>
                  </optgroup>
                </select>
                <small v-if="roleDescription" class="form-text text-muted">
                  {{ roleDescription }}
                </small>
              </div>

              <div class="form-group">
                <label for="target-resource">
                  Target Resource <span class="text-danger">*</span>
                </label>
                <select
                  id="target-resource"
                  v-model="newRelationship.targetId"
                  class="form-control"
                  required
                >
                  <option value="">Select target resource</option>
                  <option
                    v-for="resource in availableTargetResources"
                    :key="resource.id"
                    :value="resource.id"
                  >
                    {{ resource.name }} ({{ resource.type }})
                  </option>
                </select>
                <small class="form-text text-muted">
                  The resource to which access is being granted
                </small>
              </div>

              <div class="form-group">
                <label for="description">Description (Optional)</label>
                <textarea
                  id="description"
                  v-model="newRelationship.description"
                  class="form-control"
                  rows="2"
                  placeholder="e.g., 'Allows App Service to read Key Vault secrets'"
                ></textarea>
              </div>

              <div v-if="validationError" class="alert alert-danger">
                {{ validationError }}
              </div>

              <div class="modal-footer">
                <button
                  type="button"
                  class="btn btn-secondary"
                  @click="closeAddRelationshipModal"
                >
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
                  Add Relationship
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive, onMounted } from 'vue'
import api from '../../services/api'

interface Resource {
  id: string
  name: string
  type: string
  icon: string
  description?: string
}

interface Relationship {
  id: string
  sourceName: string
  sourceId: string
  targetName: string
  targetId: string
  role: string
  description?: string
}

interface AzureRole {
  id: string
  name: string
  description: string
  scope: string
}

interface RoleScope {
  name: string
  value: string
}

const props = defineProps<{
  modelValue: Relationship[]
  resourceInstances?: Record<string, Array<{ name: string; nameError?: string }>>
  selectedModules?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Relationship[]): void
}>()

// Modal state
const showAddRelationshipModal = ref(false)
const validationError = ref('')
const roleDescription = ref('')

// New relationship form
const newRelationship = reactive({
  sourceId: '',
  targetId: '',
  role: '',
  description: ''
})

// Azure roles loaded from JSON file
const azureRoles = ref<AzureRole[]>([])
const roleScopes = ref<RoleScope[]>([])

// Load roles from JSON file via API
onMounted(async () => {
  try {
    const response = await api.getRoles()
    if (response.success && response.data) {
      azureRoles.value = response.data.roles
      roleScopes.value = response.data.scopes
    } else {
      console.error('Failed to load roles:', response.error)
      azureRoles.value = []
      roleScopes.value = []
    }
  } catch (error) {
    console.error('Failed to load roles:', error)
    // Fallback to empty array if loading fails
    azureRoles.value = []
    roleScopes.value = []
  }
})

// Group roles by scope for dropdown optgroups
const rolesByScope = computed(() => {
  return roleScopes.value.map(scope => ({
    name: scope.name,
    roles: azureRoles.value.filter(role => role.scope === scope.value)
  })).filter(scope => scope.roles.length > 0)
})

// Resource type icons mapping
const resourceTypeIcons: Record<string, string> = {
  'Resource Group': 'folder',
  'Virtual Machine': 'server',
  'Storage Account': 'database',
  'App Service': 'cloud',
  'Key Vault': 'key',
  'SQL Database': 'table',
  'Cosmos DB': 'globe',
  'Virtual Network': 'network-wired',
  'Function App': 'code',
  'Container Registry': 'box',
  'AKS': 'dharmachakra',
  'Application Gateway': 'shield-alt',
  'Event Grid Topic': 'bolt',
  'Service Bus Queue': 'envelope'
}

// Generate resources from module instances
const availableResources = computed<Resource[]>(() => {
  const resources: Resource[] = []
  
  if (!props.resourceInstances) {
    return resources
  }

  // Iterate through each module and its instances
  Object.entries(props.resourceInstances).forEach(([moduleName, instances]) => {
    instances.forEach((instance, index) => {
      if (instance.name) {
        resources.push({
          id: `resource-${instance.name.toLowerCase().replace(/\s+/g, '-')}`,
          name: instance.name,
          type: moduleName,
          icon: resourceTypeIcons[moduleName] || 'cube',
          description: `${moduleName} instance: ${instance.name}`
        })
      }
    })
  })

  return resources
})

// Filter target resources (exclude source resource)
const availableTargetResources = computed<Resource[]>(() => {
  if (!newRelationship.sourceId) {
    return availableResources.value
  }
  return availableResources.value.filter(
    resource => resource.id !== newRelationship.sourceId
  )
})

// Get resource icon by ID
function getResourceIcon(resourceId: string): string {
  const resource = availableResources.value.find(r => r.id === resourceId)
  return resource?.icon || 'cube'
}

// Update role description when role changes
function updateRoleDescription() {
  const selectedRole = azureRoles.value.find(r => r.name === newRelationship.role)
  roleDescription.value = selectedRole?.description || ''
}

// Add new relationship
function addRelationship() {
  validationError.value = ''

  // Validation
  if (!newRelationship.sourceId) {
    validationError.value = 'Please select a source resource'
    return
  }

  if (!newRelationship.role) {
    validationError.value = 'Please select a role'
    return
  }

  if (!newRelationship.targetId) {
    validationError.value = 'Please select a target resource'
    return
  }

  if (newRelationship.sourceId === newRelationship.targetId) {
    validationError.value = 'Source and target resources must be different'
    return
  }

  // Find resource names
  const sourceResource = availableResources.value.find(
    r => r.id === newRelationship.sourceId
  )
  const targetResource = availableResources.value.find(
    r => r.id === newRelationship.targetId
  )

  if (!sourceResource || !targetResource) {
    validationError.value = 'Invalid resource selection'
    return
  }

  // Create new relationship
  const relationship: Relationship = {
    id: `rel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    sourceName: sourceResource.name,
    sourceId: sourceResource.id,
    targetName: targetResource.name,
    targetId: targetResource.id,
    role: newRelationship.role,
    description: newRelationship.description
  }

  // Emit updated relationships
  const updatedRelationships = [...props.modelValue, relationship]
  emit('update:modelValue', updatedRelationships)

  // Close modal and reset form
  closeAddRelationshipModal()
}

// Remove relationship
function removeRelationship(relationshipId: string) {
  const updatedRelationships = props.modelValue.filter(r => r.id !== relationshipId)
  emit('update:modelValue', updatedRelationships)
}

// Close add relationship modal
function closeAddRelationshipModal() {
  showAddRelationshipModal.value = false
  validationError.value = ''
  roleDescription.value = ''
  // Reset reactive object properties
  newRelationship.sourceId = ''
  newRelationship.targetId = ''
  newRelationship.role = ''
  newRelationship.description = ''
}

// Watch for module changes and clear invalid relationships
watch(
  () => props.selectedModules,
  (newModules) => {
    const moduleSet = new Set(newModules)
    const validRelationships = props.modelValue.filter(rel => {
      const sourceExists = availableResources.value.some(r => r.id === rel.sourceId)
      const targetExists = availableResources.value.some(r => r.id === rel.targetId)
      return sourceExists && targetExists
    })

    if (validRelationships.length !== props.modelValue.length) {
      emit('update:modelValue', validRelationships)
    }
  },
  { deep: true }
)
</script>

<style scoped>
.rbac-manager {
  padding: 1.5rem;
}

.rbac-header {
  margin-bottom: 1.5rem;
}

.rbac-header h3 {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.alert {
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.alert-info {
  background-color: #e3f2fd;
  border: 1px solid #90caf9;
  color: #1565c0;
}

.alert-light {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  color: #495057;
}

.alert-danger {
  background-color: #ffebee;
  border: 1px solid #ef9a9a;
  color: #c62828;
}

.relationship-actions {
  margin-bottom: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.relationships-section {
  margin-top: 2rem;
}

.relationships-section h4 {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: inherit;
}

@media (prefers-color-scheme: dark) {
  .relationships-section h4 {
    color: #e0e0e0;
  }
}

.table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

@media (prefers-color-scheme: dark) {
  .table {
    background: #2d2d2d;
  }
}

.table thead {
  background-color: #f8f9fa;
  border-bottom: 2px solid #dee2e6;
}

@media (prefers-color-scheme: dark) {
  .table thead {
    background-color: #1e1e1e;
    border-bottom-color: #444;
  }
}

.table th {
  padding: 0.75rem;
  text-align: left;
  font-weight: 600;
  font-size: 0.875rem;
  color: #495057;
}

@media (prefers-color-scheme: dark) {
  .table th {
    color: #e0e0e0;
  }
}

.table td {
  padding: 0.75rem;
  border-top: 1px solid #dee2e6;
  color: #212529;
}

@media (prefers-color-scheme: dark) {
  .table td {
    border-top-color: #444;
    color: #e0e0e0;
  }
}

.table tbody tr:hover {
  background-color: #f8f9fa;
}

@media (prefers-color-scheme: dark) {
  .table tbody tr:hover {
    background-color: #3d3d3d;
  }
}

.table td i {
  margin-right: 0.5rem;
  color: #6c757d;
}

.badge {
  padding: 0.375rem 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
}

.bg-primary {
  background-color: #007bff;
  color: white;
}

.empty-state {
  text-align: center;
  padding: 3rem 1.5rem;
  background: #f8f9fa;
  border-radius: 8px;
  margin-top: 1.5rem;
}

@media (prefers-color-scheme: dark) {
  .empty-state {
    background: #2d2d2d;
  }
}

.empty-state i {
  display: block;
  margin-bottom: 1rem;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-dialog {
  width: 100%;
  max-width: 600px;
}

.modal-content {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  max-height: 90vh;
  overflow-y: auto;
}

@media (prefers-color-scheme: dark) {
  .modal-content {
    background: #1e1e1e;
    color: #e0e0e0;
  }
}

.modal-header {
  padding: 1.5rem;
  border-bottom: 1px solid #dee2e6;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

@media (prefers-color-scheme: dark) {
  .modal-header {
    border-bottom-color: #444;
  }
}

.modal-header h4 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: inherit;
}

.btn-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6c757d;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-close:hover {
  color: #000;
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid #dee2e6;
}

@media (prefers-color-scheme: dark) {
  .modal-footer {
    border-top-color: #444;
  }

  .alert-light {
    background-color: #2d2d2d;
    color: #e0e0e0;
    border-color: #444;
  }

  .text-muted {
    color: #a0a0a0 !important;
  }
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #495057;
}

@media (prefers-color-scheme: dark) {
  .form-group label {
    color: #e0e0e0;
  }
}

.form-control {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 1rem;
  transition: border-color 0.15s;
  background-color: white;
  color: #212529;
}

/* Ensure dropdown options and optgroups are fully opaque */
.form-control option {
  background-color: white;
  color: #212529;
  opacity: 1 !important;
}

.form-control optgroup {
  background-color: #f8f9fa;
  color: #212529;
  opacity: 1 !important;
  font-weight: 600;
}

@media (prefers-color-scheme: dark) {
  .form-control {
    background-color: #2d2d2d;
    color: #e0e0e0;
    border-color: #444;
  }

  .form-control option {
    background-color: #2d2d2d;
    color: #e0e0e0;
    opacity: 1 !important;
  }

  .form-control optgroup {
    background-color: #3d3d3d;
    color: #e0e0e0;
    opacity: 1 !important;
    font-weight: 600;
  }
}

.form-control:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}

.form-text {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #6c757d;
}

.text-danger {
  color: #dc3545;
}

.text-muted {
  color: #6c757d;
}

/* Button styles */
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #007bff;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #0056b3;
}

.btn-secondary {
  background-color: #6c757d;
  color: white;
}

.btn-secondary:hover {
  background-color: #545b62;
}

.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
}

.btn-outline-danger {
  background: transparent;
  color: #dc3545;
  border: 1px solid #dc3545;
}

.btn-outline-danger:hover {
  background-color: #dc3545;
  color: white;
}
</style>
