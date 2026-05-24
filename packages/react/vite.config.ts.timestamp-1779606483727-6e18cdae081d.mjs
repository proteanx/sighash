// vite.config.ts
import { resolve } from "node:path";
import react from "file:///home/pro/Git/sighash-dev/sighash/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@22.19.19_/node_modules/@vitejs/plugin-react/dist/index.js";
import { defineConfig } from "file:///home/pro/Git/sighash-dev/sighash/node_modules/.pnpm/vite@5.4.21_@types+node@22.19.19/node_modules/vite/dist/node/index.js";
import dts from "file:///home/pro/Git/sighash-dev/sighash/node_modules/.pnpm/vite-plugin-dts@4.5.4_@types+node@22.19.19_rollup@4.60.4_typescript@5.8.3_vite@5.4.21_@types+node@22.19.19_/node_modules/vite-plugin-dts/dist/index.mjs";
var __vite_injected_original_dirname = "/home/pro/Git/sighash-dev/sighash/packages/react";
var vite_config_default = defineConfig({
  build: {
    lib: {
      entry: resolve(__vite_injected_original_dirname, "src/index.ts"),
      name: "SighashReact",
      fileName: (format) => format === "es" ? "index.js" : `index.${format}.cjs`,
      formats: ["es", "umd"]
    },
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "nanostores", "@sighash/core"],
      output: {
        globals: {
          react: "React",
          "react/jsx-runtime": "jsxRuntime",
          nanostores: "nanostores",
          "@sighash/core": "SighashCore"
        }
      }
    }
  },
  plugins: [
    react(),
    dts({
      entryRoot: "src",
      include: ["src/**/*"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      rollupTypes: true
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm8vR2l0L3NpZ2hhc2gtZGV2L3NpZ2hhc2gvcGFja2FnZXMvcmVhY3RcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL3Byby9HaXQvc2lnaGFzaC1kZXYvc2lnaGFzaC9wYWNrYWdlcy9yZWFjdC92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9wcm8vR2l0L3NpZ2hhc2gtZGV2L3NpZ2hhc2gvcGFja2FnZXMvcmVhY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCBkdHMgZnJvbSAndml0ZS1wbHVnaW4tZHRzJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYnVpbGQ6IHtcbiAgICBsaWI6IHtcbiAgICAgIGVudHJ5OiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9pbmRleC50cycpLFxuICAgICAgbmFtZTogJ1NpZ2hhc2hSZWFjdCcsXG4gICAgICBmaWxlTmFtZTogKGZvcm1hdCkgPT4gKGZvcm1hdCA9PT0gJ2VzJyA/ICdpbmRleC5qcycgOiBgaW5kZXguJHtmb3JtYXR9LmNqc2ApLFxuICAgICAgZm9ybWF0czogWydlcycsICd1bWQnXSxcbiAgICB9LFxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICBtaW5pZnk6IGZhbHNlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIGV4dGVybmFsOiBbJ3JlYWN0JywgJ3JlYWN0L2pzeC1ydW50aW1lJywgJ25hbm9zdG9yZXMnLCAnQHNpZ2hhc2gvY29yZSddLFxuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIGdsb2JhbHM6IHtcbiAgICAgICAgICByZWFjdDogJ1JlYWN0JyxcbiAgICAgICAgICAncmVhY3QvanN4LXJ1bnRpbWUnOiAnanN4UnVudGltZScsXG4gICAgICAgICAgbmFub3N0b3JlczogJ25hbm9zdG9yZXMnLFxuICAgICAgICAgICdAc2lnaGFzaC9jb3JlJzogJ1NpZ2hhc2hDb3JlJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgZHRzKHtcbiAgICAgIGVudHJ5Um9vdDogJ3NyYycsXG4gICAgICBpbmNsdWRlOiBbJ3NyYy8qKi8qJ10sXG4gICAgICBleGNsdWRlOiBbJ3NyYy8qKi8qLnRlc3QudHMnLCAnc3JjLyoqLyoudGVzdC50c3gnXSxcbiAgICAgIHJvbGx1cFR5cGVzOiB0cnVlLFxuICAgIH0pLFxuICBdLFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWtVLFNBQVMsZUFBZTtBQUMxVixPQUFPLFdBQVc7QUFDbEIsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxTQUFTO0FBSGhCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLE9BQU87QUFBQSxJQUNMLEtBQUs7QUFBQSxNQUNILE9BQU8sUUFBUSxrQ0FBVyxjQUFjO0FBQUEsTUFDeEMsTUFBTTtBQUFBLE1BQ04sVUFBVSxDQUFDLFdBQVksV0FBVyxPQUFPLGFBQWEsU0FBUyxNQUFNO0FBQUEsTUFDckUsU0FBUyxDQUFDLE1BQU0sS0FBSztBQUFBLElBQ3ZCO0FBQUEsSUFDQSxXQUFXO0FBQUEsSUFDWCxRQUFRO0FBQUEsSUFDUixlQUFlO0FBQUEsTUFDYixVQUFVLENBQUMsU0FBUyxxQkFBcUIsY0FBYyxlQUFlO0FBQUEsTUFDdEUsUUFBUTtBQUFBLFFBQ04sU0FBUztBQUFBLFVBQ1AsT0FBTztBQUFBLFVBQ1AscUJBQXFCO0FBQUEsVUFDckIsWUFBWTtBQUFBLFVBQ1osaUJBQWlCO0FBQUEsUUFDbkI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLElBQUk7QUFBQSxNQUNGLFdBQVc7QUFBQSxNQUNYLFNBQVMsQ0FBQyxVQUFVO0FBQUEsTUFDcEIsU0FBUyxDQUFDLG9CQUFvQixtQkFBbUI7QUFBQSxNQUNqRCxhQUFhO0FBQUEsSUFDZixDQUFDO0FBQUEsRUFDSDtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
