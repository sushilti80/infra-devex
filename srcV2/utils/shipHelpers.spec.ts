import { describe, it, expect, beforeEach } from 'vitest'
import {
  isShipId, dnsLabelError, portError, healthPathError, branchError, parseRepoInput, appNameFromRepo,
  safeHttpsUrl, safePreviewUrl, toShipApiError, readShipParam, storePendingDeepLink, takePendingDeepLink,
  setShipQueryParam, PENDING_DEEP_LINK_KEY
} from './shipHelpers'

const V7 = '01926f3c-8a41-7b3e-9d2a-0123456789ab'

describe('shipHelpers', () => {
  it('isShipId accepts only UUIDv7', () => {
    expect(isShipId(V7)).toBe(true)
    expect(isShipId('01926f3c-8a41-4b3e-9d2a-0123456789ab')).toBe(false) // v4
    expect(isShipId('01926f3c-8a41-7b3e-7d2a-0123456789ab')).toBe(false) // bad variant
    expect(isShipId(`${V7} `)).toBe(false)
    expect(isShipId(undefined)).toBe(false)
  })

  it('dnsLabelError mirrors DNS-1123', () => {
    expect(dnsLabelError('App', 'my-app')).toBeNull()
    expect(dnsLabelError('App', '')).toMatch(/required/)
    for (const bad of ['My-App', '-a', 'a-', 'a_b', 'a.b']) expect(dnsLabelError('App', bad)).not.toBeNull()
    expect(dnsLabelError('App', 'a'.repeat(64))).toMatch(/63/)
  })

  it('portError enforces 1024-65535 integers', () => {
    expect(portError(8080, 1024, 65535)).toBeNull()
    expect(portError('1024', 1024, 65535)).toBeNull()
    for (const bad of [80, 1023, 65536, '8080.5', 'abc', '', null]) expect(portError(bad, 1024, 65535)).not.toBeNull()
  })

  it('healthPathError rejects shell-significant characters', () => {
    expect(healthPathError('/healthz')).toBeNull()
    expect(healthPathError('/')).toBeNull()
    for (const bad of ['healthz', '/a b', '/a"b', '/a$b', '/a`b', '/{x}']) expect(healthPathError(bad)).not.toBeNull()
  })

  it('branchError mirrors git-ref rules', () => {
    for (const ok of ['main', 'feature/x-1', 'release_1.2']) expect(branchError(ok)).toBeNull()
    for (const bad of ['', '-x', '/x', 'x/', 'a..b', 'a//b', 'x.', 'x.lock', 'a b', 'a@{b', 'x'.repeat(201)]) {
      expect(branchError(bad)).not.toBeNull()
    }
  })

  it('parseRepoInput accepts org/name and github URLs only', () => {
    expect(parseRepoInput('Aya-DevOpsTeam/my.repo')).toBe('Aya-DevOpsTeam/my.repo')
    expect(parseRepoInput('https://github.com/org/name.git')).toBe('org/name')
    expect(parseRepoInput('https://github.com/org/name/')).toBe('org/name')
    for (const bad of ['', 'org', 'org/', 'a/b/c', 'http://github.com/o/r', 'https://evil.com/o/r', 'o/r;rm', '../x/y']) {
      expect(parseRepoInput(bad)).toBeNull()
    }
  })

  it('appNameFromRepo sanitises to DNS-1123', () => {
    expect(appNameFromRepo('org/My_Cool.Repo')).toBe('my-cool-repo')
    expect(appNameFromRepo('org/-x-')).toBe('x')
    expect(appNameFromRepo('org/' + 'a'.repeat(80))).toHaveLength(63)
    expect(appNameFromRepo('org/___')).toBe('')
  })

  it('URL safety: https only for PR links; http(s) for previews; never credentials/javascript:', () => {
    expect(safeHttpsUrl('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1')
    for (const bad of ['http://x.io', 'javascript:alert(1)', 'data:text/html,x', 'https://u:p@x.io', 'nope', 5]) {
      expect(safeHttpsUrl(bad)).toBeNull()
    }
    expect(safePreviewUrl('http://pr-1-a.example')).toBe('http://pr-1-a.example/')
    expect(safePreviewUrl('javascript:alert(1)')).toBeNull()
  })

  it('toShipApiError normalises envelope errors, retry-after and network failures', () => {
    expect(toShipApiError(new Error('boom'))).toMatchObject({ status: 0, code: 'NETWORK' })
    const e = toShipApiError({
      response: { status: 429, headers: { 'retry-after': '30' }, data: { success: false, error: { code: 'PLATFORM_RATE_LIMITED', message: 'slow', details: { limit: 'user' }, hint: 'h' } } }
    })
    expect(e).toEqual({ status: 429, code: 'PLATFORM_RATE_LIMITED', message: 'slow', details: { limit: 'user' }, hint: 'h', retryAfterSec: 30 })
    expect(toShipApiError({ response: { status: 500, data: '<html>' } })).toMatchObject({ code: 'UNKNOWN' })
  })
})

describe('shipHelpers — deep link storage (FT-16)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('readShipParam validates the UUIDv7', () => {
    expect(readShipParam(`?ship=${V7}`)).toBe(V7)
    expect(readShipParam('?ship=nope')).toBeNull()
    expect(readShipParam('?ship=<script>')).toBeNull()
    expect(readShipParam('')).toBeNull()
  })

  it('stores only a valid id, and take clears it', () => {
    storePendingDeepLink('nope')
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull()
    storePendingDeepLink(V7)
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe(V7)
    expect(takePendingDeepLink()).toBe(V7)
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull()
    expect(takePendingDeepLink()).toBeNull()
  })

  it('discards a tampered sessionStorage value and clears it', () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '"><img src=x>')
    expect(takePendingDeepLink()).toBeNull()
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull()
  })

  it('setShipQueryParam sets/removes only ship and preserves other params', () => {
    window.history.replaceState({}, '', '/?a=1')
    setShipQueryParam(V7)
    expect(window.location.search).toBe(`?a=1&ship=${V7}`)
    setShipQueryParam(null)
    expect(window.location.search).toBe('?a=1')
  })
})
