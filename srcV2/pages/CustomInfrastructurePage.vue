<template>
  <div class="custom-infrastructure-page">
    <!-- Page Header -->
    <div class="page-header">
      <h1>Custom Infrastructure</h1>
      <p data-testid="page-description">
        Select and configure Terraform modules to build your infrastructure
      </p>
    </div>

    <!-- Editing mode banner (FR-004) -->
    <div
      v-if="isEditingMode"
      role="status"
      data-testid="editing-mode-banner"
      class="editing-mode-banner"
    >
      <span>Editing existing app: <strong>{{ editingAppName }}</strong> / <strong>{{ editingEnvironment }}</strong></span>
      <button
        type="button"
        data-testid="clear-editing-mode"
        class="clear-editing-btn"
        @click="clearEditingMode"
      >
        Clear and start fresh
      </button>
    </div>

    <!-- Auto-loading indicator -->
    <div
      v-if="isAutoLoading"
      data-testid="auto-loading-indicator"
      class="auto-loading-indicator"
    >
      Loading existing app data…
    </div>

    <!-- Step Indicators -->
    <div class="step-indicators">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        :data-testid="'step-indicator'"
        :data-active="currentStep === index"
        class="step-indicator"
        :class="{ active: currentStep === index, completed: currentStep > index }"
      >
        <div class="step-number">{{ index + 1 }}</div>
        <div class="step-label">{{ step.label }}</div>
      </div>
    </div>

    <!-- Step Content -->
    <div class="step-content">
      <!-- Step 0: Project Information -->
      <div v-if="currentStep === 0" class="step-panel">
        <!-- Step 0 error banner (from auto-load failures) -->
        <div
          v-if="step0Error"
          data-testid="step0-error-banner"
          class="step0-error-banner"
          role="alert"
        >
          ⚠️ {{ step0Error }}
        </div>

        <ProjectInfoForm
          v-model="projectMetadata"
          :prefill-data="prefillData"
          data-testid="project-info-form"
        />
      </div>

      <!-- Step 1: Select Modules -->
      <div v-if="currentStep === 1" class="step-panel">
        <ModuleSelector
          data-testid="module-selector"
          :selected-modules="selectedModules"
          @update:selected-modules="selectedModules = $event"
        />
      </div>

      <!-- Step 2: Configure -->
      <div v-if="currentStep === 2" class="step-panel">
        <ResourceForm
          :selected-modules="selectedModules"
          :modules="modules"
          :rbac-relationships="rbacRelationships"
          :prefill-instances="prefillResourceInstances"
          @update:instances="handleInstancesUpdate"
          @open-rbac-manager="handleOpenRbacManager"
        />
      </div>

      <!-- Step 3: RBAC Relationships (NEW) -->
      <div v-if="currentStep === 3" class="step-panel">
        <RbacManager
          :modelValue="rbacRelationships"
          @update:modelValue="(val) => (rbacRelationships = val)"
          :resource-instances="resourceInstances"
          data-testid="rbac-manager"
        />
      </div>

      <!-- Step 4: Review -->
      <div v-if="currentStep === 4" class="step-panel">
        <ReviewPage
          :project-info="projectInfo"
          :selected-modules="selectedModulesForReview"
          :resource-instances="resourceInstancesForReview"
          :rbac-relationships="rbacRelationshipsForReview"
          @edit-step="handleEditStep"
        />
      </div>

      <!-- Step 5: Deploy -->
      <div v-if="currentStep === 5" class="step-panel">
        <DeploymentPage
          :project-info="projectInfo"
          :module-count="selectedModules.length"
          :instance-count="totalInstanceCount"
          :rbac-count="rbacRelationships.length"
          :deployment-status="deploymentStatus"
          :deployment-progress="deploymentProgress"
          :correlation-id="correlationId"
          :pull-request-url="pullRequestUrl"
          :pull-request-number="pullRequestNumber"
          :workflow-url="workflowUrl"
          :error-message="errorMessage"
          :workflow-start-time="workflowStartTime"
          :workflow-end-time="workflowEndTime"
          @deploy="handleDeployInfrastructure"
          @back="previousStep"
          @retry="handleRetryDeployment"
          @view-apps="handleViewApps"
          @deploy-another="handleDeployAnother"
        />
      </div>
    </div>

    <!-- Navigation Actions -->
    <div class="step-actions">
      <button
        v-if="currentStep > 0"
        data-testid="back-step-button"
        @click="previousStep"
        class="btn-secondary"
      >
        Back
      </button>

      <button
        data-testid="cancel-button"
        @click="handleCancel"
        class="btn-secondary"
      >
        Cancel
      </button>

      <button
        v-if="currentStep < steps.length - 1"
        data-testid="next-step-button"
        @click="nextStep"
        :disabled="!canProceedToNextStep"
        class="btn-primary"
      >
        Next
      </button>

      <button
        v-else
        data-testid="deploy-button"
        @click="handleDeploy"
        :disabled="!canDeploy"
        class="btn-primary"
      >
        Generate Infrastructure Code
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useNavigationStore } from '../stores/navigation'
import { useAuth } from '../composables/useAuth'
import api from '../services/api'
import ProjectInfoForm from '../components/infrastructure/ProjectInfoForm.vue'
import ModuleSelector from '../components/infrastructure/ModuleSelector.vue'
import ResourceForm from '../components/infrastructure/ResourceForm.vue'
import RbacManager from '../components/infrastructure/RbacManager.vue'
import ReviewPage from '../components/infrastructure/ReviewPage.vue'
import DeploymentPage from '../components/infrastructure/DeploymentPage.vue'
import type { AppMetadata } from '../types/infrastructure.types'

