/**
 * Lets Node import the site's TypeScript content layer as-is.
 *
 * Node 22 strips types on its own but keeps the strict ESM resolver, which
 * insists on file extensions — while the source (correctly, for a bundler)
 * writes `from './truth'` and `from '@/content/classes'`. This hook fills in
 * both gaps so the standalone build can read the very same facts the Next.js
 * site renders. Duplicating the content into a second file would guarantee the
 * two drift apart, which is the one failure mode the truth layer exists to
 * prevent.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..')

function firstExisting(base) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  // '@/lib/pricing' → <root>/src/lib/pricing.ts
  if (specifier.startsWith('@/')) {
    const hit = firstExisting(resolvePath(ROOT, 'src', specifier.slice(2)))
    if (hit) return { url: hit, shortCircuit: true }
  }
  // './truth' → ./truth.ts, relative to the importing file
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const from = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : ROOT
    const hit = firstExisting(resolvePath(from, specifier))
    if (hit) return { url: hit, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
