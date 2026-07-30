import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'fs';
import path from 'path';

// usage: node frames.mjs <video> <outdir> <count> <width> <quality>
const [vid, outdir, countS, widthS, qualS] = process.argv.slice(2);
const count = +countS || 30, width = +widthS || 960, qual = +qualS || 0.7;

fs.mkdirSync(outdir, { recursive: true });
const dir = path.dirname(path.resolve(vid));
const base = path.basename(vid);

const shim = path.join(dir, '__grab.html');
fs.writeFileSync(shim, `<!doctype html><meta charset="utf-8">
<video id="v" src="${base}" muted preload="auto" playsinline></video>`);

const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto('file://' + shim);

const meta = await page.evaluate(async () => {
  const v = document.getElementById('v');
  await new Promise((res, rej) => {
    if (v.readyState >= 1) return res();
    v.addEventListener('loadedmetadata', res, { once: true });
    v.addEventListener('error', () => rej(new Error('video error ' + (v.error && v.error.code))), { once: true });
    setTimeout(() => rej(new Error('metadata timeout')), 20000);
  });
  return { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
});
console.log('meta', JSON.stringify(meta));

const shots = await page.evaluate(async ({ count, width, qual, duration }) => {
  const v = document.getElementById('v');
  const h = Math.round(width * v.videoHeight / v.videoWidth / 2) * 2;
  const c = document.createElement('canvas');
  c.width = width; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const out = [];
  // avoid the very last frame (often black/duplicate)
  const span = duration * 0.985;
  for (let i = 0; i < count; i++) {
    const t = span * (i / count); // 0..span, exclusive end => seamless loop
    await new Promise((res, rej) => {
      let done = false;
      const ok = () => { if (!done) { done = true; res(); } };
      v.addEventListener('seeked', ok, { once: true });
      v.currentTime = t;
      setTimeout(ok, 3000);
    });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    ctx.drawImage(v, 0, 0, width, h);
    out.push(c.toDataURL('image/jpeg', qual).split(',')[1]);
  }
  return { out, h };
}, { count, width, qual, duration: meta.duration });

let total = 0;
shots.out.forEach((b64, i) => {
  const buf = Buffer.from(b64, 'base64');
  total += buf.length;
  fs.writeFileSync(path.join(outdir, String(i).padStart(3, '0') + '.jpg'), buf);
});
fs.unlinkSync(shim);
await browser.close();
console.log(`${count} frames @ ${width}x${shots.h}  total ${(total/1048576).toFixed(2)} MB  avg ${(total/count/1024).toFixed(0)} KB  -> base64 ${(total*1.34/1048576).toFixed(2)} MB`);
