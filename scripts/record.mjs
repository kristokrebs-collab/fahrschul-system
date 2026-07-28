/** Records a smooth scroll through a page region as evidence of the motion design. */
import { chromium } from '@playwright/test'
const [, , url = 'http://127.0.0.1:3100/', out = 'recording', from = '0', to = '9000', step = '12'] = process.argv
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})
const p = await ctx.newPage()
await p.goto(url, { waitUntil: 'networkidle' })
await p.evaluate((y) => window.scrollTo(0, y), Number(from))
await p.waitForTimeout(600)
await p.evaluate(async ({ from, to, step }) => {
  await new Promise((resolve) => {
    let y = from
    const tick = () => {
      y += step
      window.scrollTo(0, y)
      if (y < to) requestAnimationFrame(tick)
      else resolve(null)
    }
    requestAnimationFrame(tick)
  })
}, { from: Number(from), to: Number(to), step: Number(step) })
await p.waitForTimeout(800)
await ctx.close()
await b.close()
console.log('recorded')