const navigationStore = useNavigationStore()
const { isAuthenticated } = useAuth()

// Module type (matches what API returns)
interface Module {
  name: string
  description: string
  version: string
  category: string
  supportsMultiInstance: boolean
}

// Step configuration
const steps = [
  { id: 'project-info', label: 'Project Info' },
  { id: 'select', label: 'Select Modules' },
  { id: 'configure', label: 'Configure' },
  { id: 'rbac', label: 'RBAC Relationships' },
  { id: 'review', label: 'Review' },
  { id: 'deploy', label: 'Deploy' }
]

const currentStep = ref(0)
const selectedModules = ref<string[]>([])
const modules = ref<Module[]>([])

// Project metadata state (Step 0)
const projectMetadata = ref({
  projectName: '',
  descriptiveName: '',
  environment: '',
  owner: '',
  lifecycle: 'experimental', // Always experimental by default
  projectAge: 0,
  approvalNumber: ''
})

// Resource configuration state
const resourceInstances = ref<Record<string, Array<{ name: string; nameError?: string }>>>({})
const rbacRelationships = ref<Array<{
  id: string
  sourceId: string
  sourceName: string
  targetId: string
  targetName: string
  role: string
  description?: string
}>>([])

// Watch RBAC relationships and auto-add/remove RBAC module
watch(rbacRelationships, (newRelationships) => {
  const hasRelationships = newRelationships.length > 0
  const hasRBACModule = selectedModules.value.includes('RBAC')

  if (hasRelationships && !hasRBACModule) {
    // Auto-add RBAC module when relationships are defined
    console.log('[RBAC Auto-Selection] Adding RBAC module - relationships defined:', newRelationships.length)
    selectedModules.value = [...selectedModules.value, 'RBAC']
  } else if (!hasRelationships && hasRBACModule) {
    // Auto-remove RBAC module when all relationships are cleared
    console.log('[RBAC Auto-Selection] Removing RBAC module - no relationships')
    selectedModules.value = selectedModules.value.filter(m => m !== 'RBAC')
  }
}, { deep: true })

// Deployment state (Step 5)
const deploymentStatus = ref<'ready' | 'deploying' | 'success' | 'error'>('ready')
const deploymentProgress = ref(0)
const correlationId = ref<string | undefined>()
const pullRequestUrl = ref<string | undefined>()
const pullRequestNumber = ref<string | number | undefined>()
const workflowUrl = ref<string | undefined>()
const errorMessage = ref<string | undefined>()
const workflowStartTime = ref<string | undefined>()
const workflowEndTime = ref<string | undefined>()

// Guard against double-triggering deployments (e.g., double-click)
const deploymentRequestInFlight = ref(false)

// FR-003: Pre-fill state
const prefillData = ref<AppMetadata | undefined>(undefined)
const prefillResourceInstances = ref<Record<string, Array<{ name: string }>> | undefined>(undefined)
const step0Error = ref<string | undefined>(undefined)
/** Feature flag — set VITE_ENABLE_CATALOG_PREFILL=true to enable */
const prefillEnabled = computed(() =>
  import.meta.env.VITE_ENABLE_CATALOG_PREFILL !== 'false'
)

