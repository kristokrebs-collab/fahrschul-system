/**
 * Everything both standalone builders need: the facts, the stylesheet, the
 * runtime, and a way to turn a file in /public into a data URI.
 *
 * The content comes from the same TypeScript modules the Next.js site renders
 * — a resolver hook (./ts-resolve.mjs) lets plain Node import them as-is.
 * A second, hand-copied set of facts would drift, and drift is the one failure
 * mode the truth layer exists to prevent.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..')

const MIME = { webm: 'video/webm', mp4: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', avif: 'image/avif', webp: 'image/webp', woff2: 'font/woff2', svg: 'image/svg+xml' }
const cache = new Map()

/** Read a file from /public (or a path relative to the repo) as a data URI, once. */
export function dataUri(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const path = relative.startsWith('/') ? join(ROOT, 'public', relative) : join(ROOT, relative)
  if (!existsSync(path)) {
    console.warn('  ! fehlt:', relative)
    cache.set(relative, '')
    return ''
  }
  const ext = path.split('.').pop().toLowerCase()
  const uri = `data:${MIME[ext] ?? 'application/octet-stream'};base64,${readFileSync(path).toString('base64')}`
  cache.set(relative, uri)
  return uri
}

/** The webfonts next/font emitted, inlined into an @font-face block. */
function fontFaces() {
  const dir = join(ROOT, '.next', 'static', 'media')
  if (!existsSync(dir)) return ''
  const files = readdirSync(dir).filter((f) => f.endsWith('.woff2'))
  // next/font emits one file per family/weight bucket; the display family is
  // variable, so both faces get the full range and the browser picks.
  return files
    .map((f, i) => {
      const uri = dataUri(join('.next', 'static', 'media', f))
      const family = i < 2 ? 'Archivo' : 'Instrument Sans'
      return `@font-face{font-family:'${family}';src:url(${uri}) format('woff2');font-weight:100 900;font-style:normal;font-display:swap}`
    })
    .join('')
}

export async function makeContext() {
  const { css } = await import('./theme.mjs')
  const { js } = await import('./runtime.mjs')

  const business = await import('../../src/content/business.ts')
  const classes = await import('../../src/content/classes.ts')
  const services = await import('../../src/content/services.ts')
  const prices = await import('../../src/content/prices.ts')
  const guide = await import('../../src/content/guide.ts')
  const truth = await import('../../src/content/truth.ts')
  const finder = await import('../../src/lib/licence-finder.ts')

  const pv = truth.publicValue

  const clientData = {
    finder: {
      questions: finder.finderQuestions.map((q) => ({
        id: q.id,
        question: q.question,
        hint: q.hint ?? null,
        options: q.options.map((o) => ({ value: o.value, label: o.label, description: o.description ?? null })),
      })),
    },
    prices: {
      // Quantities are per licence class — comparing two offers is only honest
      // when both sides are priced against the same, class-correct amounts.
      variants: Object.keys(prices.defaultAssumptions).map((slug) => ({
        slug,
        name: classes.classBySlug(slug)?.name ?? slug,
        rows: prices.defaultAssumptions[slug].map((a) => {
          const item = prices.priceItemById(a.itemId)
          return {
            id: a.itemId,
            label: item?.label ?? a.itemId,
            unit: item?.unit ?? '',
            note: a.note ?? null,
            quantity: a.quantity,
            min: a.min,
            max: a.max,
          }
        }),
      })),
    },
    classes: classes.licenceClasses.map((c) => ({
      slug: c.slug,
      code: c.code,
      name: c.name,
      summary: c.summary,
      minAge: pv(c.minAge) ?? null,
      prerequisites: c.prerequisites,
    })),
    services: services.services.map((s) => ({ slug: s.slug, name: s.name, group: s.group })),
  }

  return { business, classes, services, prices, guide, truth, finder, pv, dataUri, clientData, css, js, fontFaces: fontFaces() }
}
