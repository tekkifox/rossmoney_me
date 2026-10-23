import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts', './vitest.setup-db.ts'],
    include: ['tests/int/**/*.int.spec.ts'],
    // Every spec file initialises Payload, and onInit seeds pages with unique
    // slugs. Run files sequentially so two workers cannot seed the same
    // disposable database at the same time.
    fileParallelism: false,
    // Starting Payload (which seeds documents) can take longer than Vitest's
    // 10s default on a cold machine.
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
})
