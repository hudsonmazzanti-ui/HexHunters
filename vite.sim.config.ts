/**
 * Builds the balance simulator (sim/) into dist-sim/ as plain Node modules, so it runs
 * with `node` and no extra tools. Used by `npm run sim`; doesn't touch the app build.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  logLevel: 'warn',
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist-sim',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { cli: 'sim/cli.ts', worker: 'sim/worker.ts' },
      output: { format: 'es', entryFileNames: '[name].js' },
    },
  },
});
