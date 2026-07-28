/**
 * Release gate for the standalone build — run against file:// with every
 * request that is not file:/data:/blob: aborted, so nothing can quietly pass
 * because a server was there. Reports six things:
 *
 *   1. every page loads, has an H1, and asks the network for nothing
 *   2. the 21st.dev techniques are present in the markup, counted by selector
 *   3. measured screen brightness across the scroll (the daylight arc)
 *   4. reduced motion: no animation, posters instead of video, still usable
 *   5. keyboard: focus stays visible on every stop of a long tab run
 *   6. text contrast of the chapters that sit on video or on light panels
 *
 * Usage: node scripts/standalone/gate.mjs <dir>
 */
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'

const DIR = process.argv[2]
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.html')).sort()
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

/** A page with all non-local traffic blocked, plus error/request bookkeeping. */
async function offlinePage(ctx, viewport) {
  const p = await ctx.newPage()
  if (viewport) await p.setViewportSize(viewport)
  const state = { errors: [], external: [] }
  p.on('console', (m) => m.type() === 'error' && state.errors.push(m.text().slice(0, 140)))
  p.on('pageerror', (e) => state.errors.push('PAGEERROR ' + e.message.slice(0, 140)))
  await p.route('**', (r) => {
    const u = r.request().url()
    if (!/^(file|data|blob):/.test(u)) { state.external.push(u.slice(0, 60)); return r.abort() }
    return r.continue()
  })
  return { p, state }
}

const report = {}

