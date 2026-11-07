import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest'
import { useBundleSubmission } from './useBundleSubmission'
import api from '@v2/services/api'

vi.mock('@v2/services/api', () => ({
  default: {
    getSecrets: vi.fn(),
    submitSecret: vi.fn()
  }
}))

describe('useBundleSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('starts with no eligibility, one blank secret row, and no in-flight resolution', () => {
      const bundle = useBundleSubmission()
      expect(bundle.eligibility.value).toEqual({})
      expect(bundle.exclusionReason.value).toEqual({})
      expect(bundle.excludedCandidates.value).toEqual({})
      expect(bundle.perEnvironmentDisambiguation.value).toEqual({})
      expect(bundle.secretNames.value).toEqual([''])
      expect(bundle.gridValues.value).toEqual({})
      expect(bundle.isResolving.value).toBe(false)
      expect(bundle.eligibleEnvironments.value).toEqual([])
    })
  })

  describe('resolveEnvironmentEligibility (FR-004, spec.md §2.2 classification table)', () => {
    it('classifies a single vault + <=1 qualifier response as eligible', async () => {
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults: [{ vaultDir: 'a' }], qualifiers: [] })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.eligibility.value.dev).toBe('eligible')
      expect(bundle.exclusionReason.value.dev).toBeUndefined()
    })

    it('classifies a multiple-qualifiers response as excluded with a qualifier-specific reason', async () => {
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults: [{ vaultDir: 'a', qualifier: 'x' }, { vaultDir: 'b', qualifier: 'y' }], qualifiers: ['x', 'y'] })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.eligibility.value.dev).toBe('excluded')
      expect(bundle.exclusionReason.value.dev).toMatch(/sub-application|qualifier/i)
    })

    it('classifies a multiple-vaults response as excluded with a vault-specific reason', async () => {
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults: [{ vaultDir: 'a' }, { vaultDir: 'b' }], qualifiers: [] })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.eligibility.value.dev).toBe('excluded')
      expect(bundle.exclusionReason.value.dev).toMatch(/vault/i)
    })

    it('classifies a 200 response as eligible when the caller already supplied a disambiguating vaultDir, even though the raw response still lists sibling qualifiers/vaults', async () => {
      ;(api.getSecrets as Mock).mockResolvedValue({
        success: true,
        vaults: [{ vaultDir: 'infrastructure/idm/dev/keyvault' }, { vaultDir: 'infrastructure/idm/_idmapplications/autobk/dev/keyvault', qualifier: 'autobk' }],
        qualifiers: ['autobk', 'notif']
      })
      const bundle = useBundleSubmission()
      bundle.perEnvironmentDisambiguation.value.dev = { vaultDir: 'infrastructure/idm/dev/keyvault' }

      await bundle.resolveEnvironmentEligibility('idm', 'dev', 'live')

      expect(bundle.eligibility.value.dev).toBe('eligible')
      expect(bundle.exclusionReason.value.dev).toBeUndefined()
    })

    it('classifies a thrown 422 with a single resolvable vault as eligible (mirrors legacy resolveEnvironmentEligibility)', async () => {
      ;(api.getSecrets as Mock).mockRejectedValue({ response: { data: { vaults: [{ vaultDir: 'a' }] } } })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.eligibility.value.dev).toBe('eligible')
    })

    it('keeps a single-vault 422 excluded when multiple sub-app qualifiers require selection', async () => {
      const responseData = {
        error: 'Multiple sub-app qualifiers found; qualifier is required',
        qualifiers: ['api', 'worker'],
        vaults: [{ vaultDir: 'a', qualifier: 'api' }, { vaultDir: 'b', qualifier: 'worker' }]
      }
      ;(api.getSecrets as Mock).mockRejectedValue({ response: { data: responseData } })
      const bundle = useBundleSubmission()

      await bundle.resolveEnvironmentEligibility('idm', 'dev', 'live')

      expect(bundle.eligibility.value.dev).toBe('excluded')
      expect(bundle.exclusionReason.value.dev).toMatch(/qualifier/i)
      expect(bundle.excludedCandidates.value.dev).toEqual({
        vaults: responseData.vaults,
        qualifiers: responseData.qualifiers
      })
    })

    it('classifies a thrown error with zero/multiple vaults as excluded, surfacing the server message', async () => {
      ;(api.getSecrets as Mock).mockRejectedValue({ response: { data: { vaults: [], message: 'No Key Vault could be resolved.' } } })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.eligibility.value.dev).toBe('excluded')
      expect(bundle.exclusionReason.value.dev).toBe('No Key Vault could be resolved.')
    })

    it('records the raw vault candidates for a vault-ambiguous environment, for a disambiguation control', async () => {
      const vaults = [{ vaultDir: 'a' }, { vaultDir: 'b' }]
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults, qualifiers: [] })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.excludedCandidates.value.dev).toEqual({ vaults, qualifiers: [] })
    })

    it('records the raw qualifier candidates for a qualifier-ambiguous environment', async () => {
      const vaults = [{ vaultDir: 'a', qualifier: 'x' }, { vaultDir: 'b', qualifier: 'y' }]
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults, qualifiers: ['x', 'y'] })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.excludedCandidates.value.dev).toEqual({ vaults, qualifiers: ['x', 'y'] })
    })

    it('clears excludedCandidates once an environment becomes eligible', async () => {
      ;(api.getSecrets as Mock).mockResolvedValueOnce({ success: true, vaults: [{ vaultDir: 'a' }, { vaultDir: 'b' }], qualifiers: [] })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.excludedCandidates.value.dev).toBeDefined()

      ;(api.getSecrets as Mock).mockResolvedValueOnce({ success: true, vaults: [{ vaultDir: 'a' }], qualifiers: [] })
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.excludedCandidates.value.dev).toBeUndefined()
    })

    it('forwards the per-environment vaultDir/qualifier disambiguation to the API call', async () => {
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults: [{ vaultDir: 'a' }], qualifiers: [] })
      const bundle = useBundleSubmission()
      bundle.perEnvironmentDisambiguation.value.dev = { vaultDir: 'infra/dev/keyvault02', qualifier: 'svcA' }
      await bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(api.getSecrets).toHaveBeenCalledWith('myapp', 'dev', 'live', 'infra/dev/keyvault02', 'svcA')
    })

    it('sets status to pending synchronously before the API call resolves', () => {
      let resolveFn: (v: unknown) => void = () => {}
      ;(api.getSecrets as Mock).mockReturnValue(new Promise(resolve => { resolveFn = resolve }))
      const bundle = useBundleSubmission()
      const promise = bundle.resolveEnvironmentEligibility('myapp', 'dev', 'live')
      expect(bundle.eligibility.value.dev).toBe('pending')
      resolveFn({ success: true, vaults: [{ vaultDir: 'a' }], qualifiers: [] })
      return promise
    })

    it('auto-resolves to the parent app\'s own unqualified vault when exactly one exists among qualifier-ambiguous candidates (real idm/int shape: root + idmprtl + notif)', async () => {
      const rootVault = { vaultDir: 'infrastructure/idm/int/keyvault', vaultName: 'idm-int-uks-kv-1' }
      const idmprtlVault = { vaultDir: 'infrastructure/idm/_idmapplications/idmprtl/int/keyvault', vaultName: 'idmprtl-int-uks-kv-1', qualifier: 'idmprtl' }
      const notifVault = { vaultDir: 'infrastructure/idm/_idmapplications/notif/int/keyvault', vaultName: 'notif-int-uks-kv-1', qualifier: 'notif' }
      ;(api.getSecrets as Mock).mockImplementation((_app: string, _env: string, _target: string, vaultDir?: string) =>
        vaultDir
          ? Promise.resolve({ success: true, vaults: [rootVault, idmprtlVault, notifVault], qualifiers: ['idmprtl', 'notif'] })
          : Promise.reject({ response: { data: { error: 'Multiple sub-app qualifiers found; qualifier is required', qualifiers: ['idmprtl', 'notif'], vaults: [idmprtlVault, notifVault, rootVault] } } })
      )
      const bundle = useBundleSubmission()

      await bundle.resolveEnvironmentEligibility('idm', 'int', 'live')

      expect(bundle.eligibility.value.int).toBe('eligible')
      expect(bundle.exclusionReason.value.int).toBeUndefined()
      expect(bundle.perEnvironmentDisambiguation.value.int).toEqual({ vaultDir: rootVault.vaultDir })
      expect(api.getSecrets).toHaveBeenLastCalledWith('idm', 'int', 'live', rootVault.vaultDir, undefined)
    })

    it('does not auto-resolve when no unqualified root vault exists (genuinely ambiguous, stays excluded)', async () => {
      ;(api.getSecrets as Mock).mockRejectedValue({
        response: { data: { error: 'Multiple sub-app qualifiers found; qualifier is required', qualifiers: ['a', 'b'], vaults: [{ vaultDir: 'x', qualifier: 'a' }, { vaultDir: 'y', qualifier: 'b' }] } }
      })
      const bundle = useBundleSubmission()

      await bundle.resolveEnvironmentEligibility('idm', 'dev', 'live')

      expect(bundle.eligibility.value.dev).toBe('excluded')
      expect(bundle.perEnvironmentDisambiguation.value.dev).toBeUndefined()
    })

    it('does not auto-resolve when the caller already supplied a qualifier explicitly', async () => {
      ;(api.getSecrets as Mock).mockRejectedValue({
        response: { data: { error: 'Multiple sub-app qualifiers found; qualifier is required', qualifiers: ['idmprtl', 'notif'], vaults: [{ vaultDir: 'root' }, { vaultDir: 'a', qualifier: 'idmprtl' }] } }
      })
      const bundle = useBundleSubmission()
      bundle.perEnvironmentDisambiguation.value.dev = { qualifier: 'notif' }

      await bundle.resolveEnvironmentEligibility('idm', 'dev', 'live')

      expect(bundle.eligibility.value.dev).toBe('excluded')
      expect(api.getSecrets).toHaveBeenCalledTimes(1)
    })
  })


  describe('resolveEnvironments (batch, FR-004)', () => {
    it('resolves every requested environment in parallel and prunes ones no longer present', async () => {
      ;(api.getSecrets as Mock).mockImplementation((_app: string, env: string) =>
        Promise.resolve({ success: true, vaults: [{ vaultDir: env }], qualifiers: [] })
      )
      const bundle = useBundleSubmission()
      bundle.eligibility.value.stale = 'eligible'
      await bundle.resolveEnvironments('myapp', ['dev', 'staging'], 'live')
      expect(bundle.eligibility.value.dev).toBe('eligible')
      expect(bundle.eligibility.value.staging).toBe('eligible')
      expect(bundle.eligibility.value.stale).toBeUndefined()
      expect(api.getSecrets).toHaveBeenCalledTimes(2)
    })

    it('ignores results from a previous bundle after a newer bundle is selected', async () => {
      const oldBundleResolvers = new Map<string, (value: unknown) => void>()
      ;(api.getSecrets as Mock).mockImplementation((_app: string, env: string) => {
        if (env === 'sand' || env === 'devsand') {
          return new Promise(resolve => oldBundleResolvers.set(env, resolve))
        }
        return Promise.resolve({ success: true, vaults: [{ vaultDir: env }], qualifiers: [] })
      })
      const bundle = useBundleSubmission()

      const oldBundleResolution = bundle.resolveEnvironments('myapp', ['sand', 'devsand'], 'live')
      const newBundleResolution = bundle.resolveEnvironments('myapp', ['dev', 'int'], 'live')
      await newBundleResolution

      oldBundleResolvers.forEach(resolve => resolve({ success: true, vaults: [{ vaultDir: 'old' }], qualifiers: [] }))
      await oldBundleResolution

      expect(bundle.eligibleEnvironments.value).toEqual(['dev', 'int'])
    })

    it('toggles isResolving for the duration of the batch and resets it afterwards, even on failure', async () => {
      ;(api.getSecrets as Mock).mockRejectedValue({ response: { data: { vaults: [] } } })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironments('myapp', ['dev'], 'live')
      expect(bundle.isResolving.value).toBe(false)
    })

    it('applies an app-selector qualifier to every bundle environment', async () => {
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults: [{ vaultDir: 'a' }], qualifiers: ['api'] })
      const bundle = useBundleSubmission()

      await bundle.resolveEnvironments('idm', ['dev', 'staging'], 'live', { qualifier: 'api' })

      expect(api.getSecrets).toHaveBeenCalledWith('idm', 'dev', 'live', undefined, 'api')
      expect(api.getSecrets).toHaveBeenCalledWith('idm', 'staging', 'live', undefined, 'api')
      expect(bundle.perEnvironmentDisambiguation.value).toEqual({
        dev: { qualifier: 'api' },
        staging: { qualifier: 'api' }
      })
    })
  })

  describe('setDisambiguation (FR-004(g): per-environment, not shared)', () => {
    it('re-resolves only the target environment, leaving other environments and their call counts untouched', async () => {
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults: [{ vaultDir: 'a' }], qualifiers: [] })
      const bundle = useBundleSubmission()
      await bundle.resolveEnvironments('myapp', ['dev', 'staging'], 'live')
      vi.clearAllMocks()
      ;(api.getSecrets as Mock).mockResolvedValue({ success: true, vaults: [{ vaultDir: 'b' }], qualifiers: [] })

      await bundle.setDisambiguation('myapp', 'dev', 'live', { vaultDir: 'infra/dev/keyvault02' })

      expect(api.getSecrets).toHaveBeenCalledTimes(1)
      expect(api.getSecrets).toHaveBeenCalledWith('myapp', 'dev', 'live', 'infra/dev/keyvault02', undefined)
      expect(bundle.perEnvironmentDisambiguation.value.dev).toEqual({ vaultDir: 'infra/dev/keyvault02' })
      expect(bundle.perEnvironmentDisambiguation.value.staging).toBeUndefined()
    })
  })

  describe('secret row management', () => {
    it('adds a blank row, up to no fixed cap enforced here (page/grid owns MAX_SECRET_ROWS)', () => {
      const bundle = useBundleSubmission()
      bundle.addSecretRow()
      expect(bundle.secretNames.value).toEqual(['', ''])
    })

    it('removes a row by index and deletes its grid values, but never drops below one row', () => {
      const bundle = useBundleSubmission()
      bundle.secretNames.value = ['DATABASE_URL', 'API_KEY']
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'abc')
      bundle.removeSecretRow(0)
      expect(bundle.secretNames.value).toEqual(['API_KEY'])
      expect(bundle.gridValues.value.DATABASE_URL).toBeUndefined()

      bundle.removeSecretRow(0)
      expect(bundle.secretNames.value).toEqual(['API_KEY'])
    })

    it('renames a row and migrates any already-entered grid values to the new name', () => {
      const bundle = useBundleSubmission()
      bundle.secretNames.value = ['']
      bundle.setCellValue('', 'dev', 'value', 'abc')
      bundle.renameSecretRow(0, 'DATABASE_URL')
      expect(bundle.secretNames.value).toEqual(['DATABASE_URL'])
      expect(bundle.gridValues.value.DATABASE_URL.dev.value).toBe('abc')
      expect(bundle.gridValues.value['']).toBeUndefined()
    })
  })

  describe('setCellValue / isCellValid (FR-006(c): independent per-cell validation)', () => {
    it('creates nested grid structure on first write', () => {
      const bundle = useBundleSubmission()
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'abc')
      bundle.setCellValue('DATABASE_URL', 'dev', 'confirmation', 'abc')
      expect(bundle.gridValues.value.DATABASE_URL.dev).toEqual({ value: 'abc', confirmation: 'abc' })
    })

    it('treats an empty/untouched cell as valid (not yet filled in)', () => {
      const bundle = useBundleSubmission()
      expect(bundle.isCellValid('DATABASE_URL', 'dev')).toBe(true)
    })

    it('is valid when value and confirmation match', () => {
      const bundle = useBundleSubmission()
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'abc')
      bundle.setCellValue('DATABASE_URL', 'dev', 'confirmation', 'abc')
      expect(bundle.isCellValid('DATABASE_URL', 'dev')).toBe(true)
    })

    it('is invalid when value and confirmation mismatch', () => {
      const bundle = useBundleSubmission()
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'abc')
      bundle.setCellValue('DATABASE_URL', 'dev', 'confirmation', 'xyz')
      expect(bundle.isCellValid('DATABASE_URL', 'dev')).toBe(false)
    })

    it('is invalid when only the value has been typed and confirmation is still blank', () => {
      const bundle = useBundleSubmission()
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'abc')
      expect(bundle.isCellValid('DATABASE_URL', 'dev')).toBe(false)
    })

    it('validates each environment cell for the same secret name independently', () => {
      const bundle = useBundleSubmission()
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'abc')
      bundle.setCellValue('DATABASE_URL', 'dev', 'confirmation', 'abc')
      bundle.setCellValue('DATABASE_URL', 'staging', 'value', 'zzz')
      bundle.setCellValue('DATABASE_URL', 'staging', 'confirmation', 'different')
      expect(bundle.isCellValid('DATABASE_URL', 'dev')).toBe(true)
      expect(bundle.isCellValid('DATABASE_URL', 'staging')).toBe(false)
    })
  })

  describe('eligibleEnvironments', () => {
    it('only includes environments classified eligible', () => {
      const bundle = useBundleSubmission()
      bundle.eligibility.value = { dev: 'eligible', staging: 'excluded', prod: 'pending' }
      expect(bundle.eligibleEnvironments.value).toEqual(['dev'])
    })
  })

  describe('buildSubmissionPayload (FR-005, FR-006(d): never copies a value across environments)', () => {
    it('assembles environmentSecrets only from eligible environments and populated cells', () => {
      const bundle = useBundleSubmission()
      bundle.eligibility.value = { dev: 'eligible', staging: 'eligible', prod: 'excluded' }
      bundle.secretNames.value = ['DATABASE_URL', '  ', 'API_KEY']
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'dev-value')
      bundle.setCellValue('DATABASE_URL', 'staging', 'value', 'staging-value')
      bundle.setCellValue('API_KEY', 'dev', 'value', 'dev-key')
      // prod is excluded and must never appear even though a stray value might exist for it
      bundle.setCellValue('DATABASE_URL', 'prod', 'value', 'should-not-be-included')

      const payload = bundle.buildSubmissionPayload({
        target: 'live',
        appName: 'myapp',
        bundleId: 'release',
        jiraTicket: 'JIRA-1'
      })

      expect(payload).toEqual({
        target: 'live',
        appName: 'myapp',
        bundleId: 'release',
        jiraTicket: 'JIRA-1',
        environmentSecrets: [
          { environment: 'dev', secrets: [{ secretName: 'DATABASE_URL', secretValue: 'dev-value' }, { secretName: 'API_KEY', secretValue: 'dev-key' }] },
          { environment: 'staging', secrets: [{ secretName: 'DATABASE_URL', secretValue: 'staging-value' }] }
        ]
      })
    })

    it('confirms distinct values for the same secret name are never copied across environments', () => {
      const bundle = useBundleSubmission()
      bundle.eligibility.value = { dev: 'eligible', staging: 'eligible' }
      bundle.secretNames.value = ['DATABASE_URL']
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'dev-only-value')
      // staging deliberately left blank

      const payload = bundle.buildSubmissionPayload({ target: 'live', appName: 'myapp', bundleId: 'developer', jiraTicket: 'JIRA-2' })

      const stagingEntry = payload.environmentSecrets.find(e => e.environment === 'staging')
      expect(stagingEntry?.secrets).toEqual([])
      const devEntry = payload.environmentSecrets.find(e => e.environment === 'dev')
      expect(devEntry?.secrets).toEqual([{ secretName: 'DATABASE_URL', secretValue: 'dev-only-value' }])
    })

    it('includes vaultDir/qualifier only when disambiguation was actually supplied for that environment', () => {
      const bundle = useBundleSubmission()
      bundle.eligibility.value = { dev: 'eligible' }
      bundle.perEnvironmentDisambiguation.value.dev = { vaultDir: 'infra/dev/keyvault02' }
      bundle.secretNames.value = ['DATABASE_URL']
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'v')

      const payload = bundle.buildSubmissionPayload({ target: 'live', appName: 'myapp', bundleId: 'developer', jiraTicket: 'JIRA-3' })
      expect(payload.environmentSecrets[0]).toEqual({
        environment: 'dev',
        vaultDir: 'infra/dev/keyvault02',
        secrets: [{ secretName: 'DATABASE_URL', secretValue: 'v' }]
      })
    })

    it('includes qualifier only (no vaultDir) when only a qualifier was supplied for that environment', () => {
      const bundle = useBundleSubmission()
      bundle.eligibility.value = { dev: 'eligible' }
      bundle.perEnvironmentDisambiguation.value.dev = { qualifier: 'svcA' }
      bundle.secretNames.value = ['DATABASE_URL']
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'v')

      const payload = bundle.buildSubmissionPayload({ target: 'live', appName: 'myapp', bundleId: 'developer', jiraTicket: 'JIRA-4' })
      expect(payload.environmentSecrets[0]).toEqual({
        environment: 'dev',
        qualifier: 'svcA',
        secrets: [{ secretName: 'DATABASE_URL', secretValue: 'v' }]
      })
    })
  })

  describe('submit', () => {
    it('delegates to api.submitSecret with the given payload and returns its response', async () => {
      const response = { success: true, correlationId: 'cid-1', bundleId: 'release', includedEnvironments: ['dev'], excludedEnvironments: [], secretCount: 1 }
      ;(api.submitSecret as Mock).mockResolvedValue(response)
      const bundle = useBundleSubmission()
      const payload = bundle.buildSubmissionPayload({ target: 'live', appName: 'myapp', bundleId: 'release', jiraTicket: 'JIRA-1' })
      const result = await bundle.submit(payload)
      expect(api.submitSecret).toHaveBeenCalledWith(payload)
      expect(result).toBe(response)
    })
  })

  describe('reset', () => {
    it('clears all bundle state back to its initial shape', () => {
      const bundle = useBundleSubmission()
      bundle.eligibility.value = { dev: 'eligible' }
      bundle.exclusionReason.value = { staging: 'ambiguous' }
      bundle.excludedCandidates.value = { staging: { vaults: [{ vaultDir: 'a' }, { vaultDir: 'b' }] } }
      bundle.perEnvironmentDisambiguation.value = { dev: { vaultDir: 'x' } }
      bundle.secretNames.value = ['DATABASE_URL', 'API_KEY']
      bundle.setCellValue('DATABASE_URL', 'dev', 'value', 'abc')
      bundle.isResolving.value = true

      bundle.reset()

      expect(bundle.eligibility.value).toEqual({})
      expect(bundle.exclusionReason.value).toEqual({})
      expect(bundle.excludedCandidates.value).toEqual({})
      expect(bundle.perEnvironmentDisambiguation.value).toEqual({})
      expect(bundle.secretNames.value).toEqual([''])
      expect(bundle.gridValues.value).toEqual({})
      expect(bundle.isResolving.value).toBe(false)
    })
  })
})
