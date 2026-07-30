import { defineConfig } from 'vitest/config'
import path from 'path'
import { electronAliases } from './electron-aliases'

// Standalone config so tests don't load vite.config.ts (which runs the electron
// build plugin). The logic under test is pure and runs in a plain node env.
export default defineConfig({
  resolve: {
    alias: electronAliases(__dirname),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    typecheck: { tsconfig: './tsconfig.test.json' },
  },
})