// Editing mode state (FR-004)
const isEditingMode = ref(false)
const editingAppName = ref<string | null>(null)
const editingEnvironment = ref<string | null>(null)
const isAutoLoading = ref(false)

/**
 * Parse flat instance names (e.g. ['appServiceWindows-1', 'appServiceWindows-2', 'keyvault'])
 * back into module types + per-type instance lists.
 * If a flat name doesn't match any known module type prefix, it is treated as its own type.
 */
function parseModuleInstances(
  flatModules: string[],
  availableModuleTypes: string[]
): { selectedModuleTypes: string[]; resourceInstances: Record<string, Array<{ name: string }>> } {
  const instancesByType: Record<string, string[]> = {}

  for (const flatName of flatModules) {
    // Skip the auto-managed RBAC pseudo-module
    if (flatName === 'RBAC') continue

    // Find the longest matching module type prefix (greedy to avoid partial matches)
    const matchedType = availableModuleTypes
      .filter(type => flatName === type || flatName.startsWith(`${type}-`))
      .sort((a, b) => b.length - a.length)[0]

    const key = matchedType ?? flatName
    if (!instancesByType[key]) instancesByType[key] = []
    instancesByType[key].push(flatName)
  }

  const selectedModuleTypes = Object.keys(instancesByType)
  const resourceInstances: Record<string, Array<{ name: string }>> = {}
  for (const [type, names] of Object.entries(instancesByType)) {
    resourceInstances[type] = names.map(n => ({ name: n }))
  }

  return { selectedModuleTypes, resourceInstances }
}

/** Populate wizard state from fetched app metadata */
function handlePrefill(metadata: AppMetadata) {
  prefillData.value = metadata
  step0Error.value = undefined
  // FR-003: Set selectedModules from metadata.modules, mapping flat instance names → module types
  if (Array.isArray(metadata.modules) && metadata.modules.length > 0) {
    const availableModuleTypeNames = modules.value.map(m => m.name)
    const { selectedModuleTypes, resourceInstances: parsedInstances } =
      parseModuleInstances(metadata.modules, availableModuleTypeNames)
    selectedModules.value = selectedModuleTypes
    prefillResourceInstances.value = parsedInstances
  }
  // Restore RBAC relationships from metadata.rbacPairs (if present)
  rbacRelationships.value = Array.isArray(metadata.rbacPairs)
    ? metadata.rbacPairs.map((pair, index) => ({
        id: pair.id || `prefill-rbac-${index + 1}`,
        sourceId: pair.sourceId || pair.sourceName || `prefill-source-${index + 1}`,
        sourceName: pair.sourceName,
        targetId: pair.targetId || pair.targetName || `prefill-target-${index + 1}`,
        targetName: pair.targetName,
        role: pair.role,
        description: pair.description
      }))
    : []
}

/** Reset editing mode and all wizard state to initial values */
function clearEditingMode(): void {
  isEditingMode.value = false
  editingAppName.value = null
  editingEnvironment.value = null
  prefillData.value = undefined
  prefillResourceInstances.value = undefined
  step0Error.value = undefined
  selectedModules.value = []
  rbacRelationships.value = []
  resourceInstances.value = {}
  currentStep.value = 0
}

// Navigation methods
const nextStep = () => {
  if (currentStep.value < steps.length - 1) {
    currentStep.value++
  }
}

const previousStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

const handleCancel = () => {
  navigationStore.navigateToPage('home')
}

const handleDeploy = () => {
  // This is called by the "Generate Infrastructure Code" button on Step 5 (if we had one in the actions)
  // But now code generation is initiated from within DeploymentPage component
  console.log('Generate infrastructure code')
}

