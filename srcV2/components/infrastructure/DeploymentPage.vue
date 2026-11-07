<template>
  <div class="deployment-page">
    <!-- Deployment Status Header -->
    <div class="deployment-header">
      <div class="status-icon" :class="statusIconClass">
        <i :class="statusIconName"></i>
      </div>
      <h2 class="deployment-title">{{ deploymentTitle }}</h2>
      <p class="deployment-description">{{ deploymentDescription }}</p>
    </div>

    <!-- Pre-Deployment State -->
    <div v-if="deploymentStatus === 'ready'" class="deployment-ready">
      <div class="ready-checklist">
        <h3 class="checklist-title">
          <i class="fas fa-clipboard-check"></i>
          Pre-Deployment Checklist
        </h3>
        <div class="checklist-items">
          <div class="checklist-item">
            <i class="fas fa-check-circle text-green-600"></i>
            <span>Project configuration validated</span>
          </div>
          <div class="checklist-item">
            <i class="fas fa-check-circle text-green-600"></i>
            <span>{{ moduleCount }} modules selected</span>
          </div>
          <div class="checklist-item">
            <i class="fas fa-check-circle text-green-600"></i>
            <span>{{ instanceCount }} resource instances configured</span>
          </div>
          <div class="checklist-item" :class="{ 'text-gray-400': rbacCount === 0 }">
            <i :class="rbacCount > 0 ? 'fas fa-check-circle text-green-600' : 'fas fa-circle text-gray-300'"></i>
            <span>{{ rbacCount }} RBAC relationships defined</span>
          </div>
        </div>
      </div>

      <div class="deployment-summary">
        <h3 class="summary-title">
          <i class="fas fa-file-alt"></i>
          What will be deployed?
        </h3>
        <div class="summary-content">
          <div class="summary-item">
            <span class="summary-label">Project Abbreviation:</span>
            <span class="summary-value font-semibold">{{ projectInfo.projectName }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Environment:</span>
            <span class="summary-value">
              <span class="badge" :class="environmentBadgeClass">
                {{ projectInfo.environment }}
              </span>
            </span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Lifecycle:</span>
            <span class="summary-value">
              <span class="badge" :class="lifecycleBadgeClass">
                {{ projectInfo.lifecycle }}
              </span>
            </span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Owner:</span>
            <span class="summary-value">{{ projectInfo.owner }}</span>
          </div>
          <div v-if="estimatedDuration" class="summary-item">
            <span class="summary-label">Estimated Duration:</span>
            <span class="summary-value text-gray-600">{{ estimatedDuration }}</span>
          </div>
        </div>
      </div>

      <div class="deployment-actions">
        <button
          @click="$emit('back')"
          class="btn-secondary"
          data-testid="back-button"
        >
          <i class="fas fa-arrow-left"></i>
          Back to Review
        </button>
        <button
          @click="handleDeploy"
          class="btn-primary btn-large"
          data-testid="deploy-button"
        >
          <i class="fas fa-rocket"></i>
          Generate Infrastructure Code
        </button>
      </div>
    </div>

    <!-- Deploying State -->
    <div v-else-if="deploymentStatus === 'deploying'" class="deployment-progress">
      <div class="progress-indicator">
        <div class="spinner-large">
          <i class="fas fa-spinner fa-spin"></i>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar">
            <div class="progress-bar-fill" :style="{ width: `${deploymentProgress}%` }"></div>
          </div>
          <span class="progress-percentage">{{ deploymentProgress }}%</span>
        </div>
      </div>

      <div class="deployment-stages">
        <h3 class="stages-title">Deployment Progress</h3>
        <div class="stage-list">
          <div
            v-for="stage in deploymentStages"
            :key="stage.id"
            class="stage-item"
            :class="stageStatusClass(stage)"
          >
            <div class="stage-icon">
              <i v-if="stage.status === 'completed'" class="fas fa-check-circle"></i>
              <i v-else-if="stage.status === 'in_progress'" class="fas fa-spinner fa-spin"></i>
              <i v-else class="fas fa-circle"></i>
            </div>
            <div class="stage-content">
              <div class="stage-name">{{ stage.name }}</div>
              <div class="stage-description">{{ stage.description }}</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="correlationId" class="correlation-info">
        <i class="fas fa-info-circle"></i>
        <span>Correlation ID: <code>{{ correlationId }}</code></span>
      </div>
    </div>

    <!-- Success State -->
    <div v-else-if="deploymentStatus === 'success'" class="deployment-success">
      <div class="success-animation">
        <i class="fas fa-check-circle"></i>
      </div>

      <div class="success-content">
        <h3 class="success-title">Deployment Successful!</h3>
        <p class="success-message">
          Your infrastructure has been successfully deployed to the <strong>{{ projectInfo.environment }}</strong> environment.
        </p>

        <div class="deployment-details">
          <div class="detail-card">
            <i class="fas fa-link"></i>
            <div>
              <div class="detail-label">Pull Request</div>
              <a
                v-if="pullRequestUrl"
                :href="pullRequestUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="detail-link"
              >
                View PR #{{ pullRequestNumber }}
                <i class="fas fa-external-link-alt"></i>
              </a>
              <span v-else class="detail-value text-gray-500">Pending...</span>
            </div>
          </div>

          <div class="detail-card">
            <i class="fas fa-code-branch"></i>
            <div>
              <div class="detail-label">Workflow</div>
              <a
                v-if="workflowUrl"
                :href="workflowUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="detail-link"
              >
                View Workflow
                <i class="fas fa-external-link-alt"></i>
              </a>
              <span v-else class="detail-value text-gray-500">Not available</span>
            </div>
          </div>

          <div class="detail-card">
            <i class="fas fa-clock"></i>
            <div>
              <div v-if="deploymentDuration" class="detail-label">Duration</div>
              <div v-if="deploymentDuration" class="detail-value">{{ deploymentDuration }}</div>
            </div>
          </div>
        </div>

        <div class="next-steps">
          <h4 class="next-steps-title">
            <i class="fas fa-tasks"></i>
            Next Steps
          </h4>
          <ul class="next-steps-list">
            <li> Have Prncipal or Devops review and approve the pull request in GitHub </li>
            <li>Once PR is approved and merged, view resources in Azure Portal from Installed Apps page in with infew minutes</li>
            <li>Configure any additional settings as needed in the generated infrastructure code</li>
          </ul>
        </div>
      </div>

      <div class="success-actions">
        <button
          @click="$emit('view-apps')"
          class="btn-secondary"
          data-testid="view-apps-button"
        >
          <i class="fas fa-list"></i>
          View All Applications
        </button>
        <button
          @click="$emit('deploy-another')"
          class="btn-primary"
          data-testid="deploy-another-button"
        >
          <i class="fas fa-plus"></i>
          Deploy Another
        </button>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="deploymentStatus === 'error'" class="deployment-error">
      <div class="error-animation">
        <i class="fas fa-exclamation-circle"></i>
      </div>

      <div class="error-content">
        <h3 class="error-title">Deployment Failed</h3>
        <p class="error-message">
          We encountered an error while deploying your infrastructure.
        </p>

        <div class="error-details">
          <div class="error-code">
            <span class="error-label">Error Message:</span>
            <code class="error-value">{{ errorMessage }}</code>
          </div>
          <div v-if="correlationId" class="error-code">
            <span class="error-label">Correlation ID:</span>
            <code class="error-value">{{ correlationId }}</code>
          </div>
        </div>

        <div class="error-help">
          <h4 class="error-help-title">
            <i class="fas fa-question-circle"></i>
            What to do next?
          </h4>
          <ul class="error-help-list">
            <li>Check the error message above for specific details</li>
            <li>Verify your project configuration is correct</li>
            <li>Review the GitHub Actions logs for more information</li>
            <li>Contact support if the issue persists</li>
          </ul>
        </div>
      </div>

      <div class="error-actions">
        <button
          @click="$emit('back')"
          class="btn-secondary"
          data-testid="back-to-review-button"
        >
          <i class="fas fa-arrow-left"></i>
          Back to Review
        </button>
        <button
          @click="handleRetry"
          class="btn-primary"
          data-testid="retry-button"
        >
          <i class="fas fa-redo"></i>
          Try Again
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface ProjectInfo {
  projectName: string
  description: string
  environment: string
  owner: string
  lifecycle: string
  projectAge: number
  approvalNumber: string
}

interface Props {
  projectInfo: ProjectInfo
  moduleCount: number
  instanceCount: number
  rbacCount: number
  deploymentStatus?: 'ready' | 'deploying' | 'success' | 'error'
  deploymentProgress?: number
  correlationId?: string
  pullRequestUrl?: string
  pullRequestNumber?: string | number
  workflowUrl?: string
  errorMessage?: string
  workflowStartTime?: string
  workflowEndTime?: string
}

const props = withDefaults(defineProps<Props>(), {
  deploymentStatus: 'ready',
  deploymentProgress: 0,
  errorMessage: 'An unexpected error occurred during deployment'
})

const emit = defineEmits<{
  deploy: []
  back: []
  retry: []
  'view-apps': []
  'deploy-another': []
}>()

// Deployment stages that update reactively based on progress
const deploymentStages = computed(() => [
  {
    id: 'validation',
    name: 'Validation',
    description: 'Validating project configuration',
    status: props.deploymentProgress >= 20 ? 'completed' : props.deploymentProgress > 0 ? 'in_progress' : 'pending'
  },
  {
    id: 'terraform',
    name: 'Terraform Planning',
    description: 'Generating Terraform execution plan',
    status: props.deploymentProgress >= 40 ? 'completed' : props.deploymentProgress >= 20 ? 'in_progress' : 'pending'
  },
  {
    id: 'workflow',
    name: 'GitHub Actions',
    description: 'Executing deployment workflow',
    status: props.deploymentProgress >= 60 ? 'completed' : props.deploymentProgress >= 40 ? 'in_progress' : 'pending'
  },
  {
    id: 'pr-creation',
    name: 'Pull Request',
    description: 'Creating pull request in GitHub',
    status: props.deploymentProgress >= 90 ? 'completed' : props.deploymentProgress >= 60 ? 'in_progress' : 'pending'
  },
  {
    id: 'completion',
    name: 'Finalizing',
    description: 'Updating metadata and completing deployment',
    status: props.deploymentProgress === 100 ? 'completed' : props.deploymentProgress >= 90 ? 'in_progress' : 'pending'
  }
])

// Computed properties
const deploymentTitle = computed(() => {
  switch (props.deploymentStatus) {
    case 'ready':
      return 'Ready to Generate Infrastructure Code'
    case 'deploying':
      return 'Generating Infrastructure Code'
    case 'success':
      return 'Infrastructure Code Generated'
    case 'error':
      return 'Code Generation Failed'
    default:
      return 'Generate Infrastructure Code'
  }
})

const deploymentDescription = computed(() => {
  switch (props.deploymentStatus) {
    case 'ready':
      return 'Review the summary below and click "Generate Infrastructure Code" to begin.'
    case 'deploying':
      return 'Your infrastructure code is being generated. This may take a few minutes...'
    case 'success':
      return 'Your infrastructure code has been successfully generated and is ready for review.'
    case 'error':
      return 'An error occurred during code generation. Please review the details below.'
    default:
      return ''
  }
})

const statusIconClass = computed(() => {
  switch (props.deploymentStatus) {
    case 'ready':
      return 'status-icon-ready'
    case 'deploying':
      return 'status-icon-deploying'
    case 'success':
      return 'status-icon-success'
    case 'error':
      return 'status-icon-error'
    default:
      return ''
  }
})

const statusIconName = computed(() => {
  switch (props.deploymentStatus) {
    case 'ready':
      return 'fas fa-rocket'
    case 'deploying':
      return 'fas fa-spinner fa-spin'
    case 'success':
      return 'fas fa-check-circle'
    case 'error':
      return 'fas fa-exclamation-circle'
    default:
      return 'fas fa-circle'
  }
})

const environmentBadgeClass = computed(() => {
  const env = props.projectInfo.environment.toLowerCase()
  return {
    'badge-blue': env === 'devsand',
    'badge-green': env === 'sand',
    'badge-red': env === 'prod'
  }
})

const lifecycleBadgeClass = computed(() => {
  const lifecycle = props.projectInfo.lifecycle.toLowerCase()
  return {
    'badge-yellow': lifecycle === 'experimental',
    'badge-blue': lifecycle === 'development',
    'badge-purple': lifecycle === 'production'
  }
})

const deploymentDuration = computed(() => {
  // Calculate actual duration from workflow metadata
  if (props.workflowStartTime && props.workflowEndTime) {
    const start = new Date(props.workflowStartTime).getTime()
    const end = new Date(props.workflowEndTime).getTime()
    const durationMs = end - start
    
    const minutes = Math.floor(durationMs / 60000)
    const seconds = Math.floor((durationMs % 60000) / 1000)
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }
  return null // Don't show duration if not available
})

const estimatedDuration = computed(() => {
  // Only show estimated duration when ready to deploy
  return props.deploymentStatus === 'ready' ? '5-10 minutes' : null
})

const stageStatusClass = (stage: any) => {
  return {
    'stage-completed': stage.status === 'completed',
    'stage-in-progress': stage.status === 'in_progress',
    'stage-pending': stage.status === 'pending'
  }
}

// Event handlers
const handleDeploy = () => {
  emit('deploy')
}

const handleRetry = () => {
  emit('retry')
}
</script>

<style scoped>
.deployment-page {
  max-width: 900px;
  margin: 0 auto;
}

/* Header */
.deployment-header {
  text-align: center;
  padding: 2rem 0;
  border-bottom: 2px solid #e5e7eb;
  margin-bottom: 2rem;
}

.status-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 1.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.5rem;
}

