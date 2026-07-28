/**
 * Builds an offline, browsable copy of the website.
 *
 * Why this shape: a Next.js App Router build needs its own server to hydrate,
 * so a static mirror cannot run the React tools. But that cuts both ways —
 * without hydration `next/link` degrades to a plain anchor, so ordinary
 * page-to-page navigation works from the file system with no server at all.
 *
 * Each page therefore becomes one self-contained HTML file: stylesheet, all five
 * font faces and every photograph embedded as data URIs (fonts over file:// are
 * otherwise blocked by CORS, and next/image serves through a route that only
 * exists on the server), scripts removed, and internal links rewritten to
 * relative .html filenames.
 *
 * Usage: node scripts/build-offline-preview.mjs [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:3100'
const OUT = process.argv[2] ?? 'offline-preview'
/** STANDALONE=1 builds only the homepage, with internal links neutralised. */
const STANDALONE = process.env.STANDALONE === '1'

const ROUTES = [
  '/',
  '/fuehrerschein',
  '/fuehrerschein/klasse-b', '/fuehrerschein/bf17', '/fuehrerschein/b197',
  '/fuehrerschein/automatik', '/fuehrerschein/be', '/fuehrerschein/b96',
  '/fuehrerschein/mofa', '/fuehrerschein/am', '/fuehrerschein/a1',
  '/fuehrerschein/a2', '/fuehrerschein/a', '/fuehrerschein/c1',
  '/fuehrerschein/c1e', '/fuehrerschein/c', '/fuehrerschein/ce',
  '/fuehrerschein/d', '/fuehrerschein/de',
  '/leistungen',
  '/leistungen/berufskraftfahrer', '/leistungen/bkf-weiterbildung',
  '/leistungen/adr', '/leistungen/staplerschein', '/leistungen/ladungssicherung',
  '/leistungen/asf', '/leistungen/fes', '/leistungen/handicap',
  '/leistungen/ferienfahrschule',
  '/digitalpaket', '/schueler-cockpit', '/simulator', '/preise',
  '/ausbildungsablauf',
  '/standorte/fulda', '/standorte/bad-hersfeld',
  '/team', '/kontakt', '/impressum', '/datenschutz',
]

/** '/fuehrerschein/klasse-b' → 'fuehrerschein__klasse-b.html'; '/' → 'index.html' */
const fileFor = (route) => (route === '/' ? 'index.html' : `${route.slice(1).replace(/\//g, '__')}.html`)

const get = async (path) => {
  const res = await fetch(ORIGIN + path)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res
}

// --- Stylesheet with embedded fonts, fetched once and reused for every page ---
const firstPage = await (await get('/')).text()
const cssHref = firstPage.match(/href="(\/_next\/static\/chunks\/[^"]+\.css)"/)[1]
const cssDir = cssHref.slice(0, cssHref.lastIndexOf('/'))

let css = await (await get(cssHref)).text()
const fontRefs = [...new Set([...css.matchAll(/url\((\.\.\/media\/[^)]+\.woff2)\)/g)].map((m) => m[1]))]
for (const ref of fontRefs) {
  const absolute = new URL(ref, `${ORIGIN}${cssDir}/`).pathname
  const buffer = Buffer.from(await (await get(absolute)).arrayBuffer())
  css = css.replaceAll(ref, `data:font/woff2;base64,${buffer.toString('base64')}`)
}

const icon = Buffer.from(await (await get('/icon.svg')).text()).toString('base64')

// --- Photographs ---
// One width for everyone: the responsive candidate list is dropped, because a
// data URI per breakpoint would multiply the page weight for no benefit on a
// preview. 1200px covers the widest slot on the site (the 1152px shell).
const IMAGE_WIDTH = 1200
const imageCache = new Map()

