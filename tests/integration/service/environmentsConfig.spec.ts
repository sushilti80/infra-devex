import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const catalogPath = path.resolve(process.cwd(), 'data/environments.json')
const secretBundlesPath = path.resolve(process.cwd(), 'data/secretBundles.json')
const cjsRequire = createRequire(import.meta.url)
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

describe('environment catalog', () => {
  it('assigns a unique environment ID and subscription to DataOps Sand', () => {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
    const ids = catalog.environments.map((environment: { id: string }) => environment.id)
    const dataOps = catalog.environments.find(
      (environment: { id: string }) => environment.id === 'dataopssand'
    )

    expect(new Set(ids).size).toBe(ids.length)
    expect(dataOps).toMatchObject({
      displayName: 'DataOps Sandbox (dataopssand)',
      subscriptionId: '24fadfb5-071d-447d-b7d6-49c25321c319',
      enabled: true,
      features: { customInfra: true, templates: true, aks: false }
    })
  })

  it('includes DataOps Sand in the sand secret bundle', () => {
    const bundles = JSON.parse(fs.readFileSync(secretBundlesPath, 'utf8'))
    const independent = bundles.bundles.find(
      (bundle: { id: string }) => bundle.id === 'sand'
    )

    expect(independent.environments).toContain('dataops-sand')
  })

  it('derives runtime subscription and AKS configuration from the catalog', () => {
    const config = cjsRequire('../../../config')
    const enabled = catalog.environments.filter((environment: { enabled: boolean }) => environment.enabled)
    const expectedSubscriptions = Object.fromEntries(
      enabled.map((environment: { id: string; subscriptionId: string }) => [
        environment.id,
        environment.subscriptionId
      ])
    )
    const expectedAksEnvironments = enabled
      .filter((environment: { features?: { aks?: boolean } }) => environment.features?.aks)
      .map((environment: { id: string }) => environment.id)

    expect(config.azure.subscriptions).toEqual(expectedSubscriptions)
    expect(config.aks.supportedEnvironments).toEqual(expectedAksEnvironments)
    expect(config.aks.defaultEnvironment).toBe(catalog.defaultEnvironment)
  })

  it('serves the same local catalog through the environment API service', async () => {
    const infrastructureService = cjsRequire('../../../services/infrastructureService')
    const result = await infrastructureService.getEnvironments()

    expect(result.defaultEnvironment).toBe(catalog.defaultEnvironment)
    expect(result.defaultSubscriptionId).toBe(catalog.defaultSubscriptionId)
    expect(result.environments).toEqual(catalog.environments.filter((environment: { enabled: boolean }) => environment.enabled))
  })
})
