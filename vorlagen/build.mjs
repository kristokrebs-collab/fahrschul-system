/* Assembles the single-file deliverable from src/ parts + base64 assets. */
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const R = p => path.join(HERE, p);
const read = p => fs.readFileSync(R(p), 'utf8');
const b64 = p => fs.readFileSync(R(p)).toString('base64');

/* ---- fonts -> @font-face with data URIs ---------------------------------- */
const FONTS = [
  { file: 'assets/fonts/archivo-var.woff2',        family: 'Archivo',         weight: '400 800', stretch: '62% 125%' },
  { file: 'assets/fonts/instrumentsans-var.woff2', family: 'Instrument Sans', weight: '400 600', stretch: '75% 100%' },
  { file: 'assets/fonts/jetbrains-mono-latin-400-normal.woff2', family: 'JetBrains Mono', weight: '400', stretch: null },
];
const fontCss = FONTS.map(f => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};${
  f.stretch ? `font-stretch:${f.stretch};` : ''}font-display:block;src:url(data:font/woff2;base64,${b64(f.file)}) format('woff2');}`).join('\n');

/* ---- films (JPEG frame sequences) ---------------------------------------- */
const films = {};
for (const name of fs.readdirSync(R('assets/frames'))) {
  const dir = R(path.join('assets/frames', name));
  if (!fs.statSync(dir).isDirectory()) continue;
  films[name] = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort()
    .map(f => fs.readFileSync(path.join(dir, f)).toString('base64'));
}

/* ---- stills -------------------------------------------------------------- */
const img = {};
for (const f of fs.readdirSync(R('assets/img')).sort()) {
  if (f.endsWith('.jpg')) img[f.replace(/\.jpg$/, '')] = b64(path.join('assets/img', f));
}

/* ---- assemble ------------------------------------------------------------ */
const parts = fs.readdirSync(R('src')).sort();
const bucket = ext => parts.filter(p => p.endsWith(ext));

const css   = bucket('.css').map(p => `/* ==== ${p} ==== */\n` + read(path.join('src', p))).join('\n\n');
const html  = bucket('.html').map(p => `<!-- ==== ${p} ==== -->\n` + read(path.join('src', p))).join('\n\n');
const js    = bucket('.js').map(p => `/* ==== ${p} ==== */\n` + read(path.join('src', p))).join('\n\n');

const assetJs = `window.__A={films:${JSON.stringify(films)},img:${JSON.stringify(img)}};`;

const out = `<!doctype html>
<html lang="de" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>Krebs Premium — Vorlagen-Kollektion</title>
<meta name="description" content="Fünf produktionsreife Website-Vorlagen mit scroll-gesteuerten Filmhintergründen. Eine Datei, keine Abhängigkeiten.">
<style>
${fontCss}

${css}
</style>
</head>
<body>
${html}
<script>
${assetJs}
${js}
</script>
</body>
</html>
`;

const target = R(process.argv[2] || 'premium-templates.html');
fs.writeFileSync(target, out);
const mb = (Buffer.byteLength(out) / 1048576).toFixed(2);
console.log(`built ${path.basename(target)}  ${mb} MB`);
console.log(`  films: ${Object.entries(films).map(([k, v]) => k + '(' + v.length + ')').join(' ')}`);
console.log(`  stills: ${Object.keys(img).length}   css parts: ${bucket('.css').length}   html parts: ${bucket('.html').length}   js parts: ${bucket('.js').length}`);