async function inlineImage(encodedSource) {
  const cached = imageCache.get(encodedSource)
  if (cached) return cached
  const res = await fetch(`${ORIGIN}/_next/image?url=${encodedSource}&w=${IMAGE_WIDTH}&q=75`, {
    headers: { Accept: 'image/webp,*/*' },
  })
  if (!res.ok) throw new Error(`Bild ${decodeURIComponent(encodedSource)} → ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const uri = `data:${res.headers.get('content-type') ?? 'image/webp'};base64,${buffer.toString('base64')}`
  imageCache.set(encodedSource, uri)
  return uri
}

const NOTE = `<div id="vorschau-hinweis" style="position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:200;max-width:min(40rem,94vw);display:flex;gap:.7rem;align-items:flex-start;padding:.7rem .9rem;border-radius:.7rem;border:1px solid rgba(243,241,236,.14);background:rgba(10,12,14,.95);color:#9d9a92;font:400 11.5px/1.5 system-ui,sans-serif">
<span style="color:#e10a17;font-weight:700;white-space:nowrap">Offline-Vorschau</span>
<span style="flex:1">${STANDALONE ? 'Einzeldatei der Startseite — Links auf Unterseiten sind hier inaktiv, die vollständige Fassung liegt im ZIP.' : 'Alle 40 Seiten sind vollständig und untereinander verlinkt.'} Videos erscheinen hier als Standbilder; Finder, Rechner, 3D-Route und Cockpit-Animation brauchen den laufenden Server (<code style="color:#d8d5cd">npm run dev</code>).</span>
<button onclick="this.parentNode.remove()" style="background:none;border:0;color:#6e6c66;cursor:pointer;font:400 15px/1 system-ui;padding:0 2px" aria-label="Hinweis schließen">&times;</button>
</div>`

mkdirSync(OUT, { recursive: true })

let written = 0
for (const route of (STANDALONE ? ['/'] : ROUTES)) {
  let html = await (await get(route)).text()

  html = html
    .replace(/<link[^>]+rel="(stylesheet|preload|modulepreload|icon)"[^>]*>/g, '')
    // Strip Next's runtime: it cannot hydrate without its server, and leaving
    // it in only produces a page that looks interactive but is not.
    .replace(/<script[^>]*src="\/_next\/[^"]*"[^>]*><\/script>/g, '')
    .replace(/<script>self\.__next_f[\s\S]*?<\/script>/g, '')
    .replace(/<script[^>]*id="__NEXT_DATA__"[\s\S]*?<\/script>/g, '')

  for (const tag of new Set([...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]))) {
    // next/image sources go through the optimizer route…
    const optimized = tag.match(/\ssrc="\/_next\/image\?url=([^"&]+)(?:&amp;|&)[^"]*"/)
    // …while video posters and other direct assets reference /public paths.
    const direct = tag.match(/\ssrc="(\/(?:media|stills|team|vehicles|brand)\/[^"]+)"/)
    if (!optimized && !direct) continue
    const uri = optimized
      ? await inlineImage(optimized[1])
      : await inlineImage(encodeURIComponent(direct[1]))
    const rebuilt = tag
      .replace(/\s(?:srcSet|sizes)="[^"]*"/gi, '')
      .replace(/\ssrc="[^"]*"/, ` src="${uri}"`)
    html = html.replaceAll(tag, () => rebuilt)
  }

  // Internal links → relative filenames, so navigation works from disk.
  html = html.replace(/href="(\/[^"#?]*)(#[^"]*)?"/g, (match, path, hash = '') => {
    if (path.startsWith('/_next') || path.startsWith('/icon')) return match
    const target = path.replace(/\/$/, '') || '/'
    if (STANDALONE) return hash ? `href="${hash}"` : 'href="#"'
    if (!ROUTES.includes(target)) return `href="#"`
    return `href="${fileFor(target)}${hash}"`
  })

  html = html
    .replace('</head>', `<link rel="icon" href="data:image/svg+xml;base64,${icon}"><style>${css}</style></head>`)
    .replace('</body>', `${NOTE}</body>`)

  writeFileSync(join(OUT, fileFor(route)), html)
  written++
}

console.log(`${written} Seiten → ${OUT}/  (Start: index.html)`)
console.log(`eingebettet: 1 Stylesheet, ${fontRefs.length} Schriften, ${imageCache.size} Bilder`)
