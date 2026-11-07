import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FeedbackPage from './FeedbackPage.vue'

// ─── Mock API service ─────────────────────────────────────────────────────────
const mockSubmitFeedback = vi.fn()

vi.mock('@v2/services/api', () => ({
  apiService: {
    submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args)
  },
  default: {
    submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args)
  }
}))

// ─── Mock auth store with a signed-in user ────────────────────────────────────
vi.mock('@v2/stores/auth', () => ({
  useAuthStore: () => ({
    user: { email: 'tester@example.com', name: 'Tester', id: '1', tenantId: 't1' }
  })
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mountPage() {
  return mount(FeedbackPage, {
    global: { plugins: [createPinia()] }
  })
}

async function fillBugForm(wrapper: ReturnType<typeof mountPage>) {
  await wrapper.find('[data-testid="title-field"]').setValue('Login button crashes')
  await wrapper.find('[data-testid="observed-behaviour-field"]').setValue('App crashes')
  await wrapper.find('[data-testid="expected-behaviour-field"]').setValue('Should log in')
}

async function fillFeatureForm(wrapper: ReturnType<typeof mountPage>) {
  await wrapper.find('[data-testid="tab-feature-request"]').trigger('click')
  await wrapper.find('[data-testid="title-field"]').setValue('Dark mode support')
  await wrapper.find('[data-testid="pain-point-field"]').setValue('Hurts my eyes at night')
  await wrapper.find('[data-testid="desired-outcome-field"]').setValue('Toggle dark theme')
}

async function fillAgentForm(wrapper: ReturnType<typeof mountPage>) {
  await wrapper.find('[data-testid="tab-agent-request"]').trigger('click')
  await wrapper.find('[data-testid="title-field"]').setValue('New provisioning agent')
  await wrapper.find('[data-testid="agent-behaviour-field"]').setValue('Auto-scale AKS clusters')
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('FeedbackPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockSubmitFeedback.mockReset()
  })

  // ── Rendering ───────────────────────────────────────────────────────────────
  describe('Rendering', () => {
    it('renders the page heading', () => {
      const wrapper = mountPage()
      expect(wrapper.find('h1').text()).toBe('Feedback')
    })

    it('renders three request-type tabs', () => {
      const wrapper = mountPage()
      expect(wrapper.find('[data-testid="tab-bug"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="tab-feature-request"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="tab-agent-request"]').exists()).toBe(true)
    })

    it('pre-fills the email field from auth store', () => {
      const wrapper = mountPage()
      const emailField = wrapper.find('[data-testid="email-field"]')
      expect((emailField.element as HTMLInputElement).value).toBe('tester@example.com')
    })

    it('email field is read-only', () => {
      const wrapper = mountPage()
      const emailField = wrapper.find('[data-testid="email-field"]')
      expect((emailField.element as HTMLInputElement).readOnly).toBe(true)
    })
  })

  // ── Tab switching ────────────────────────────────────────────────────────────
  describe('Tab switching', () => {
    it('shows bug fields by default', () => {
      const wrapper = mountPage()
      expect(wrapper.find('[data-testid="observed-behaviour-field"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="pain-point-field"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="agent-behaviour-field"]').exists()).toBe(false)
    })

    it('shows feature-request fields after clicking feature tab', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="tab-feature-request"]').trigger('click')
      expect(wrapper.find('[data-testid="pain-point-field"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="desired-outcome-field"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="observed-behaviour-field"]').exists()).toBe(false)
    })

    it('shows agent-request fields after clicking agent tab', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="tab-agent-request"]').trigger('click')
      expect(wrapper.find('[data-testid="agent-behaviour-field"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="observed-behaviour-field"]').exists()).toBe(false)
    })

    it('sets aria-selected on active tab', async () => {
      const wrapper = mountPage()
      const bugTab = wrapper.find('[data-testid="tab-bug"]')
      expect(bugTab.attributes('aria-selected')).toBe('true')

      await wrapper.find('[data-testid="tab-feature-request"]').trigger('click')
      expect(wrapper.find('[data-testid="tab-feature-request"]').attributes('aria-selected')).toBe('true')
      expect(bugTab.attributes('aria-selected')).toBe('false')
    })
  })

  // ── Client-side validation ───────────────────────────────────────────────────
  describe('Validation', () => {
    it('shows title error when submitting without a title', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="observed-behaviour-field"]').setValue('crash')
      await wrapper.find('[data-testid="expected-behaviour-field"]').setValue('works')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Title is required')
    })

    it('shows title error when title exceeds 120 characters', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="title-field"]').setValue('a'.repeat(121))
      await wrapper.find('[data-testid="observed-behaviour-field"]').setValue('crash')
      await wrapper.find('[data-testid="expected-behaviour-field"]').setValue('works')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('120 characters or fewer')
    })

    it('shows error when observed behaviour is empty (bug type)', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="title-field"]').setValue('Some title')
      await wrapper.find('[data-testid="expected-behaviour-field"]').setValue('works')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Observed behaviour is required')
    })

    it('shows error when expected behaviour is empty (bug type)', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="title-field"]').setValue('Some title')
      await wrapper.find('[data-testid="observed-behaviour-field"]').setValue('crashes')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Expected behaviour is required')
    })

    it('shows error when pain point is empty (feature type)', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="tab-feature-request"]').trigger('click')
      await wrapper.find('[data-testid="title-field"]').setValue('Some feature')
      await wrapper.find('[data-testid="desired-outcome-field"]').setValue('something')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Pain point')
    })

    it('shows error when desired outcome is empty (feature type)', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="tab-feature-request"]').trigger('click')
      await wrapper.find('[data-testid="title-field"]').setValue('Some feature')
      await wrapper.find('[data-testid="pain-point-field"]').setValue('problem')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Desired outcome is required')
    })

    it('shows error when agent behaviour is empty (agent type)', async () => {
      const wrapper = mountPage()
      await wrapper.find('[data-testid="tab-agent-request"]').trigger('click')
      await wrapper.find('[data-testid="title-field"]').setValue('New agent')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Agent behaviour description is required')
    })

    it('does not call API when validation fails', async () => {
      const wrapper = mountPage()
      await wrapper.find('form').trigger('submit')
      expect(mockSubmitFeedback).not.toHaveBeenCalled()
    })
  })

  // ── Submit state ─────────────────────────────────────────────────────────────
  describe('Submit state', () => {
    it('shows spinner while submitting', async () => {
      mockSubmitFeedback.mockReturnValue(new Promise(() => {}))
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      wrapper.find('form').trigger('submit')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="submit-spinner"]').exists()).toBe(true)
    })

    it('disables submit button while submitting', async () => {
      mockSubmitFeedback.mockReturnValue(new Promise(() => {}))
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      wrapper.find('form').trigger('submit')
      await wrapper.vm.$nextTick()
      const btn = wrapper.find('[data-testid="submit-button"]')
      expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    })
  })

  // ── Success state ─────────────────────────────────────────────────────────────
  describe('Success state', () => {
    beforeEach(() => {
      mockSubmitFeedback.mockResolvedValue({
        success: true,
        issueUrl: 'https://github.com/org/repo/issues/42',
        issueNumber: 42,
        correlationId: 'cid-test-123'
      })
    })

    it('shows success state after successful submission', async () => {
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="success-state"]').exists()).toBe(true)
    })

    it('hides form after successful submission', async () => {
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="feedback-form"]').exists()).toBe(false)
    })

    it('shows GitHub issue link in success state', async () => {
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      const link = wrapper.find('[data-testid="issue-link"]')
      expect(link.exists()).toBe(true)
      expect(link.attributes('href')).toBe('https://github.com/org/repo/issues/42')
    })

    it('issue link opens in new tab', async () => {
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      const link = wrapper.find('[data-testid="issue-link"]')
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toContain('noopener')
    })

    it('shows "Submit another" button in success state', async () => {
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="submit-another"]').exists()).toBe(true)
    })

    it('"Submit another" resets the form', async () => {
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      await wrapper.find('[data-testid="submit-another"]').trigger('click')
      expect(wrapper.find('[data-testid="feedback-form"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="success-state"]').exists()).toBe(false)
      const titleInput = wrapper.find('[data-testid="title-field"]')
      expect((titleInput.element as HTMLInputElement).value).toBe('')
    })
  })

  // ── Error state ───────────────────────────────────────────────────────────────
  describe('Error state', () => {
    it('shows error banner when submission fails', async () => {
      mockSubmitFeedback.mockRejectedValue(new Error('GitHub API error'))
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="error-banner"]').exists()).toBe(true)
    })

    it('shows error banner with correlationId', async () => {
      mockSubmitFeedback.mockRejectedValue(new Error('rate limit'))
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      const banner = wrapper.find('[data-testid="error-banner"]')
      expect(banner.text()).toContain('cid-')
    })

    it('form remains visible after error', async () => {
      mockSubmitFeedback.mockRejectedValue(new Error('oops'))
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="feedback-form"]').exists()).toBe(true)
    })

    it('submit button is re-enabled after error', async () => {
      mockSubmitFeedback.mockRejectedValue(new Error('oops'))
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      const btn = wrapper.find('[data-testid="submit-button"]')
      expect((btn.element as HTMLButtonElement).disabled).toBe(false)
    })
  })

  // ── Feature-request submission ────────────────────────────────────────────────
  describe('Feature-request submission', () => {
    it('calls submitFeedback with correct type for feature request', async () => {
      mockSubmitFeedback.mockResolvedValue({
        success: true,
        issueUrl: 'https://github.com/org/repo/issues/10',
        issueNumber: 10,
        correlationId: 'cid-x'
      })
      const wrapper = mountPage()
      await fillFeatureForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'feature-request' })
      )
    })
  })

  // ── Agent-request submission ──────────────────────────────────────────────────
  describe('Agent-request submission', () => {
    it('calls submitFeedback with correct type for agent request', async () => {
      mockSubmitFeedback.mockResolvedValue({
        success: true,
        issueUrl: 'https://github.com/org/repo/issues/20',
        issueNumber: 20,
        correlationId: 'cid-y'
      })
      const wrapper = mountPage()
      await fillAgentForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent-request' })
      )
    })
  })

  // ── Payload content ───────────────────────────────────────────────────────────
  describe('Payload content', () => {
    it('sends correct title in bug submission payload', async () => {
      mockSubmitFeedback.mockResolvedValue({
        success: true,
        issueUrl: 'https://github.com/org/repo/issues/1',
        issueNumber: 1,
        correlationId: 'cid-1'
      })
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Login button crashes', type: 'bug' })
      )
    })

    it('includes severity in bug submission payload', async () => {
      mockSubmitFeedback.mockResolvedValue({
        success: true,
        issueUrl: 'https://github.com/org/repo/issues/2',
        issueNumber: 2,
        correlationId: 'cid-2'
      })
      const wrapper = mountPage()
      await fillBugForm(wrapper)
      await wrapper.find('[data-testid="severity-select"]').setValue('High')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'High' })
      )
    })

    it('includes priority in feature-request payload', async () => {
      mockSubmitFeedback.mockResolvedValue({
        success: true,
        issueUrl: 'https://github.com/org/repo/issues/3',
        issueNumber: 3,
        correlationId: 'cid-3'
      })
      const wrapper = mountPage()
      await fillFeatureForm(wrapper)
      await wrapper.find('[data-testid="priority-select"]').setValue('High')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'High' })
      )
    })
  })
})
