import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync } from 'node:fs'

export default defineConfig({
  // schema.sql is data, not code — tsup would not pick it up, and the server
  // cannot start without it. Copy it next to the bundle.
  async onSuccess() {
    mkdirSync('dist/db', { recursive: true })
    copyFileSync('src/db/schema.sql', 'dist/db/schema.sql')
  },
  entry: ['src/main.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Native + heavy runtime deps stay external; everything else (including the
  // source-only @jarvis/shared workspace package) is bundled.
  external: ['better-sqlite3', 'pdfjs-dist', 'mammoth', 'xlsx', '@anthropic-ai/sdk', 'fastify',
    '@fastify/cookie', '@fastify/static', '@fastify/rate-limit'],
  noExternal: ['@jarvis/shared'],
})
