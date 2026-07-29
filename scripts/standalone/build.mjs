/**
 * Builds the standalone site: one self-contained HTML file per page.
 *
 * Nothing is fetched at runtime — stylesheet, fonts, script, photographs and
 * video all travel inside the file, so a page works when it is opened by
 * double-click on a machine that has never seen the internet. The facts come
 * from the same TypeScript content layer the Next.js site renders, read
 * directly through a resolver hook, so the two can never disagree.
 *
 * For the whole site as a single file, see ./single.mjs.
 *
 * Usage: node scripts/standalone/build.mjs [outDir]
 */
import { register } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

register('./ts-resolve.mjs', import.meta.url)

const { makeContext, ROOT } = await import('./context.mjs')
const { page } = await import('./pages.mjs')

const OUT = resolve(process.argv[2] ?? join(ROOT, 'standalone-site'))
mkdirSync(OUT, { recursive: true })

const written = page(await makeContext(), OUT)

const size = (f) => readFileSync(join(OUT, f)).length
const total = written.reduce((sum, f) => sum + size(f), 0)
console.log(`\n${written.length} eigenständige Seiten → ${OUT}/`)
console.log(`Start: index.html`)
console.log(
  `Gesamt: ${(total / 1024 / 1024).toFixed(1)} MB, größte Seite: ${(Math.max(...written.map(size)) / 1024 / 1024).toFixed(1)} MB`,
)
