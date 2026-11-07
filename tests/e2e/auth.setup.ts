/**
 * E2E Authentication Setup for Microsoft Entra ID
 * 
 * This file handles authentication once and stores the session state.
 * All E2E tests will reuse this authenticated state, avoiding repeated logins.
 * 
 * Setup:
 * 1. Create a test user in Entra ID (Azure Portal)
 * 2. Add credentials to .env file:
 *    - E2E_TEST_USERNAME=testuser@yourdomain.com
 *    - E2E_TEST_PASSWORD=YourSecurePassword123!
 * 3. Run: npx playwright test --project=setup
 */

import { test as setup, expect } from '@playwright/test'
import path from 'path'

// Path where authenticated state will be saved
const authFile = path.join(__dirname, '../../.auth/user.json')

// Test user credentials from environment
const TEST_USERNAME = process.env.E2E_TEST_USERNAME
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'

setup('authenticate with Entra ID', async ({ page }) => {
  // Skip authentication if credentials not provided (for local testing without auth)
  if (!TEST_USERNAME || !TEST_PASSWORD) {
    console.log('[E2E Auth Setup] ⚠️  E2E_TEST_USERNAME and E2E_TEST_PASSWORD not set')
    console.log('[E2E Auth Setup] Skipping authentication - tests will run without login')
    console.log('[E2E Auth Setup] To enable: Add credentials to .env file')
    
    // Navigate to app to save basic state
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    
    // Save state even without auth (for apps that don't require login)
    await page.context().storageState({ path: authFile })
    console.log('[E2E Auth Setup] Basic state saved (no authentication)')
    return
  }

  console.log(`[E2E Auth Setup] Starting authentication for ${TEST_USERNAME}`)

  // Navigate to application
  await page.goto(BASE_URL)
  
  // Wait for app to load
  await page.waitForLoadState('networkidle')
  
  // Click login button (adjust selector to match your app)
  const loginButton = page.locator('button:has-text("Login"), button:has-text("Sign In"), [data-testid="login-button"]').first()
  
  if (await loginButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[E2E Auth Setup] Found login button, clicking...')
    await loginButton.click()
    
    // Wait for redirect to Microsoft login page
    await page.waitForURL('**/login.microsoftonline.com/**', { timeout: 10000 })
    console.log('[E2E Auth Setup] Redirected to Microsoft login')
    
    // Fill in username
    const emailInput = page.locator('input[type="email"], input[name="loginfmt"]')
    await emailInput.waitFor({ state: 'visible', timeout: 10000 })
    await emailInput.fill(TEST_USERNAME)
    console.log('[E2E Auth Setup] Entered username')
    
    // Click Next/Submit
    await page.locator('input[type="submit"], button[type="submit"]').click()
    
    // Fill in password (may be on same or different page)
    const passwordInput = page.locator('input[type="password"], input[name="passwd"]')
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 })
    await passwordInput.fill(TEST_PASSWORD)
    console.log('[E2E Auth Setup] Entered password')
    
    // Click Sign In
    await page.locator('input[type="submit"]:has-text("Sign in"), button[type="submit"]:has-text("Sign in")').click()
    
    // Handle "Stay signed in?" prompt (if it appears)
    const staySignedInButton = page.locator('input[type="submit"]:has-text("Yes"), button:has-text("Yes")')
    if (await staySignedInButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[E2E Auth Setup] Handling "Stay signed in?" prompt')
      await staySignedInButton.click()
    }
    
    // Wait for redirect back to application
    await page.waitForURL(BASE_URL + '**', { timeout: 30000 })
    console.log('[E2E Auth Setup] Redirected back to application')
    
    // Wait for authentication to complete
    await page.waitForLoadState('networkidle')
    
    // Verify user is logged in (adjust selector to match your app)
    const userIndicator = page.locator(
      '[data-testid="user-menu"], .user-profile, button:has-text("Logout"), button:has-text("Sign Out")'
    ).first()
    
    await expect(userIndicator).toBeVisible({ timeout: 10000 })
    console.log('[E2E Auth Setup] Authentication successful - user indicator visible')
    
  } else {
    console.log('[E2E Auth Setup] No login button found - assuming already authenticated or auth disabled')
  }
  
  // Save authenticated state to file
  await page.context().storageState({ path: authFile })
  console.log(`[E2E Auth Setup] Authentication state saved to ${authFile}`)
})

/**
 * Optional: Verify application loads
 */
setup('verify application loads', async ({ page }) => {
  await page.goto(BASE_URL)
  
  // Check if page loads successfully
  const title = await page.title()
  console.log('[E2E Auth Verify] Application loaded, title:', title)
  
  // Basic health check
  expect(title).toBeTruthy()
  expect(title.length).toBeGreaterThan(0)
})
