import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WorkflowStatus } from '@v2/types/infrastructure.types'
import api from '@v2/services/api'
import { useTelemetry } from '@v2/composables/useTelemetry'

export const useWorkflowStore = defineStore('workflow', () => {
  const { trackEvent, startTimer, endTimer } = useTelemetry()

  // State: Map of correlation IDs to workflow states
  const workflows = ref<Map<string, WorkflowStatus>>(new Map())
  const pollingIntervals = ref<Map<string, number>>(new Map())
  const workflowTypes = ref<Map<string, string>>(new Map()) // Track workflow types (aks, infra, etc.)
  const pollingStartTimes = ref<Map<string, number>>(new Map()) // Track when polling started for timeout
  const POLLING_TIMEOUT_MS = 120000 // 2 minutes default timeout
  const AGENT_POLLING_TIMEOUT_MS = 600000 // 10 minutes for agent workflows

  /**
   * Track a new workflow
   * @param correlationId - Unique workflow identifier
   * @param initialStatus - Initial status of the workflow
   * @param workflowType - Type of workflow (aks, infra, etc.) - default: 'infra'
   */
  function trackWorkflow(correlationId: string, initialStatus: string = 'pending', workflowType: string = 'infra') {
    console.log(`[WorkflowStore] Tracking new workflow: ${correlationId} with status: ${initialStatus}, type: ${workflowType}`)

    // Store workflow type for later API calls
    workflowTypes.value.set(correlationId, workflowType)

    // Record start time for timeout tracking
    pollingStartTimes.value.set(correlationId, Date.now())
    startTimer(correlationId)
    trackEvent('workflow_track_started', { workflowType, correlationId })

    workflows.value.set(correlationId, {
      correlationId,
      status: initialStatus as any,
      percentage: 0,
      message: 'Starting workflow...',
      prUrl: undefined,
      workflowUrl: undefined,
      resultUrl: undefined,
      error: undefined
    })

    // Start polling automatically
    startPolling(correlationId)
  }

  /**
   * Start polling for workflow status
   * @param correlationId - Workflow to poll
   * @param intervalMs - Polling interval in milliseconds (default: 10s)
   */
  function startPolling(correlationId: string, intervalMs: number = 10000) {
    // Clear existing interval if any
    stopPolling(correlationId)

    console.log(`[WorkflowStore] Starting polling for ${correlationId} every ${intervalMs}ms`)

    const intervalId = window.setInterval(async () => {
      try {
        // Get workflow type first (needed for timeout and API call)
        const workflowType = workflowTypes.value.get(correlationId) || 'infra'

        // Check for timeout (varies by workflow type)
        const startTime = pollingStartTimes.value.get(correlationId) || Date.now()
        const elapsedTime = Date.now() - startTime
        const timeoutMs = workflowType === 'agent' ? AGENT_POLLING_TIMEOUT_MS : POLLING_TIMEOUT_MS

        if (elapsedTime > timeoutMs) {
          console.warn(`[WorkflowStore] Polling timeout reached for ${correlationId} (${elapsedTime}ms)`)
          const workflow = workflows.value.get(correlationId)
          if (workflow) {
            workflow.status = 'timeout' as any
            workflow.percentage = 50
            workflow.message = 'Tracking timeout. Workflow may still be running. Please reach out to DevOps for PR approval directly.'
            workflow.error = 'Polling timeout after 2 minutes'
          }
          endTimer(correlationId, 'workflow_poll_timeout', { workflowType, correlationId })
          stopPolling(correlationId)
          return
        }

        console.log(`[WorkflowStore] Polling status for ${correlationId}... (${Math.round(elapsedTime/1000)}s elapsed)`)

        // Use the appropriate API method based on workflow type
        const response = workflowType === 'aks'
          ? await api.getAKSStatus(correlationId)
          : await api.getWorkflowStatus(correlationId, workflowType)

        console.log(`[WorkflowStore] Received response for ${correlationId} (type: ${workflowType}):`, response)

        const workflow = workflows.value.get(correlationId)
        if (workflow && response && typeof response === 'object') {
          // Handle different response structures based on workflow type
          // AKS returns: { success: true, status: { status, conclusion, url, ... } }
          // Infra returns: { status, conclusion, url, prUrl, message, ... }
          const statusData = (workflowType === 'aks' && 'status' in response && response.status)
            ? response.status  // Extract nested status for AKS
            : response         // Use flat response for infrastructure

          // Update workflow state from backend response (only if statusData is an object)
          if (typeof statusData === 'object' && statusData !== null) {
            const previousStatus = String(workflow.status)
            workflow.status = statusData.status as any
            workflow.message = statusData.message || workflow.message
            workflow.prUrl = statusData.prUrl
            workflow.workflowUrl = statusData.url || statusData.workflowUrl
            workflow.resultUrl = statusData.url || statusData.resultUrl
            workflow.error = statusData.error
            if (String(workflow.status) !== previousStatus) {
              trackEvent('workflow_status_changed', {
                workflowType,
                correlationId,
                previousStatus,
                newStatus: String(workflow.status),
              })
            }
          }

          // Calculate percentage based on status
          if (workflow.status === 'completed' || workflow.status === 'success') {
            workflow.percentage = 100
          } else if (workflow.status === 'in_progress') {
            workflow.percentage = 50
          } else if (workflow.status === 'queued' || workflow.status === 'pending') {
            workflow.percentage = 25
          }

          console.log(`[WorkflowStore] Updated workflow state:`, {
            status: workflow.status,
            percentage: workflow.percentage,
            message: workflow.message,
            prUrl: workflow.prUrl,
            workflowUrl: workflow.workflowUrl
          })

          // Stop polling on terminal states
          if (['completed', 'success', 'failed', 'failure', 'timeout', 'not_found'].includes(workflow.status)) {
            console.log(`[WorkflowStore] Terminal state reached for ${correlationId}, stopping polling`)
            endTimer(correlationId, 'workflow_terminal', {
              workflowType,
              correlationId,
              finalStatus: String(workflow.status),
            })
            stopPolling(correlationId)
          }
        }
      } catch (err) {
        console.error(`[WorkflowStore] Polling error for ${correlationId}:`, err)
        // Continue polling on error (could implement exponential backoff here)
      }
    }, intervalMs)

    pollingIntervals.value.set(correlationId, intervalId)
  }

  /**
   * Stop polling for a workflow
   * @param correlationId - Workflow to stop polling
   */
  function stopPolling(correlationId: string) {
    const intervalId = pollingIntervals.value.get(correlationId)
    if (intervalId) {
      clearInterval(intervalId)
      pollingIntervals.value.delete(correlationId)
      workflowTypes.value.delete(correlationId) // Clean up workflow type
      pollingStartTimes.value.delete(correlationId) // Clean up start time
    }
  }

  /**
   * Stop all active polling
   */
  function stopAllPolling() {
    pollingIntervals.value.forEach((intervalId) => {
      clearInterval(intervalId)
    })
    pollingIntervals.value.clear()
    workflowTypes.value.clear() // Clean up all workflow types
    pollingStartTimes.value.clear() // Clean up all start times
  }

  /**
   * Get workflow status by correlation ID
   * @param correlationId - Workflow identifier
   */
  function getWorkflowStatus(correlationId: string): WorkflowStatus | undefined {
    return workflows.value.get(correlationId)
  }

  /**
   * Remove workflow from tracking
   * @param correlationId - Workflow to remove
   */
  function removeWorkflow(correlationId: string) {
    stopPolling(correlationId)
    workflows.value.delete(correlationId)
  }

  return {
    workflows,
    pollingIntervals,
    trackWorkflow,
    startPolling,
    stopPolling,
    stopAllPolling,
    getWorkflowStatus,
    removeWorkflow
  }
})