/* ── 1. Every page, offline ─────────────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const broken = []
  for (const f of FILES) {
    const { p, state } = await offlinePage(ctx)
    await p.goto(`file://${DIR}/${f}`, { waitUntil: 'load' })
    await p.waitForTimeout(500)
    const h = await p.evaluate(() => ({
      h1: (document.querySelector('h1')?.textContent ?? '').trim().slice(0, 40),
      links: document.querySelectorAll('a[href$=".html"]').length,
      title: document.title.length,
    }))
    if (!h.h1 || !h.title || state.errors.length || state.external.length) {
      broken.push({ f, ...h, errors: state.errors.slice(0, 2), external: state.external.slice(0, 2) })
    }
    await p.close()
  }
  report.pages = { checked: FILES.length, broken }
  await ctx.close()
}

/* ── 2. Techniques present ──────────────────────────────────────────── */
const TECHNIQUES = [
  ['#5508 Shiny Button', '.shine'],
  ['#1081 orbiting border', '.orbit'],
  ['#5649 paper-shader haze', '.haze'],
  ['#2491 Reveal Text', '.outlier'],
  ['#3226 Minimal Dock', '.rail button'],
  ['#9643 Morphing cursor', '.cursor'],
  ['#5625 Shader ripple', 'canvas.ripple'],
  ['#525 Animated Tabs', '.tabs .ind'],
  ['#4559 View Magnifier', '.loupe'],
  ['#1081 Container Scroll', '.cockpit-stage'],
  ['#1913 mockup parallax', '.phone'],
  ['#3052 Feature Carousel', '.carousel'],
  ['#2497 auto slider', '.slider-row a'],
  ['#8341 Profile Card tilt', '.tilt'],
  ['#8687 Hover Footer', '.ftr-col'],
  ['#2049 Sign-in flow', '.signin'],
  ['spotlight cards', '.spot'],
  ['magnetic buttons', '[data-magnet]'],
  ['scroll reveal', '[data-rw]'],
  ['daylight film', '.arrive-film video'],
]
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const { p } = await offlinePage(ctx)
  await p.goto(`file://${DIR}/index.html`, { waitUntil: 'load' })
  await p.waitForTimeout(2200)
  // Techniques live where they belong, not all on one page — count across a
  // representative spread and record where each one was found.
  const SPREAD = ['index.html', 'schueler-cockpit.html', 'digitalpaket.html', 'standorte-fulda.html', 'fuehrerschein-klasse-b.html', 'preise.html', 'team.html', 'kontakt.html']
  const found = Object.fromEntries(TECHNIQUES.map(([n]) => [n, { count: 0, on: '' }]))
  for (const f of SPREAD) {
    await p.goto(`file://${DIR}/${f}`, { waitUntil: 'load' })
    await p.waitForTimeout(f === 'index.html' ? 2200 : 700)
    const counts = await p.evaluate((list) => list.map(([n, sel]) => [n, document.querySelectorAll(sel).length]), TECHNIQUES)
    for (const [n, c] of counts) if (c > found[n].count) found[n] = { count: c, on: f }
  }
  report.techniques = Object.entries(found).map(([n, v]) => [n, v.count, v.on])
  report.techniquesMissing = report.techniques.filter(([, n]) => n === 0).map(([n]) => n)
  await p.goto(`file://${DIR}/index.html`, { waitUntil: 'load' })
  await p.waitForTimeout(2200)

  /* ── 3. Measured brightness across the scroll ─────────────────────── */
  const stops = [0, 0.08, 0.16, 0.26, 0.36, 0.46, 0.56, 0.66, 0.76, 0.86, 0.94, 1]
  const H = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  const lum = []
  for (const f of stops) {
    await p.evaluate((y) => scrollTo(0, y), Math.round(H * f))
    await p.waitForTimeout(900)
    const shot = (await p.screenshot({ type: 'jpeg', quality: 60 })).toString('base64')
    const l = await p.evaluate(
      (b64) =>
        new Promise((res) => {
          const img = new Image()
          img.onload = () => {
            const c = document.createElement('canvas')
            c.width = 160
            c.height = 100
            const g = c.getContext('2d')
            g.drawImage(img, 0, 0, 160, 100)
            const d = g.getImageData(0, 0, 160, 100).data
            let s = 0
            for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
            res(Math.round(s / (d.length / 4)))
          }
          img.src = 'data:image/jpeg;base64,' + b64
        }),
      shot,
    )
    lum.push(l)
  }
  report.brightness = { stops: lum, min: Math.min(...lum), max: Math.max(...lum), range: Math.max(...lum) - Math.min(...lum) }

  /* ── 5. Keyboard focus ────────────────────────────────────────────── */
  await p.evaluate(() => scrollTo(0, 0))
  const focus = []
  for (let i = 0; i < 45; i++) {
    await p.keyboard.press('Tab')
    const f = await p.evaluate(() => {
      const e = document.activeElement
      if (!e || e === document.body) return null
      const s = getComputedStyle(e)
      const r = e.getBoundingClientRect()
      const visible =
        s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
          ? 'outline'
          : s.boxShadow !== 'none'
            ? 'shadow'
            : 'NONE'
      return { tag: e.tagName.toLowerCase(), label: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24), visible, onScreen: r.width > 0 && r.height > 0 }
    })
    if (f) focus.push(f)
  }
  report.keyboard = {
    stops: focus.length,
    invisible: focus.filter((f) => f.visible === 'NONE').map((f) => f.tag + ':' + f.label),
    offscreen: focus.filter((f) => !f.onScreen).length,
  }

  /* ── 6. Contrast, measured on the composited pixels ───────────────── */
  // Guessing the background from the cascade lies wherever a gradient, a
  // translucent panel or a video sits behind the copy — which is exactly
  // where this page puts its text. So the check reads the painted screen:
  // the most common luminance inside a text box is its background.
  const CHECKS = ['.dawn .eyebrow', '.dawn .h-chapter', '.dawn .lead', '.arrive-card .eyebrow', '.arrive-card .lead', '.arrive-card h2', '.hero .lead', '.hero .eyebrow']
  report.contrast = []
  for (const sel of CHECKS) {
    const ok = await p.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return false
      const r = el.getBoundingClientRect()
      scrollTo(0, r.top + scrollY - 260)
      return true
    }, sel)
    if (!ok) { report.contrast.push([sel, 'absent']); continue }
    await p.waitForTimeout(1000)
    const shot = (await p.screenshot({ type: 'png' })).toString('base64')
    report.contrast.push(
      await p.evaluate(
        async ([s, b64]) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const el = document.querySelector(s)
          const r = el.getBoundingClientRect()
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d')
          g.drawImage(img, 0, 0)
          const box = g.getImageData(Math.max(0, Math.round(r.left)), Math.max(0, Math.round(r.top)), Math.round(r.width), Math.round(r.height)).data
          const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
          const L = (a, b, d) => 0.2126 * lin(a) + 0.7152 * lin(b) + 0.0722 * lin(d)
          // histogram over 64 buckets; the mode of a text box is its background
          const hist = new Array(64).fill(0)
          const sum = new Array(64).fill(0)
          for (let i = 0; i < box.length; i += 4) {
            const l = L(box[i], box[i + 1], box[i + 2])
            const k = Math.min(63, Math.floor(l * 64))
            hist[k]++
            sum[k] += l
          }
          let mode = 0
          for (let k = 1; k < 64; k++) if (hist[k] > hist[mode]) mode = k
          const bg = sum[mode] / hist[mode]
          const fg = ((cc) => L(cc[0], cc[1], cc[2]))(getComputedStyle(el).color.match(/[\d.]+/g).map(Number))
          const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
          const px = parseFloat(getComputedStyle(el).fontSize)
          const bold = parseInt(getComputedStyle(el).fontWeight, 10) >= 700
          const need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5
          return [s, Math.round(ratio * 100) / 100, ratio >= need ? 'AA' : 'FAIL(' + need + ')']
        },
        [sel, shot],
      ),
    )
  }
  await p.close()
  await ctx.close()
}

/* ── 4. Reduced motion ──────────────────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const { p, state } = await offlinePage(ctx)
  await p.goto(`file://${DIR}/index.html`, { waitUntil: 'load' })
  await p.waitForTimeout(1800)
  const a = await p.evaluate(() => {
    const c = document.getElementById('route')
    return c ? c.getContext('2d').getImageData(0, 0, 40, 40).data.join('') : ''
  })
  await p.evaluate(() => scrollTo(0, 2000))
  await p.waitForTimeout(1200)
  const b = await p.evaluate(() => {
    const c = document.getElementById('route')
    return c ? c.getContext('2d').getImageData(0, 0, 40, 40).data.join('') : ''
  })
  // the finder must still answer under reduced motion
  await p.locator('#finder').scrollIntoViewIfNeeded()
  let steps = 0
  while (steps < 8) {
    const o = p.locator('#finder .opt').first()
    if (!(await o.count())) break
    await o.click(); steps++
    await p.waitForTimeout(120)
  }
  report.reducedMotion = {
    routeStatic: a === b,
    videosWithSource: await p.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.src).length),
    postersPresent: await p.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.poster).length),
    finderSteps: steps,
    result: await p.locator('#finder h3').first().innerText().catch(() => ''),
    errors: state.errors.slice(0, 3),
  }
  await p.close()
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 1))
