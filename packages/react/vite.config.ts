import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const pkg: { version: string } = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
);

export default defineConfig({
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SighashReact',
      fileName: (format) => (format === 'es' ? 'index.js' : `index.${format}.cjs`),
      formats: ['es', 'umd'],
    },
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'nanostores', '@sighash-dev/core'],
      output: {
        globals: {
          react: 'React',
          'react/jsx-runtime': 'jsxRuntime',
          nanostores: 'nanostores',
          '@sighash-dev/core': 'SighashCore',
        },
      },
    },
  },
  plugins: [
    react(),
    dts({
      entryRoot: 'src',
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      rollupTypes: true,
    }),
  ],
});
