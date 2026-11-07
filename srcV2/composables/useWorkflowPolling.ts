import { ref, readonly, computed, onUnmounted } from 'vue'
import { useWorkflowStore } from '@v2/stores/workflow'
import type { WorkflowStatus } from '@v2/types/infrastructure.types'

export function useWorkflowPolling() {
  const workflowStore = useWorkflowStore()
  const currentCorrelationId = ref<string | null>(null)

  /**
   * Get the current workflow status as a computed ref
   */
  const status = computed<WorkflowStatus | null>(() => {
    if (!currentCorrelationId.value) return null
    return workflowStore.getWorkflowStatus(currentCorrelationId.value) || null
  })

  /**
   * Check if currently polling
   */
  const isPolling = computed(() => {
    if (!currentCorrelationId.value) return false
    // Check if there's an active polling interval for this correlation ID
    return workflowStore.pollingIntervals.has(currentCorrelationId.value)
  })

  /**
   * Start polling a workflow by its correlation ID
   * @param correlationId - Unique workflow identifier
   * @param initialStatus - Initial status (default: 'pending')
   * @param workflowType - Type of workflow (aks, infra, etc.) - default: 'infra'
   */
  function startPolling(correlationId: string, initialStatus: string = 'pending', workflowType: string = 'infra') {
    currentCorrelationId.value = correlationId
    workflowStore.trackWorkflow(correlationId, initialStatus, workflowType)
  }

  /**
   * Stop polling the current workflow
   */
  function stopPolling() {
    if (currentCorrelationId.value) {
      workflowStore.stopPolling(currentCorrelationId.value)
      currentCorrelationId.value = null
    }
  }

  /**
   * Start tracking a workflow (alias for startPolling for backward compatibility)
   */
  function startTracking(correlationId: string, initialStatus: string = 'pending', workflowType: string = 'infra') {
    startPolling(correlationId, initialStatus, workflowType)
  }

  /**
   * Stop tracking (alias for stopPolling for backward compatibility)
   */
  function stopTracking() {
    stopPolling()
  }

  /**
   * Get the current workflow status (function version)
   */
  function getStatus(): WorkflowStatus | undefined {
    if (!currentCorrelationId.value) return undefined
    return workflowStore.getWorkflowStatus(currentCorrelationId.value)
  }

  /**
   * Check if workflow is in a completed state
   */
  function isComplete(): boolean {
    const currentStatus = getStatus()
    return ['completed', 'success', 'failed', 'failure', 'timeout', 'not_found'].includes(currentStatus?.status || '')
  }

  /**
   * Check if workflow completed successfully
   */
  function isSuccess(): boolean {
    const currentStatus = getStatus()
    return ['completed', 'success'].includes(currentStatus?.status || '')
  }

  /**
   * Check if workflow failed
   */
  function isFailed(): boolean {
    const currentStatus = getStatus()
    return ['failed', 'failure'].includes(currentStatus?.status || '')
  }

  // Cleanup on component unmount
  onUnmounted(() => {
    stopPolling()
  })

  return {
    // Reactive refs (what StatusModal expects)
    status,
    isPolling,
    startPolling,
    stopPolling,
    
    // Additional exports for backward compatibility
    currentCorrelationId: readonly(currentCorrelationId),
    startTracking,
    stopTracking,
    getStatus,
    isComplete,
    isSuccess,
    isFailed
  }
}
