import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
const IS_SAND_CLUSTER = !!process.env.SAND_CLUSTER_URL
const IS_CI = !!process.env.CI

export default defineConfig({
  testDir: './tests/e2e',

  // Test execution settings
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 2 : undefined,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list']
  ],

  // Global settings
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Timeouts
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  // Test timeout
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000
  },

  // Projects for different browsers
  projects: [
    // Setup project - runs first to handle authentication
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use authenticated state from setup
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
    // Mobile viewports
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'Mobile Safari',
      use: {
        ...devices['iPhone 12'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  // Local dev server for testing (not used in CI or sand cluster mode)
  // Note: requires 'npm run build:client' to have been run first (serves from dist/)
  webServer: (IS_CI || IS_SAND_CLUSTER) ? undefined : {
    command: 'npm start',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120000,
  },
})
