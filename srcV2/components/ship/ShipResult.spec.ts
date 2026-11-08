/** FT-09 result: version / PR / preview rules per preview.state, PR open|merged|closed, post-merge copy, Technical details collapsed. */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ShipResult from './ShipResult.vue'
import { CID, succeeded, FORBIDDEN_DEFAULT_TERMS } from './ship.fixtures'

const mountResult = (s = succeeded(), props: Record<string, unknown> = {}) => mount(ShipResult, { props: { status: s, ...props } })

describe('ShipResult (FT-09)', () => {
  it('shows version, duration and the PR link with the required label', () => {
    const w = mountResult()
    expect(w.get('[data-testid="ship-version"]').text()).toBe('0.1.3')
    expect(w.text()).toContain('3 min 12 s')
    const pr = w.get('[data-testid="ship-pr"] a')
    expect(pr.text()).toContain('Request production deploy via this PR')
    expect(pr.attributes('href')).toBe('https://github.com/organization/flux-config/pull/17')
    expect(pr.attributes('rel')).toContain('noopener')
  })

  it('preview available: URL with Copy and Open-in-new-tab, reachability wording', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mountResult()
    const link = w.get('[data-testid="ship-preview"] a')
    expect(link.attributes('href')).toBe('https://pr-17-my-app.preview.example/')
    expect(link.attributes('target')).toBe('_blank')
    expect(w.get('[data-testid="ship-preview"]').text()).toMatch(/few minutes to become reachable/)
    await w.get('[data-testid="ship-preview"] button').trigger('click')
    expect(writeText).toHaveBeenCalledWith('https://pr-17-my-app.preview.example/')
  })

  it('preview not_configured: PR link only and the setup message (no preview URL)', () => {
    const w = mountResult(succeeded({ preview: { state: 'not_configured' } }))
    expect(w.get('[data-testid="ship-preview"]').text()).toContain('Preview link will be added once the platform team finishes setup')
    expect(w.find('[data-testid="ship-preview"] a').exists()).toBe(false)
    expect(w.get('[data-testid="ship-pr"] a').exists()).toBe(true)
  })

  it('preview pending / unavailable_chart wording', () => {
    expect(mountResult(succeeded({ preview: { state: 'pending' } })).get('[data-testid="ship-preview"]').text()).toContain('Preview URL available after the config PR is created')
    expect(mountResult(succeeded({ preview: { state: 'unavailable_chart' } })).get('[data-testid="ship-preview"]').text()).toContain("Preview isn't available for this app")
  })

  it('never renders a non-http(s) preview URL even if state=available (tampered response)', () => {
    const w = mountResult(succeeded({ preview: { state: 'available', url: 'javascript:alert(1)' } }))
    expect(w.find('[data-testid="ship-preview"] a').exists()).toBe(false)
  })

  it('never renders a non-https PR link', () => {
    const w = mountResult(succeeded({ pr: { number: 1, url: 'javascript:alert(1)', state: 'open' } }))
    expect(w.find('[data-testid="ship-pr"] a').exists()).toBe(false)
  })

  it('PR states: open / merged / closed', () => {
    expect(mountResult(succeeded({ pr: { number: 1, url: 'https://github.com/o/r/pull/1', state: 'merged' } })).get('[data-testid="ship-pr"]').text()).toContain('was merged')
    const closed = mountResult(succeeded({ pr: { number: 1, url: 'https://github.com/o/r/pull/1', state: 'closed' } }))
    expect(closed.get('[data-testid="ship-pr"]').text()).toContain('closed without merging')
    expect(closed.get('[data-testid="ship-pr"]').text()).toContain('new preview link')
    expect(closed.find('[data-testid="ship-pr"] a').exists()).toBe(false)
  })

  it('post-merge variant: "Version X.Y.Z will roll out automatically in a few minutes", no preview block', () => {
    const w = mountResult(succeeded({ rollout: 'flux_auto_roll', pr: undefined, preview: { state: 'pending' } }))
    expect(w.get('[data-testid="ship-post-merge-note"]').text()).toBe('Version 0.1.3 will roll out automatically in a few minutes.')
    expect(w.find('[data-testid="ship-preview"]').exists()).toBe(false)
    expect(w.find('[data-testid="ship-pr"]').exists()).toBe(false)
  })

  it('Technical details are collapsed by default and revealed on demand (repo@sha, image, digest)', async () => {
    const w = mountResult()
    expect(w.find('[data-testid="ship-tech"]').exists()).toBe(false)
    const toggle = w.findAll('button').find(b => b.text() === 'Technical details')!
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    const t = w.get('[data-testid="ship-tech"]').text()
    expect(t).toContain('organization/my-app@aaaaaaa')
    expect(t).toContain('registry.example/selfserve/my-app:0.1.3')
    expect(t).toContain('sha256:')
  })

  it('default view hides technical terms and the correlation ID (FT-06)', () => {
    const text = mountResult().text()
    for (const re of FORBIDDEN_DEFAULT_TERMS) expect(text).not.toMatch(re)
    expect(text).not.toContain(CID)
    expect(text).not.toContain('sha256')
  })

  it('Ship new version emits and explains that pushes are not deployed automatically', async () => {
    const w = mountResult(succeeded(), { branch: 'release/1' })
    expect(w.text()).toContain('Your changes are not deployed automatically. Push your code to release/1, then click Ship new version.')
    await w.findAll('button').find(b => b.text() === 'Ship new version')!.trigger('click')
    expect(w.emitted('new-version')).toHaveLength(1)
  })

  it('short durations render in seconds; missing duration is omitted', () => {
    expect(mountResult(succeeded({ durationSec: 42 })).text()).toContain('42 s')
    expect(mountResult(succeeded({ durationSec: undefined })).text()).not.toContain('Duration')
  })
})
