import { defineConfig } from 'vitest/config';

// `base: './'` makes the built site work from any sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    // Let tests read style.css (as ?raw) to check it only uses theme variables.
    css: { include: [/style\.css/] },
  },
});
