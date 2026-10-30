import { defineConfig } from 'vitest/config';

// `base: './'` makes the built site work from any sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
