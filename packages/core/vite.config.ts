import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SighashCore',
      fileName: (format) => (format === 'es' ? 'index.js' : `index.${format}.cjs`),
      formats: ['es', 'umd'],
    },
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ['nanostores'],
      output: {
        globals: {
          nanostores: 'nanostores',
        },
      },
    },
  },
  plugins: [
    dts({
      entryRoot: 'src',
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts'],
      rollupTypes: true,
    }),
  ],
});
