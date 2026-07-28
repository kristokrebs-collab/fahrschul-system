import { chromium, devices } from '@playwright/test'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ ...devices['Pixel 7'] })
await page.goto('http://127.0.0.1:3100/', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Menü öffnen' }).click()
await page.waitForTimeout(600)
const r = await page.evaluate(() => {
  const link = [...document.querySelectorAll('#mobile-nav a')].find(a => a.textContent.trim() === 'Klasse B')
  const rect = link.getBoundingClientRect()
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
  const top = document.elementFromPoint(cx, cy)
  const panel = document.getElementById('mobile-nav')
  const pcs = getComputedStyle(panel)
  const header = document.querySelector('header')
  return {
    linkRect: { x: Math.round(cx), y: Math.round(cy), w: Math.round(rect.width), h: Math.round(rect.height) },
    topEl: top ? top.tagName + '.' + String(top.className).slice(0, 70) : null,
    panel: { pos: pcs.position, z: pcs.zIndex, top: pcs.top, display: pcs.display, vis: pcs.visibility },
    headerZ: getComputedStyle(header).zIndex,
    viewport: { w: innerWidth, h: innerHeight },
  }
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
