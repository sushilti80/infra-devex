import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

const sharedExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
  '**/e2e/**',
  '**/tests/e2e/**',
]

export default defineConfig({
  test: {
    globals: true,
    // Use projects to assign environments per test folder (replaces deprecated environmentMatchGlobs)
    projects: [
      // Server-side tests (smoke + integration) run in Node environment
      {
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['tests/setup-env.ts'],
          include: ['tests/smoke/**/*.spec.ts', 'tests/integration/**/*.spec.ts'],
          exclude: sharedExclude,
          globals: true,
        },
      },
      // Vue component/composable tests run in jsdom environment
      {
        plugins: [vue()],
        resolve: {
          alias: { '@v2': path.resolve(__dirname, './srcV2') },
        },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: ['tests/setup-env.ts'],
          include: ['srcV2/**/*.spec.ts'],
          exclude: sharedExclude,
          globals: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: ['srcV2/**/*.{ts,vue}'],
      exclude: [
        'node_modules/',
        'srcV2/main.ts',
        '**/*.d.ts',
        '**/*.config.*',
        '**/*.spec.ts',
        '**/mockData/**',
        'dist/',
        'coverage/',
      ],
      all: true,
      clean: true,
    },
  },
  resolve: {
    alias: {
      '@v2': path.resolve(__dirname, './srcV2'),
    },
  },
})
