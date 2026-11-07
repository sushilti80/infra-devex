/** FT-07 progress mapping (7 -> 5 labels, aria-live) + FT-06 progress default view. */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ShipProgress from './ShipProgress.vue'
import { toDisplayStages } from '@v2/utils/shipHelpers'
import { CID, status, stages, FORBIDDEN_DEFAULT_TERMS } from './ship.fixtures'

describe('toDisplayStages (FT-07)', () => {
  const labels = (s: ReturnType<typeof stages>) => toDisplayStages(s).map(d => `${d.label}:${d.state}`)

  it('maps 7 internal stages onto exactly the 5 closed labels, in order', () => {
    expect(toDisplayStages(stages()).map(d => d.label)).toEqual(['Build', 'Security check', 'Publish', 'Review PR', 'Preview'])
  })

  it('Build = queued + prepare + build', () => {
    expect(labels(stages({ queued: 'running' }))[0]).toBe('Build:running')
    expect(labels(stages({ queued: 'succeeded', prepare: 'running' }))[0]).toBe('Build:running')
    expect(labels(stages({ queued: 'succeeded', prepare: 'succeeded', build: 'pending' }))[0]).toBe('Build:running') // some done, some to do
    expect(labels(stages({ queued: 'succeeded', prepare: 'succeeded', build: 'succeeded' }))[0]).toBe('Build:succeeded')
    expect(labels(stages({ queued: 'succeeded', prepare: 'succeeded', build: 'failed' }))[0]).toBe('Build:failed')
    expect(labels(stages())[0]).toBe('Build:pending')
  })

  it('one-to-one labels: scan, publish, config_pr, preview (incl. skipped)', () => {
    const l = labels(stages({ queued: 'succeeded', prepare: 'succeeded', build: 'succeeded', scan: 'succeeded', publish: 'running', config_pr: 'pending', preview: 'pending' }))
    expect(l.slice(1)).toEqual(['Security check:succeeded', 'Publish:running', 'Review PR:pending', 'Preview:pending'])
    expect(labels(stages({ config_pr: 'skipped', preview: 'skipped' })).slice(3)).toEqual(['Review PR:skipped', 'Preview:skipped'])
  })

  it('tolerates missing stages (treated as pending)', () => {
    expect(toDisplayStages([]).every(d => d.state === 'pending')).toBe(true)
  })

  it('a failure anywhere in a group wins', () => {
    expect(labels(stages({ queued: 'failed', prepare: 'running' }))[0]).toBe('Build:failed')
  })
})

describe('ShipProgress (FT-07, FT-06)', () => {
  it('renders the five labels with state text and an aria-live polite status', () => {
    const w = mount(ShipProgress, { props: { status: status() } })
    expect(w.findAll('[data-testid="ship-stages"] li').map(li => li.find('span:nth-of-type(2)').text())).toEqual(['Build', 'Security check', 'Publish', 'Review PR', 'Preview'])
    const live = w.get('[data-testid="ship-live"]')
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.text()).toBe('Build: In progress')
  })

  it('live text tracks the active stage', () => {
    const w = mount(ShipProgress, { props: { status: status({ stages: stages({ queued: 'succeeded', prepare: 'succeeded', build: 'succeeded', scan: 'running' }) }) } })
    expect(w.get('[data-testid="ship-live"]').text()).toBe('Security check: In progress')
  })

  it('default view uses only the closed label set: no internal stage names, IDs or technical terms', () => {
    const w = mount(ShipProgress, { props: { status: status({ queuedBehind: true }) } })
    const text = w.text()
    for (const re of FORBIDDEN_DEFAULT_TERMS) expect(text).not.toMatch(re)
    expect(text).not.toContain(CID)
    expect(text).not.toMatch(/\bprepare\b|\bConfig PR\b|\bQueued\b(?! behind)/i)
    expect(text).toContain('Queued behind another ship')
  })

  it('Details toggle reveals the 7 internal stages and the correlation ID, and the extra slot', async () => {
    const w = mount(ShipProgress, { props: { status: status() }, slots: { 'details-extra': '<p>LOGS-SLOT</p>' } })
    const btn = w.findAll('button').find(b => b.text() === 'Details')!
    expect(btn.attributes('aria-expanded')).toBe('false')
    await btn.trigger('click')
    const d = w.get('[data-testid="ship-details"]')
    expect(d.text()).toContain(CID)
    expect(d.findAll('li').map(li => li.text().split(':')[0])).toEqual(['Queued', 'Prepare', 'Build', 'Scan', 'Publish', 'Config PR', 'Preview URL'])
    expect(d.text()).toContain('LOGS-SLOT')
    expect(btn.attributes('aria-expanded')).toBe('true')
  })

  it('Cancel is offered while queued/building and hidden once publish has started or the ship is terminal', async () => {
    const early = mount(ShipProgress, { props: { status: status() } })
    expect(early.findAll('button').some(b => b.text() === 'Cancel')).toBe(true)
    await early.findAll('button').find(b => b.text() === 'Cancel')!.trigger('click')
    expect(early.emitted('cancel')).toHaveLength(1)

    const publishing = mount(ShipProgress, { props: { status: status({ stages: stages({ queued: 'succeeded', prepare: 'succeeded', build: 'succeeded', scan: 'succeeded', publish: 'running' }) }) } })
    expect(publishing.findAll('button').some(b => b.text() === 'Cancel')).toBe(false)

    const done = mount(ShipProgress, { props: { status: status({ state: 'succeeded', terminal: true }) } })
    expect(done.findAll('button').some(b => b.text() === 'Cancel')).toBe(false)
  })

  it('shows Cancelling… and disables Cancel once requested', () => {
    const w = mount(ShipProgress, { props: { status: status(), cancelling: true } })
    expect(w.text()).toContain('Cancelling…')
    expect(w.findAll('button').find(b => b.text() === 'Cancel')!.attributes('disabled')).toBeDefined()
  })
})
