/**
 * Builds the whole site as ONE HTML file.
 *
 * Same markup, same runtime and same facts as the per-page build — stitched
 * into a single document so the site can be handed over as one attachment and
 * opened by double-click, with no server and no network.
 *
 * Three problems had to be solved to make that honest rather than a trick:
 *
 * 1. Weight. Forty separate files re-embed the same header logo, the same
 *    background clip, the same poster forty times. Here every data URI is
 *    collected into one table and each use becomes an index, so a 3 MB clip is
 *    carried once no matter how many pages show it.
 *
 * 2. Colliding ids. Forty page bodies in one DOM would mean forty `#finder`s,
 *    and every `document.querySelector` would find the wrong one. So only the
 *    active page is ever in the document: the rest wait as strings and are
 *    swapped in on navigation. Nothing in the page markup or the runtime has
 *    to know it is being hosted this way.
 *
 * 3. Re-running the runtime. It was written to run once, at load. On every
 *    navigation it now runs again against the fresh page — so this file records
 *    what each run registers (window/document listeners, animation frames,
 *    observers) and revokes it before the next. Without that, forty
 *    navigations would leave forty scroll handlers reaching for elements that
 *    are gone.
 *
 * Usage: node scripts/standalone/single.mjs [outFile]
 */
import { register } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

register('./ts-resolve.mjs', import.meta.url)

const { makeContext, ROOT } = await import('./context.mjs')
const { renderAll } = await import('./pages.mjs')

const OUT = resolve(process.argv[2] ?? join(ROOT, 'standalone-site', 'fahrschule-krebs-komplett.html'))

const ctx = await makeContext()
const pages = renderAll(ctx)

/* ── Split each document into the parts that differ ──────────────────── */

const SPLIT = '\n<script>window.KREBS='
const views = pages.map(({ name, html }) => {
  const end = html.indexOf(SPLIT)
  if (end < 0) throw new Error(`Kein Runtime-Anker in ${name}`)
  return {
    route: name.replace(/\.html$/, ''),
    title: (html.match(/<title>([^<]*)<\/title>/) ?? [, name])[1],
    body: html.slice(html.indexOf('<body>') + '<body>'.length, end),
  }
})

// The head, the KREBS data block and the runtime are identical on every page —
// they are taken from the first document and shipped once.
const first = pages[0].html
const head = first.slice(first.indexOf('<head>') + '<head>'.length, first.indexOf('</head>'))
const krebsScript = first.slice(first.indexOf(SPLIT) + '\n<script>'.length, first.indexOf('</script>', first.indexOf(SPLIT)))

/* ── One asset table instead of forty copies ─────────────────────────── */

const assets = []
const seen = new Map()
let uses = 0

function intern(uri) {
  uses++
  let i = seen.get(uri)
  if (i === undefined) {
    i = assets.length
    assets.push(uri)
    seen.set(uri, i)
  }
  return i
}

