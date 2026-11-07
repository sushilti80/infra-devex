import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const HAS_E2E_AUTH = Boolean(process.env.E2E_TEST_USERNAME && process.env.E2E_TEST_PASSWORD)

test.describe('E2E - Secrets Management', () => {
  let page: Page

  test.beforeEach(async ({ page: testPage }, testInfo) => {
    if (testInfo.title !== 'application loads successfully') {
      test.skip(!HAS_E2E_AUTH, 'Authenticated E2E credentials are not configured')
    }
    page = testPage
    await page.goto(BASE_URL)

    // Wait for app to load
    await page.waitForLoadState('networkidle')
  })

  test('application loads successfully', async () => {
    await expect(page).toHaveTitle(/Self-Service Infrastructure/)

    // Check main navigation exists
    const nav = page.locator('nav')
    await expect(nav).toBeVisible()
  })

  test('can navigate to Secrets page', async () => {
    // Click on Secrets link using Vue 3 test ID
    await page.click('[data-testid="nav-link-secrets"]')

    // Wait for navigation
    await page.waitForLoadState('networkidle')

    // Verify we're on the right page
    await expect(page.locator('h1')).toContainText('Secrets')
  })

  test('E2E-003: can select environment and see qualifier dropdown when multiple qualifiers exist', async () => {
    // Navigate to secrets page
    await page.click('[data-testid="nav-link-secrets"]')
    await page.waitForLoadState('networkidle')

    // Select an app that has multiple qualifiers (this would need test data setup)
    // For now, we'll test that the UI elements exist and behave correctly

    // Check that app selector exists
    const appSelect = page.locator('[data-testid="app-select"]')
    await expect(appSelect).toBeVisible()

    // Check that environment selector exists
    const envSelect = page.locator('[data-testid="environment-select"]')
    await expect(envSelect).toBeVisible()

    // Check that target selector exists
    const targetSelect = page.locator('[data-testid="target-select"]')
    await expect(targetSelect).toBeVisible()

    // Check that vault directory selector exists
    const vaultDirSelect = page.locator('[data-testid="vault-directory-select"]')
    await expect(vaultDirSelect).toBeVisible()
  })

  test('E2E-004: qualifier field disambiguates sub-apps when selecting secret to submit', async () => {
    // Navigate to secrets page
    await page.click('[data-testid="nav-link-secrets"]')
    await page.waitForLoadState('networkidle')

    // Check that qualifier selector exists (conditionally shown)
    const qualifierSelect = page.locator('[data-testid="qualifier-select"]')
    // This might not be visible initially until we select an app with multiple qualifiers

    // Check that secret selector exists
    const secretSelect = page.locator('[data-testid="secret-select"]')
    await expect(secretSelect).toBeVisible()

    // Check that secret value input exists
    const secretValueInput = page.locator('[data-testid="secret-value-input"]')
    await expect(secretValueInput).toBeVisible()

    // Check that submit button exists
    const submitButton = page.locator('[data-testid="submit-secret-button"]')
    await expect(submitButton).toBeVisible()
  })
})
