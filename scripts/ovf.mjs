/**
 * Reports horizontal overflow and its cause at a given viewport width.
 * Used during visual QA — a page that scrolls sideways on a phone is a defect.
 */
import { chromium } from '@playwright/test'
const [, , url = 'http://127.0.0.1:3100/', w = '412'] = process.argv
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: Number(w), height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
const r = await page.evaluate(() => {
  const docW = document.documentElement.clientWidth
  const out = []
  const walk = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width && (rect.right > docW + 1 || rect.left < -1)) {
      let clipped = false
      let p = el.parentElement
      while (p) {
        const cs = getComputedStyle(p)
        if (['hidden', 'auto', 'scroll', 'clip'].includes(cs.overflowX)) { clipped = true; break }
        p = p.parentElement
      }
      if (!clipped && getComputedStyle(el).position !== 'fixed') {
        out.push({ tag: el.tagName, cls: String(el.className).slice(0, 70), left: Math.round(rect.left), right: Math.round(rect.right) })
        return
      }
    }
    for (const c of el.children) walk(c)
  }
  walk(document.body)
  return { docW, scrollW: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth - docW, unclipped: out.slice(0, 8) }
})
console.log(process.argv[2] || '/', JSON.stringify(r))
await browser.close()
