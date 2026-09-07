import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Unit tests for the PURE helpers only.
 *
 * This app had no test runner at all — jan-portal carries 127 test files
 * against this repo's nothing — so the point of this config is to make the
 * cheap half possible, not to pretend the whole app is covered. What belongs
 * here is a function whose inputs and outputs are values: a classifier, a
 * parser, a formatter. Anything that needs a DOM, a database or FINAPI does
 * not, and is still verified the way the rest of this repo is — `npm run
 * build`, `scripts/mobile-sweep.mjs`, and a real request against the box.
 *
 * `environment: 'node'` on purpose: no test here touches the DOM, and jsdom
 * would be a second dependency earning nothing.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'hooks/**/*.test.ts', 'components/**/*.test.ts'],
    // jan-ui is a vendored copy synced from ~/WebstormProjects/jan-ui; its
    // tests (if any) belong to that source, not to this consumer.
    exclude: ['node_modules/**', 'lib/jan-ui/**', '.next/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
})
