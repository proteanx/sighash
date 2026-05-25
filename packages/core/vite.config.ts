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
      external: ['@bitcoinerlab/secp256k1', 'bitcoinjs-lib', 'nanostores', 'sats-connect'],
      output: {
        globals: {
          '@bitcoinerlab/secp256k1': 'ecc',
          'bitcoinjs-lib': 'bitcoin',
          nanostores: 'nanostores',
          'sats-connect': 'SatsConnect',
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