.status-icon-ready {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.status-icon-deploying {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

.status-icon-success {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  color: white;
}

.status-icon-error {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
  color: white;
}

.deployment-title {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.deployment-description {
  font-size: 1.125rem;
  color: #6b7280;
}

/* Ready State */
.deployment-ready {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.ready-checklist {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
}

.checklist-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.checklist-title i {
  color: #10b981;
}

.checklist-items {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1rem;
  color: #374151;
}

.deployment-summary {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
}

.summary-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.summary-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: #f9fafb;
  border-radius: 8px;
}

.summary-label {
  font-weight: 500;
  color: #6b7280;
}

.summary-value {
  color: #1f2937;
}

.deployment-actions {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 2rem;
}

/* Deploying State */
.deployment-progress {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.progress-indicator {
  text-align: center;
}

.spinner-large {
  font-size: 4rem;
  color: #667eea;
  margin-bottom: 2rem;
}

.progress-bar-container {
  max-width: 500px;
  margin: 0 auto;
}

.progress-bar {
  height: 12px;
  background: #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  transition: width 0.3s ease;
}

.progress-percentage {
  font-size: 1.125rem;
  font-weight: 600;
  color: #667eea;
}

.deployment-stages {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
}

.stages-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 1rem;
}

.stage-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.stage-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  border-radius: 8px;
  transition: background 0.2s;
}

.stage-completed {
  background: #f0fdf4;
}

.stage-in-progress {
  background: #fef3c7;
}

.stage-pending {
  background: #f9fafb;
}

.stage-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.stage-completed .stage-icon {
  color: #10b981;
}

.stage-in-progress .stage-icon {
  color: #f59e0b;
}

.stage-pending .stage-icon {
  color: #d1d5db;
}

.stage-content {
  flex: 1;
}

.stage-name {
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.stage-description {
  font-size: 0.875rem;
  color: #6b7280;
}

.correlation-info {
  text-align: center;
  padding: 1rem;
  background: #f3f4f6;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #6b7280;
  font-size: 0.875rem;
}

.correlation-info code {
  background: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  color: #1f2937;
}

/* Success State */
.deployment-success {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.success-animation {
  text-align: center;
  font-size: 5rem;
  color: #10b981;
  animation: scaleIn 0.5s ease-out;
}

@keyframes scaleIn {
  from {
    transform: scale(0);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.success-content {
  text-align: center;
}

.success-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.success-message {
  font-size: 1.125rem;
  color: #6b7280;
  margin-bottom: 2rem;
}

.deployment-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.detail-card {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.detail-card > i {
  font-size: 1.5rem;
  color: #667eea;
  flex-shrink: 0;
}

.detail-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.detail-link {
  color: #667eea;
  text-decoration: none;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.detail-link:hover {
  text-decoration: underline;
}

.detail-value {
  color: #1f2937;
  font-weight: 500;
}

.next-steps {
  background: #f9fafb;
  border-radius: 12px;
  padding: 1.5rem;
  text-align: left;
}

.next-steps-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.next-steps-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.next-steps-list li {
  padding-left: 1.5rem;
  position: relative;
  color: #4b5563;
}

.next-steps-list li::before {
  content: '→';
  position: absolute;
  left: 0;
  color: #667eea;
  font-weight: bold;
}

.success-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

/* Error State */
.deployment-error {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.error-animation {
  text-align: center;
  font-size: 5rem;
  color: #ef4444;
  animation: shake 0.5s ease-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-10px); }
  75% { transform: translateX(10px); }
}

.error-content {
  text-align: center;
}

.error-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.error-message {
  font-size: 1.125rem;
  color: #6b7280;
  margin-bottom: 2rem;
}

.error-details {
  background: #fef2f2;
  border: 2px solid #fecaca;
  border-radius: 12px;
  padding: 1.5rem;
  text-align: left;
  margin-bottom: 2rem;
}

.error-code {
  margin-bottom: 1rem;
}

.error-code:last-child {
  margin-bottom: 0;
}

.error-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: #991b1b;
  margin-bottom: 0.5rem;
}

.error-value {
  display: block;
  background: white;
  padding: 0.75rem;
  border-radius: 6px;
  font-family: 'Courier New', monospace;
  color: #dc2626;
  font-size: 0.875rem;
  overflow-x: auto;
}

.error-help {
  background: #f9fafb;
  border-radius: 12px;
  padding: 1.5rem;
  text-align: left;
}

.error-help-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.error-help-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.error-help-list li {
  padding-left: 1.5rem;
  position: relative;
  color: #4b5563;
}

.error-help-list li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: #667eea;
  font-size: 1.25rem;
}

.error-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

/* Badges */
.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: capitalize;
}

.badge-blue {
  background: #dbeafe;
  color: #1e40af;
}

.badge-green {
  background: #d1fae5;
  color: #065f46;
}

.badge-red {
  background: #fee2e2;
  color: #991b1b;
}

.badge-yellow {
  background: #fef3c7;
  color: #92400e;
}

.badge-purple {
  background: #e9d5ff;
  color: #6b21a8;
}

/* Buttons */
.btn-secondary,
.btn-primary {
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn-secondary {
  background: white;
  color: #4b5563;
  border: 2px solid #e5e7eb;
}

.btn-secondary:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
}

.btn-large {
  padding: 1rem 2rem;
  font-size: 1.125rem;
}
</style>