// Attributes that would start a load are renamed as well as substituted, so
// the browser is never handed a placeholder it might try to fetch.
const LOADING_ATTR = /\b(src|poster|href|data-src)="(data:[a-z0-9/+.-]+;base64,[A-Za-z0-9+/=]+)"/g
// Anything left over (inside a style attribute, say) keeps a marked token that
// is swapped back in on the string, before the markup reaches the document.
const LOOSE_URI = /data:[a-z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/g

let loose = 0
for (const v of views) {
  v.body = v.body
    .replace(LOADING_ATTR, (_, attr, uri) => `data-uri-${attr === 'data-src' ? 'datasrc' : attr}="${intern(uri)}"`)
    .replace(LOOSE_URI, (uri) => {
      loose++
      return `__KA${intern(uri)}__`
    })
    // Page links become routes; anchors, tel: and mailto: are left alone.
    .replace(/href="([a-z0-9-]+)\.html(#([a-z0-9-]+))?"/g, (_, page, __, anchor) =>
      `href="#/${page}${anchor ? '!' + anchor : ''}"`,
    )
}

/* ── The router and the runtime harness ──────────────────────────────── */

const boot = `
/* ── Putting a page into the document ──────────────────────────────────
   Every page arrives with indices where its media should be. Filling them in
   is the first thing that happens, before the runtime ever sees the page. */
var URI_ATTR={'data-uri-src':'src','data-uri-poster':'poster','data-uri-href':'href','data-uri-datasrc':'data-src'};

function mount(view){
  var app=document.getElementById('app');
  app.innerHTML=view.b.replace(/__KA(\\d+)__/g, function(_,i){ return ASSETS[+i] });
  Object.keys(URI_ATTR).forEach(function(from){
    var to=URI_ATTR[from], nodes=app.querySelectorAll('['+from+']');
    for(var i=0;i<nodes.length;i++){
      nodes[i].setAttribute(to, ASSETS[+nodes[i].getAttribute(from)]);
      nodes[i].removeAttribute(from);
    }
  });
}

/* ── Runtime lifecycle ─────────────────────────────────────────────────
   The runtime registers scroll handlers, animation frames, timers and
   observers, and was never asked to stop — it only ever ran once. Here it
   runs again on every navigation, so everything it registers is recorded and
   revoked when its page goes.

   The animation frames are the subtle part. A self-rescheduling loop asks for
   its next frame long after the run that started it returned, so wrapping the
   scheduler only during the run would catch the first frame and miss the rest
   — the route would keep drawing on a canvas that had left the document, once
   per page ever visited. The wrappers are therefore installed permanently and
   a frame carries the generation it was scheduled in: a loop belonging to a
   page that is gone simply is not called again, and the chain ends itself. */
var RAW={
  wAdd:window.addEventListener.bind(window), wRem:window.removeEventListener.bind(window),
  dAdd:document.addEventListener.bind(document), dRem:document.removeEventListener.bind(document),
  raf:window.requestAnimationFrame.bind(window),
  setI:window.setInterval.bind(window), clearI:window.clearInterval.bind(window),
  setT:window.setTimeout.bind(window), clearT:window.clearTimeout.bind(window),
  IO:window.IntersectionObserver, RO:window.ResizeObserver
};

var generation=0, bucket=null, frameGen=null;

window.addEventListener=function(e,f,o){ if(bucket) bucket.listeners.push([window,e,f,o]); return RAW.wAdd(e,f,o) };
document.addEventListener=function(e,f,o){ if(bucket) bucket.listeners.push([document,e,f,o]); return RAW.dAdd(e,f,o) };
window.requestAnimationFrame=function(fn){
  var g = frameGen===null ? generation : frameGen;
  return RAW.raf(function(t){
    if(g!==generation) return;                       // its page is gone
    var prev=frameGen; frameGen=g;
    try { fn(t) } finally { frameGen=prev }
  });
};
window.setInterval=function(fn,ms){ var id=RAW.setI(fn,ms); if(bucket) bucket.intervals.push(id); return id };
window.setTimeout=function(fn,ms){ var id=RAW.setT(fn,ms); if(bucket) bucket.timeouts.push(id); return id };
window.IntersectionObserver=function(cb,o){ var i=new RAW.IO(cb,o); if(bucket) bucket.observers.push(i); return i };
if(RAW.RO) window.ResizeObserver=function(cb){ var r=new RAW.RO(cb); if(bucket) bucket.observers.push(r); return r };

function revoke(b){
  b.listeners.forEach(function(l){ (l[0]===window?RAW.wRem:RAW.dRem)(l[1],l[2],l[3]) });
  b.observers.forEach(function(o){ try{ o.disconnect() }catch(e){} });
  b.intervals.forEach(function(id){ RAW.clearI(id) });
  b.timeouts.forEach(function(id){ RAW.clearT(id) });
}

function runRuntime(){
  if(bucket) revoke(bucket);
  generation++;
  bucket={ listeners:[], observers:[], intervals:[], timeouts:[] };
  try { RUNTIME() } catch(err) { console.error(err) }
}

/* ── Routing ───────────────────────────────────────────────────────────
   '#/preise' is a page; '#finder' is a place on the page you are already on.
   Page links were rewritten at build time, so a plain anchor still works the
   way the browser has always made it work. */
var CURRENT=null;

function route(){
  var h=location.hash;
  if(h.indexOf('#/')!==0) return;                   // in-page anchor, not ours
  var parts=h.slice(2).split('!'), name=parts[0]||'index', anchor=parts[1];
  var view=PAGES[name]||PAGES.index;
  if(CURRENT!==view){
    CURRENT=view;
    document.title=view.t;
    // whatever the last page left on the shared elements goes back to neutral
    document.documentElement.style.setProperty('--daylight','0');
    document.body.style.overflow='';
    mount(view);
    runRuntime();
  }
  var target=anchor && document.getElementById(anchor);
  if(target) target.scrollIntoView({block:'start'}); else scrollTo(0,0);
}

RAW.wAdd('hashchange', route);   // the router outlives every page, so it is
                                 // registered past the bookkeeping above
if(location.hash.indexOf('#/')!==0) history.replaceState(null,'','#/index');
route();
`

/* ── Emit ────────────────────────────────────────────────────────────── */

const pageTable = JSON.stringify(Object.fromEntries(views.map((v) => [v.route, { t: v.title, b: v.body }]))).replace(
  /<\//g,
  '<\\/',
)

const doc = `<!doctype html>
<html lang="de">
<head>${head}</head>
<body>
<div id="app"></div>
<noscript><p style="padding:7rem 2rem;text-align:center;max-width:40rem;margin-inline:auto">Diese Fassung ist eine einzige Datei und wechselt die Seiten mit JavaScript. Ohne JavaScript funktionieren die Einzeldateien — dort ist jede Seite ein eigenes Dokument.</p></noscript>
<script>
var ASSETS=${JSON.stringify(assets)};
var PAGES=${pageTable};
${krebsScript}
var RUNTIME=function(){${ctx.js}};
${boot}
</script>
</body></html>`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, doc)

const mediaBytes = assets.reduce((n, a) => n + a.length, 0)
console.log(`Eine Datei → ${OUT}`)
console.log(`${views.length} Seiten · ${assets.length} Medien für ${uses} Verwendungen · ${(mediaBytes / 1024 / 1024).toFixed(1)} MB Medien`)
console.log(`Größe: ${(doc.length / 1024 / 1024).toFixed(1)} MB`)
if (loose) console.log(`${loose} Daten-URIs außerhalb von Attributen`)
