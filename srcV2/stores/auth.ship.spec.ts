/** FT-12 (logout part): authStore.logout() clears the signed-in user's recent ships. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@v2/services/authService', () => ({
  getAuthInstance: vi.fn(() => ({})),
  loginRequest: {}, tokenRequest: {}, silentRequest: {},
  setActiveAccount: vi.fn()
}))

import { useAuthStore } from './auth'
import { addRecent, readRecent } from '@v2/utils/shipRecentStorage'

const id = (n: number) => `0190000${n}-0000-7000-8000-00000000000${n}`
const entry = (n: number) => ({ correlationId: id(n), app: 'a', env: 'devsand', repo: 'o/r', branch: 'main', startedAt: new Date().toISOString() })

describe('auth store — logout clears ship recents (FT-12)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it("removes only the signed-in user's list; another profile user's list survives", async () => {
    const auth = useAuthStore()
    auth.user = { id: 'oid-1', email: 'a@x.io', name: 'A', tenantId: 't' }
    addRecent('oid-1', entry(1))
    addRecent('oid-2', entry(2))

    await auth.logout()

    expect(readRecent('oid-1')).toEqual([])
    expect(localStorage.getItem('ship.recent.v1.oid-1')).toBeNull()
    expect(readRecent('oid-2')).toHaveLength(1)
    expect(auth.user).toBeNull()
  })

  it('does not throw when nobody is signed in', async () => {
    const auth = useAuthStore()
    await expect(auth.logout()).resolves.toBeUndefined()
  })
})
