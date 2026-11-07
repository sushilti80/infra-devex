import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref, nextTick } from 'vue'
import StatusModal from './StatusModal.vue'
import type { WorkflowStatus } from '../../types/infrastructure.types'

// Mock useWorkflowPolling composable
const mockStatus = ref<WorkflowStatus | null>(null)
const mockIsPolling = ref(false)
const mockStartPolling = vi.fn()
const mockStopPolling = vi.fn()

vi.mock('@v2/composables/useWorkflowPolling', () => ({
  useWorkflowPolling: () => ({
    status: mockStatus,
    isPolling: mockIsPolling,
    startPolling: mockStartPolling,
    stopPolling: mockStopPolling
  })
}))

describe('StatusModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockStatus.value = null
    mockIsPolling.value = false
    mockStartPolling.mockClear()
    mockStopPolling.mockClear()
  })

  afterEach(() => {
    // Clean up any teleported content
    document.body.innerHTML = ''
  })

  // Helper to find element in document (Teleport renders to body)
  const findInDocument = (selector: string) => {
    return document.querySelector(selector)
  }

  describe('Visibility & Lifecycle', () => {
    it('renders when isVisible is true', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()
      
      expect(findInDocument('.modal-backdrop')).toBeTruthy()
    })

    it('does not render when isVisible is false', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: false
        }
      })
      
      await nextTick()
      
      expect(findInDocument('.modal-backdrop')).toBeFalsy()
    })

    it('starts polling when visible with correlationId', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })

      await nextTick()
      expect(mockStartPolling).toHaveBeenCalledWith('test-123', 'pending', 'custom')
    })

    it('stops polling when hidden', async () => {
      const wrapper = mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })

      await wrapper.setProps({ isVisible: false })
      await nextTick()

      expect(mockStopPolling).toHaveBeenCalled()
    })
  })

  describe('Pending State (Blue)', () => {
    beforeEach(() => {
      mockStatus.value = {
        correlationId: 'test-123',
        status: 'pending',
        percentage: 35,
        message: 'Your request is being processed.'
      }
    })

    it('displays pending title', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true,
          workflowType: 'custom'
        }
      })
      
      await nextTick()
      await nextTick()

      const text = document.body.textContent || ''
      expect(text).toContain('Custom Infrastructure')
      expect(text).toContain('Starting...')
    })

    it('shows spinner icon', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const icon = findInDocument('i.fa-spinner')
      expect(icon).toBeTruthy()
      expect(icon?.classList.contains('fa-spin')).toBe(true)
    })

    it('applies blue color classes to header', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const header = findInDocument('.px-6.py-4.border-b')
      expect(header?.classList.contains('bg-blue-50')).toBe(true)
    })

    it('displays progress bar with correct percentage', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const text = document.body.textContent || ''
      expect(text).toContain('35%')
    })

    it('shows "Please Wait" button in disabled state', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const button = document.querySelector('button[disabled]')
      expect(button).toBeTruthy()
      expect(button?.textContent).toContain('Please Wait')
    })
  })

  describe('In Progress State (Yellow)', () => {
    beforeEach(() => {
      mockStatus.value = {
        correlationId: 'test-123',
        status: 'in_progress',
        percentage: 75,
        message: 'Provisioning infrastructure...'
      }
    })

    it('displays in progress title', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const text = document.body.textContent || ''
      expect(text).toContain('In Progress...')
    })

    it('shows cog icon with spin animation', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const icon = findInDocument('i.fa-cog')
      expect(icon).toBeTruthy()
      expect(icon?.classList.contains('fa-spin')).toBe(true)
    })

    it('applies yellow color classes to header', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const header = findInDocument('.px-6.py-4.border-b')
      expect(header?.classList.contains('bg-yellow-50')).toBe(true)
    })

    it('displays progress bar at 75%', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const text = document.body.textContent || ''
      expect(text).toContain('75%')
    })
  })

  describe('Success State (Green)', () => {
    beforeEach(() => {
      mockStatus.value = {
        correlationId: 'test-123',
        status: 'completed',
        percentage: 100,
        message: 'Your infrastructure has been provisioned successfully.',
        resultUrl: 'https://github.com/org/repo/pull/1234',
        prNumber: 1234,
        workflowUrl: 'https://github.com/org/repo/actions/runs/567'
      }
    })

    it('displays success title', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const text = document.body.textContent || ''
      expect(text).toContain('Successful!')
    })

    it('shows check icon', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const icon = findInDocument('i.fa-check-circle')
      expect(icon).toBeTruthy()
    })

    it('applies green color classes to header', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const header = findInDocument('.px-6.py-4.border-b')
      expect(header?.classList.contains('bg-green-50')).toBe(true)
    })

    it('displays PR link', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const prLink = document.querySelector('a[href*="pull/1234"]')
      expect(prLink).toBeTruthy()
      expect(prLink?.textContent).toContain('View PR #1234')
    })

    it('shows close button', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const buttons = Array.from(document.querySelectorAll('button:not([disabled])'))
      const closeButton = buttons.find(btn => btn.textContent?.includes('Close'))
      expect(closeButton).toBeTruthy()
    })

    it('emits success event', async () => {
      // Set status after mounting to trigger watch
      mockStatus.value = null

      const wrapper = mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })

      await nextTick()
      
      // Now set the success status to trigger the watch
      mockStatus.value = {
        correlationId: 'test-123',
        status: 'success',
        percentage: 100,
        message: 'Success!'
      }

      await nextTick()
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('success')).toBeTruthy()
    })

    it('emits close event when close button clicked', async () => {
      const wrapper = mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const buttons = Array.from(document.querySelectorAll('button:not([disabled])'))
      const closeButton = buttons.find(btn => btn.textContent?.includes('Close')) as HTMLButtonElement
      closeButton?.click()
      
      await nextTick()

      expect(wrapper.emitted('close')).toBeTruthy()
      expect(mockStopPolling).toHaveBeenCalled()
    })
  })

  describe('Failure State (Red)', () => {
    beforeEach(() => {
      mockStatus.value = {
        correlationId: 'test-123',
        status: 'failed',
        percentage: 100,
        message: 'Deployment failed',
        error: 'Terraform validation failed: Module "storage" configuration invalid.',
        workflowUrl: 'https://github.com/org/repo/actions/runs/567'
      }
    })

    it('displays failure title', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const text = document.body.textContent || ''
      expect(text).toContain('Failed')
    })

    it('shows times-circle icon', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const icon = findInDocument('i.fa-times-circle')
      expect(icon).toBeTruthy()
    })

    it('applies red color classes to header', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const header = findInDocument('.px-6.py-4.border-b')
      expect(header?.classList.contains('bg-red-50')).toBe(true)
    })

    it('displays error message', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const text = document.body.textContent || ''
      expect(text).toContain('Terraform validation failed')
    })

    it('shows retry button', async () => {
      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const buttons = Array.from(document.querySelectorAll('button'))
      const retryButton = buttons.find(btn => btn.textContent?.includes('Retry'))
      expect(retryButton).toBeTruthy()
    })

    it('emits failure event', async () => {
      // Set status after mounting to trigger watch
      mockStatus.value = null

      const wrapper = mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })

      await nextTick()
      
      // Now set the failed status to trigger the watch
      mockStatus.value = {
        correlationId: 'test-123',
        status: 'failed',
        percentage: 100,
        error: 'Test error'
      }

      await nextTick()
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('failure')).toBeTruthy()
    })

    it('emits retry event when retry button clicked', async () => {
      const wrapper = mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true
        }
      })
      
      await nextTick()
      await nextTick()

      const buttons = Array.from(document.querySelectorAll('button'))
      const retryButton = buttons.find(btn => btn.textContent?.includes('Retry')) as HTMLButtonElement
      retryButton?.click()
      
      await nextTick()

      expect(wrapper.emitted('retry')).toBeTruthy()
      expect(mockStopPolling).toHaveBeenCalled()
    })
  })

  describe('Workflow Types', () => {
    const testWorkflowType = async (workflowType: string, expectedText: string) => {
      mockStatus.value = {
        correlationId: 'test-123',
        status: 'pending',
        percentage: 0
      }

      mount(StatusModal, {
        props: {
          correlationId: 'test-123',
          isVisible: true,
          workflowType: workflowType as any
        }
      })
      
      await nextTick()
      await nextTick()

      const text = document.body.textContent || ''
      expect(text).toContain(expectedText)
    }

    it('displays correct title for custom workflow', () => testWorkflowType('custom', 'Custom Infrastructure'))
    it('displays correct title for template workflow', () => testWorkflowType('template', 'Template Deployment'))
    it('displays correct title for AKS workflow', () => testWorkflowType('aks', 'AKS Deployment'))
    it('displays correct title for delete workflow', () => testWorkflowType('delete', 'Infrastructure Deletion'))
    it('displays correct title for promote workflow', () => testWorkflowType('promote', 'Environment Promotion'))
  })
})