// Poll for workflow status - MATCHES VANILLA JAVASCRIPT BEHAVIOR EXACTLY
const pollWorkflowStatus = async (correlationId: string) => {
  const maxPolls = 20 // Poll for up to ~3.5 minutes (10 seconds intervals) - same as vanilla JS
  let pollCount = 0
  const pollInterval = 10000 // 10 seconds - MUST MATCH VANILLA JAVASCRIPT

  console.log(`------------------------------------------------------------`)
  console.log(`WORKFLOW STATUS CHECK: Looking for correlation ID: ${correlationId}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`------------------------------------------------------------`)

  while (pollCount < maxPolls) {
    pollCount++

    try {
      const response = await api.getWorkflowStatus(correlationId)

      // Extract actual status data from API response wrapper
      const statusData = response.data || response

      // Log exactly like vanilla JavaScript does
      console.log(`Workflow status response for ${correlationId}:`, statusData)

      // Update progress based on status - matching vanilla JS progression
      if (statusData.status === 'pending' || statusData.status === 'queued') {
        deploymentProgress.value = 40
        console.log(`Status: ${statusData.status} (queued)`)
      } else if (statusData.status === 'in_progress') {
        deploymentProgress.value = 60
        console.log(`Status: in_progress`)
      } else if (statusData.status === 'completed' || statusData.conclusion === 'success') {
        // Workflow completed successfully - EXACTLY like vanilla JS
        deploymentProgress.value = 100
        deploymentStatus.value = 'success'

        // Extract PR URL and Workflow URL exactly like vanilla JS
        // Priority: prUrl field, then pr_url, then nested data.prUrl
        const extractedPrUrl = statusData.prUrl || statusData.pr_url || (statusData.data && statusData.data.prUrl)
        // Priority: url field, then workflow_url, then nested data.url
        const extractedWorkflowUrl = statusData.url || statusData.workflow_url || (statusData.data && statusData.data.url)

        // Extract workflow timing for duration calculation
        const extractedCreatedAt = statusData.createdAt || (statusData.data && statusData.data.createdAt)
        const extractedUpdatedAt = statusData.updatedAt || (statusData.data && statusData.data.updatedAt)

        if (extractedPrUrl) {
          pullRequestUrl.value = extractedPrUrl
          console.log('Found PR URL:', extractedPrUrl)
        }
        if (extractedWorkflowUrl) {
          workflowUrl.value = extractedWorkflowUrl
          console.log('Found workflow URL:', extractedWorkflowUrl)
        }
        if (extractedCreatedAt) {
          workflowStartTime.value = extractedCreatedAt
          console.log('Found workflow start time:', extractedCreatedAt)
        }
        if (extractedUpdatedAt) {
          workflowEndTime.value = extractedUpdatedAt
          console.log('Found workflow end time:', extractedUpdatedAt)
        }

        console.log('------------------------------------------------------------')
        console.log('WORKFLOW STATUS RESULT: Found matching workflow run')
        console.log(`Correlation ID: ${correlationId}`)
        console.log(`Workflow URL: ${extractedWorkflowUrl || 'N/A'}`)
        console.log(`Status: ${statusData.status}, Conclusion: ${statusData.conclusion || 'success'}`)
        console.log(`------------------------------------------------------------`)

        // Stop polling - workflow complete
        return
      } else if (statusData.status === 'failed' || statusData.conclusion === 'failure') {
        // Workflow failed - matching vanilla JS error handling
        deploymentStatus.value = 'error'
        errorMessage.value = `Workflow failed: ${statusData.conclusion || statusData.message || 'Unknown error'}`
        console.error('Workflow failed:', statusData)
        return // Stop polling
      }

      // Wait before next poll - MUST BE 10 SECONDS like vanilla JS
      await new Promise(resolve => setTimeout(resolve, pollInterval))

    } catch (error) {
      console.error(`Poll error (attempt ${pollCount}/${maxPolls}):`, error)

      // If we've exhausted polls, give up
      if (pollCount >= maxPolls) {
        deploymentStatus.value = 'error'
        errorMessage.value = 'Polling timeout - workflow status unknown. Check GitHub for workflow progress.'
        return
      }

      // Otherwise continue polling - with 10 second interval
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }
  }

  // Timeout reached - same behavior as vanilla JS
  console.warn('Polling timeout reached')
  deploymentStatus.value = 'error'
  errorMessage.value = 'Polling timeout - workflow may still be running. Check workflow URL for status.'
}

// Deployment handlers for Step 5
const handleDeployInfrastructure = async () => {
  // Check authentication before proceeding
  if (!isAuthenticated.value) {
    errorMessage.value = 'Authentication required. Please log in to deploy infrastructure.'
    deploymentStatus.value = 'error'
    console.error('Deployment failed: User not authenticated')
    return
  }

  if (deploymentRequestInFlight.value || deploymentStatus.value === 'deploying') {
    console.warn('Deployment already in progress; ignoring duplicate deploy click')
    return
  }

  deploymentRequestInFlight.value = true

  // Reset any previous deployment state
  deploymentStatus.value = 'deploying'
  deploymentProgress.value = 0
  errorMessage.value = undefined
  pullRequestUrl.value = undefined
  pullRequestNumber.value = undefined
  workflowUrl.value = undefined

  try {
    // Generate correlation ID - EXACTLY like vanilla JavaScript
    correlationId.value = `cid-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`

    console.log('------------------------------------------------------------')
    console.log('DEPLOYMENT INITIATED')
    console.log(`Correlation ID: ${correlationId.value}`)
    console.log(`Project: ${projectMetadata.value.projectName}`)
    console.log(`Environment: ${projectMetadata.value.environment}`)
    console.log(`Modules: ${selectedModules.value.join(', ')}`)
    console.log('------------------------------------------------------------')

    // Prepare deployment payload - EXACTLY matching vanilla JS structure
    // Vanilla JS sends:
    // 1. modules: array of flattened instance names (e.g., ['AppService-1', 'AppService-2', 'Storage'])
    // 2. moduleInstances: array of objects with { module, instances, count }
    const selectedModulesWithInstances = selectedModules.value.map(moduleName => {
      const instances = resourceInstances.value[moduleName] || []
      // If no instances defined or empty, use module name as default (single instance)
      const instanceList = instances.length > 0 ? instances.map(inst => inst.name) : [moduleName]

      return {
        module: moduleName,
        instances: instanceList,
        count: instanceList.length
      }
    })

    // Flatten all instance names for the modules array - CRITICAL for multi-instance support
    const modulesList = selectedModulesWithInstances.flatMap(m => m.instances)

    const payload = {
      projectName: projectMetadata.value.projectName,
      project_desc: projectMetadata.value.descriptiveName,
      environment: projectMetadata.value.environment,
      owner: projectMetadata.value.owner,
      lifecycle: projectMetadata.value.lifecycle,
      projectAge: projectMetadata.value.projectAge,
      crNumber: projectMetadata.value.approvalNumber || '', // Backend expects crNumber
      modules: modulesList, // FIXED: Send flattened instance names, not just module names
      moduleInstances: selectedModulesWithInstances, // FIXED: Send proper structure with module, instances, count
      rbacPairs: formatRbacPairsForDeployment(),
      correlationId: correlationId.value
    }

    console.log('Generating infrastructure code with payload:', payload)

    // Initial progress - submitting request (20% like vanilla JS progression)
    deploymentProgress.value = 20

    // Call API to generate infrastructure code - using centralized API service
    const result = await api.provisionCustom(payload)

    // Log the API response like vanilla JS does
    console.log('API Response:', result)

    // Check for successful response (either has success=true or has correlationId)
    // Backend returns { success: true, message, url, correlationId } on success
    const isSuccess = result && (result.success === true || result.correlationId)

    if (!isSuccess) {
      let errorMessage = 'Deployment failed'
      if (result && result.error) {
        errorMessage = result.error
      } else if (result && result.message && !result.success) {
        errorMessage = result.message
      }
      throw new Error(errorMessage)
    }

    // Workflow triggered - progress to 30% (matching vanilla JS)
    deploymentProgress.value = 30

    console.log('Workflow triggered successfully!')
    console.log(`Workflow will be tracked via correlation ID: ${correlationId.value}`)
    console.log('Starting polling for workflow status...')

    // Poll for workflow status - EXACTLY like vanilla JavaScript
    await pollWorkflowStatus(correlationId.value)

  } catch (error) {
    console.error('------------------------------------------------------------')
    console.error('DEPLOYMENT ERROR')
    console.error(`Correlation ID: ${correlationId.value}`)
    console.error('Error:', error)
    console.error('------------------------------------------------------------')
    deploymentStatus.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : 'An unexpected error occurred during deployment'
  } finally {
    deploymentRequestInFlight.value = false
  }
}

const handleRetryDeployment = () => {
  // Reset to ready state to allow retry
  deploymentStatus.value = 'ready'
  deploymentProgress.value = 0
  errorMessage.value = undefined
  correlationId.value = undefined
}

const handleViewApps = () => {
  navigationStore.navigateToPage('apps')
}

const handleDeployAnother = () => {
  // Reset wizard state
  currentStep.value = 0
  selectedModules.value = []
  resourceInstances.value = {}
  prefillResourceInstances.value = undefined
  rbacRelationships.value = []
  projectMetadata.value = {
    projectName: '',
    descriptiveName: '',
    environment: '',
    owner: '',
    lifecycle: 'experimental',
    projectAge: 0,
    approvalNumber: ''
  }
  deploymentStatus.value = 'ready'
  deploymentProgress.value = 0
  correlationId.value = undefined
  pullRequestUrl.value = undefined
  pullRequestNumber.value = undefined
  workflowUrl.value = undefined
  errorMessage.value = undefined
}

// Helper to format RBAC pairs for API
const formatRbacPairsForDeployment = (): string => {
  if (rbacRelationships.value.length === 0) {
    return ''
  }

  return rbacRelationships.value
    .map(rel => `${rel.sourceName}|${rel.targetName}|${rel.role}`)
    .join(',')
}

// ResourceForm event handlers
const handleInstancesUpdate = (instances: Record<string, Array<{ name: string; nameError?: string }>>) => {
  resourceInstances.value = instances
  console.log('Instances updated:', instances)
}

const handleOpenRbacManager = () => {
  // TODO: Open RBAC Manager modal in Phase 7
  console.log('Open RBAC Manager (not implemented yet)')
}

// Fetch modules from API
const fetchModules = async () => {
  try {
    const response = await api.getModules()
    if (!response.success || !response.data) {
      throw new Error('Failed to fetch modules')
    }
    modules.value = response.data
  } catch (error) {
    console.error('Error fetching modules:', error)
    modules.value = []
  }
}

// Initialize on mount
onMounted(async () => {
  await fetchModules()

  // FR-003: Auto-load from navigation context
  const ctx = navigationStore.prefillContext
  if (ctx && prefillEnabled.value) {
    const nameValid = /^[a-zA-Z0-9_-]{1,64}$/.test(ctx.appName)
    const envValid = /^[a-zA-Z0-9_-]{1,64}$/.test(ctx.environment)
    if (!nameValid || !envValid) {
      step0Error.value = 'Invalid prefill context: appName/environment must be alphanumeric (hyphens and underscores allowed, max 64 chars).'
      navigationStore.clearPrefillContext()
      return
    }
    // Capture for banner before clearing
    isEditingMode.value = true
    editingAppName.value = ctx.appName
    editingEnvironment.value = ctx.environment
    // Clear context immediately so back-navigation does not re-trigger
    navigationStore.clearPrefillContext()
    // Auto-load
    isAutoLoading.value = true
    try {
      const response = await api.getAppMetadata(ctx.appName, ctx.environment)
      if (response.success && response.data) {
        handlePrefill(response.data as AppMetadata)
      } else {
        step0Error.value = (response as { error?: string }).error || `Failed to load metadata for ${ctx.appName}/${ctx.environment}.`
        isEditingMode.value = false
      }
    } catch {
      step0Error.value = 'Unable to reach the server. Please try again or use the Edit button from the Installed Apps page.'
      isEditingMode.value = false
    } finally {
      isAutoLoading.value = false
    }
  }
})

// Computed properties for ReviewPage
const projectInfo = computed(() => ({
  projectName: projectMetadata.value.projectName,
  description: projectMetadata.value.descriptiveName,
  environment: projectMetadata.value.environment,
  owner: projectMetadata.value.owner,
  lifecycle: projectMetadata.value.lifecycle,
  projectAge: projectMetadata.value.projectAge,
  approvalNumber: projectMetadata.value.approvalNumber
}))

const selectedModulesForReview = computed(() => {
  return modules.value.filter(m => selectedModules.value.includes(m.name))
})

const resourceInstancesForReview = computed(() => {
  const instances: Array<{ id: string; name: string; moduleType: string }> = []
  Object.entries(resourceInstances.value).forEach(([moduleType, moduleInstances]) => {
    moduleInstances.forEach((instance, index) => {
      instances.push({
        id: `${moduleType}-${index}`,
        name: instance.name,
        moduleType
      })
    })
  })
  return instances
})

const rbacRelationshipsForReview = computed(() => {
  return rbacRelationships.value.map(rel => ({
    id: rel.id,
    sourceId: rel.sourceId,
    sourceName: rel.sourceName,
    targetId: rel.targetId,
    targetName: rel.targetName,
    role: rel.role,
    description: rel.description || `${rel.sourceName} can access ${rel.targetName} with ${rel.role} permissions`
  }))
})

const totalInstanceCount = computed(() => {
  return Object.values(resourceInstances.value)
    .reduce((total, instances) => total + instances.length, 0)
})

// Edit step handler for ReviewPage
const handleEditStep = (step: number) => {
  currentStep.value = step
}

// Validation
const canProceedToNextStep = computed(() => {
  if (currentStep.value === 0) {
    // Step 0: Must have all required project metadata (lifecycle always experimental, approvalNumber optional)
    const pm = projectMetadata.value
    return !!(
      pm.projectName &&
      pm.descriptiveName &&
      pm.environment &&
      pm.owner &&
      pm.projectAge > 0 &&
      /^[a-zA-Z0-9]+$/.test(pm.projectName) && // Alphanumeric validation
      pm.projectName.length <= 8 // Max 8 characters
    )
  }
  if (currentStep.value === 1) {
    // Step 1: Must have at least one module selected
    return selectedModules.value.length > 0
  }
  if (currentStep.value === 3) {
    // Step 3 (RBAC): Always allow proceeding - RBAC is optional
    return true
  }
  // For now, allow proceeding from other steps
  return true
})

const canDeploy = computed(() => {
  // TODO: Add deployment validation
  return selectedModules.value.length > 0
})
</script>

<style scoped>
.custom-infrastructure-page {
  @apply max-w-7xl mx-auto px-4 py-8;
}

.page-header {
  @apply mb-8;
}

.page-header h1 {
  @apply text-3xl font-bold text-gray-900 dark:text-white mb-2;
}

.page-header p {
  @apply text-gray-600 dark:text-gray-300;
}

/* Step 0 error banner */
.step0-error-banner {
  @apply mb-4 px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300
         dark:border-yellow-700 rounded-lg text-yellow-800 dark:text-yellow-300 text-sm;
}

/* Step Indicators */
.step-indicators {
  @apply flex items-center justify-center mb-8 gap-4;
}

.step-indicator {
  @apply flex items-center gap-2 px-4 py-2 rounded-lg transition-colors;
  @apply bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400;
}

.step-indicator.active {
  @apply bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300;
}

.step-indicator.completed {
  @apply bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300;
}

.step-number {
  @apply flex items-center justify-center w-8 h-8 rounded-full;
  @apply bg-white dark:bg-gray-700 font-semibold;
}

.step-indicator.active .step-number {
  @apply bg-blue-600 text-white;
}

.step-indicator.completed .step-number {
  @apply bg-green-600 text-white;
}

.step-label {
  @apply font-medium;
}

/* Step Content */
.step-content {
  @apply mb-8;
}

.step-panel {
  @apply bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6;
}

.step-panel h2 {
  @apply text-2xl font-bold text-gray-900 dark:text-white mb-2;
}

/* Actions */
.step-actions {
  @apply flex justify-end gap-3;
}

.btn-primary {
  @apply px-6 py-2 bg-blue-600 text-white rounded-lg font-medium;
  @apply hover:bg-blue-700 transition-colors;
  @apply disabled:opacity-50 disabled:cursor-not-allowed;
}

.btn-secondary {
  @apply px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg font-medium;
  @apply hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors;
}

/* Editing mode banner (FR-004) */
.editing-mode-banner {
  @apply flex items-center justify-between mb-4 px-4 py-3 bg-yellow-50
         dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700
         rounded-lg text-yellow-800 dark:text-yellow-300 text-sm;
}

.clear-editing-btn {
  @apply ml-4 px-3 py-1 bg-yellow-200 dark:bg-yellow-800 text-yellow-900
         dark:text-yellow-100 rounded text-xs font-medium hover:bg-yellow-300
         dark:hover:bg-yellow-700 transition-colors cursor-pointer;
}

/* Auto-loading indicator */
.auto-loading-indicator {
  @apply mb-4 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200
         dark:border-blue-700 rounded-lg text-blue-700 dark:text-blue-300 text-sm;
}
</style>
