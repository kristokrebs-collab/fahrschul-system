import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: { '@jarvis/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Dev-only proxy so the SPA and API share an origin and the session cookie works.
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
})
