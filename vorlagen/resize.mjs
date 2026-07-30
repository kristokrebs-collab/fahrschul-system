import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'fs';
import path from 'path';

// picks: "srcRelPath:outName:width:quality"
const picks = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(l => l && !l.startsWith('#'));
const root = process.argv[3];
const outdir = process.argv[4];
fs.mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
await page.goto('about:blank');

let total = 0;
for (const line of picks) {
  const [src, name, wS, qS] = line.split(':');
  const w = +wS, q = +qS;
  const file = path.join(root, src);
  if (!fs.existsSync(file)) { console.log('MISSING', src); continue; }
  const b64in = fs.readFileSync(file).toString('base64');
  const out = await page.evaluate(async ({ b64in, w, q }) => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + b64in;
    await img.decode();
    const h = Math.round(w * img.naturalHeight / img.naturalWidth / 2) * 2;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return { data: c.toDataURL('image/jpeg', q).split(',')[1], h };
  }, { b64in, w, q });
  const buf = Buffer.from(out.data, 'base64');
  total += buf.length;
  fs.writeFileSync(path.join(outdir, name + '.jpg'), buf);
  console.log(`${name.padEnd(20)} ${w}x${out.h}  ${(buf.length/1024).toFixed(0)} KB`);
}
await browser.close();
console.log(`\nTOTAL ${(total/1048576).toFixed(2)} MB raw -> ${(total*1.34/1048576).toFixed(2)} MB base64`);
