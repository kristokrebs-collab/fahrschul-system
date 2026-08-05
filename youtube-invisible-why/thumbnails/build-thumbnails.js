#!/usr/bin/env node
// Renders the channel's thumbnails to 1280x720 PNGs with headless Chromium.
//
// Thumbnails are built here rather than by hand because the rules that make
// one work are mechanical and easy to get wrong by eye: one dominant object,
// one visible conflict, 2-4 words of text that do NOT repeat the title, and
// everything legible at ~210px wide (the size it actually appears at in a
// sidebar or on a phone). Each design below is checked against those rules.
//
// Usage:
//   node build-thumbnails.js [--browser /path/to/chrome]
//
// Output: thumbnails/out/<id>.png

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const INK = "#141414";
const PAPER = "#F3EDE1";

// Shared page chrome. Deliberately high-contrast: thumbnails compete at
// thumbnail size, not at full size, so mid-tones and thin strokes vanish.
const shell = (accent, body) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { margin: 0 }
  * { margin:0; padding:0; box-sizing:border-box }
  body { width:1280px; height:720px; background:${PAPER}; overflow:hidden;
         font-family: "Arial Black", Arial, Helvetica, sans-serif; position:relative;
         background-image:
           radial-gradient(circle at 1px 1px, rgba(20,20,20,0.055) 1px, transparent 0),
           radial-gradient(circle at 68% 30%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.10) 100%);
         background-size: 15px 15px, cover; }
  .band { position:absolute; left:0; bottom:0; width:100%; height:14px; background:${accent} }
  .kicker { position:absolute; top:38px; left:52px; font-size:26px; letter-spacing:3px;
            color:${INK}; opacity:.55; font-family:Arial,sans-serif; font-weight:700 }
  .txt { position:absolute; font-weight:900; color:${INK}; line-height:.92;
         letter-spacing:-1.5px; text-transform:uppercase }
  .hl { color:${accent} }
  svg { position:absolute }
  .ink { fill:none; stroke:${INK}; stroke-width:9; stroke-linecap:round; stroke-linejoin:round }
  .inkf { fill:${PAPER}; stroke:${INK}; stroke-width:9; stroke-linejoin:round }
  .acc { fill:none; stroke:${accent}; stroke-width:11; stroke-linecap:round; stroke-linejoin:round }
  .accf { fill:${accent}; stroke:${INK}; stroke-width:8; stroke-linejoin:round }
</style></head><body>${body}<div class="band"></div></body></html>`;

// ---------------------------------------------------------------------------
// 1 — Cancel Subscriptions. Dominant object: a card. Conflict: it is chained.
//     Text "CAN'T CANCEL" states the tension, not the title.
// ---------------------------------------------------------------------------
const t1 = shell(
  "#2E9E5B",
  `<div class="kicker">THE INVISIBLE WHY</div>
   <svg width="620" height="620" viewBox="0 0 100 100" style="left:34px; top:96px">
     <path class="inkf" d="M12,26 L88,26 C92,26 95,29 95,33 L95,70 C95,74 92,77 88,77 L12,77 C8,77 5,74 5,70 L5,33 C5,29 8,26 12,26 Z"/>
     <path class="ink" d="M5,40 L95,40"/>
     <path class="ink" d="M15,53 L31,53 L31,65 L15,65 Z"/>
     <path class="acc" d="M42,64 L78,64"/>
   </svg>
   <!-- chain links dragging the card down: the conflict -->
   <svg width="360" height="300" viewBox="0 0 120 100" style="left:470px; top:392px">
     <ellipse class="ink" cx="16" cy="20" rx="13" ry="9" transform="rotate(38 16 20)"/>
     <ellipse class="ink" cx="38" cy="40" rx="13" ry="9" transform="rotate(38 38 40)"/>
     <ellipse class="ink" cx="60" cy="60" rx="13" ry="9" transform="rotate(38 60 60)"/>
     <ellipse class="ink" cx="82" cy="80" rx="13" ry="9" transform="rotate(38 82 80)"/>
   </svg>
   <div class="txt" style="right:56px; top:150px; font-size:132px; text-align:right">CAN'T<br><span class="hl">CANCEL</span></div>
   <div style="position:absolute; right:60px; top:430px; font-size:34px; font-weight:700;
               font-family:Arial,sans-serif; color:${INK}; opacity:.72; text-align:right; line-height:1.25">
     3 biases doing<br>the work for them</div>`
);

// ---------------------------------------------------------------------------
// 2 — Sleep. Dominant object: a gauge. Conflict: needle buried in the red.
//     "LEGALLY IMPAIRED" is the surprising claim the video actually proves.
// ---------------------------------------------------------------------------
const t2 = shell(
  "#2E6FE4",
  `<div class="kicker">THE INVISIBLE WHY</div>
   <!-- Explicit attributes only, no shared classes: a class's stroke wins
        over a presentation attribute, which silently painted the needle
        accent-blue over the red zone instead of ink-black. -->
   <svg width="620" height="620" viewBox="0 0 100 100" style="left:26px; top:96px">
     <path d="M8,72 A42,42 0 1,1 92,72" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
     <path d="M71,34 A42,42 0 0,1 92,72" fill="none" stroke="#E4572E" stroke-width="12" stroke-linecap="round"/>
     <path d="M50,72 L78,44" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
     <circle cx="50" cy="72" r="8" fill="#141414"/>
     <path d="M23,37 L27,41 M50,25 L50,31 M77,37 L73,41" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>
   </svg>
   <div class="txt" style="right:54px; top:120px; font-size:118px; text-align:right; letter-spacing:-2px">
     36 HOURS<br>AWAKE<br><span class="hl">=</span> DRUNK</div>
   <div style="position:absolute; right:58px; top:470px; font-size:33px; font-weight:700;
               font-family:Arial,sans-serif; color:${INK}; opacity:.72; text-align:right; line-height:1.25">
     and you won't<br>feel a thing</div>`
);

// ---------------------------------------------------------------------------
// 3 — Supermarket. Dominant object: a cart. Conflict: a long dotted detour
//     to reach one item. "JUST FOR MILK?" is the relatable question.
// ---------------------------------------------------------------------------
const t3 = shell(
  "#F0A202",
  `<div class="kicker">THE INVISIBLE WHY</div>
   <svg width="1280" height="720" viewBox="0 0 1280 720" style="left:0; top:0">
     <path d="M215,520 C330,440 275,338 425,306 C570,276 560,196 700,168"
           fill="none" stroke="#141414" stroke-width="10" stroke-dasharray="4 26"
           stroke-linecap="round" opacity=".62"/>
     <path d="M688,146 L730,168 L688,190 Z" fill="#F0A202" stroke="#141414" stroke-width="7" stroke-linejoin="round"/>
   </svg>
   <svg width="350" height="350" viewBox="0 0 100 100" style="left:52px; top:330px">
     <path class="ink" d="M4,14 L18,14 C21,14 23,17 24,20 L35,58 L80,58 L91,25 L28,25"/>
     <circle class="inkf" cx="45" cy="75" r="9"/>
     <circle class="inkf" cx="76" cy="75" r="9"/>
   </svg>
   <!-- the one item at the end of the detour, clear of the headline -->
   <svg width="180" height="180" viewBox="0 0 100 100" style="left:748px; top:52px">
     <path class="inkf" d="M32,30 L68,30 L74,86 C74,92 69,95 63,95 L37,95 C31,95 26,92 26,86 Z"/>
     <path class="inkf" d="M40,10 L60,10 L60,30 L40,30 Z"/>
     <path d="M38,58 L62,58" fill="none" stroke="#F0A202" stroke-width="11" stroke-linecap="round"/>
   </svg>
   <div class="txt" style="right:52px; top:288px; font-size:126px; text-align:right">JUST FOR<br><span class="hl">MILK?</span></div>
   <div style="position:absolute; right:56px; top:562px; font-size:33px; font-weight:700;
               font-family:Arial,sans-serif; color:${INK}; opacity:.72; text-align:right; line-height:1.25">
     Your route was<br>mapped years ago</div>`
);

const DESIGNS = [
  { id: "01-cancel-subscriptions", html: t1 },
  { id: "02-sleep-deprivation", html: t2 },
  { id: "03-supermarket-psychology", html: t3 },
];

function findBrowser() {
  const i = process.argv.indexOf("--browser");
  if (i !== -1) return process.argv[i + 1];
  const candidates = [
    "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
    "/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ];
  return candidates.find((c) => fs.existsSync(c));
}

const browser = findBrowser();
if (!browser) {
  console.error("No Chromium found. Pass --browser /path/to/chrome");
  process.exit(1);
}

for (const d of DESIGNS) {
  const htmlPath = path.join(OUT, `${d.id}.html`);
  const pngPath = path.join(OUT, `${d.id}.png`);
  fs.writeFileSync(htmlPath, d.html);
  execFileSync(browser, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1280,720",
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ], { stdio: "pipe" });
  console.log(`${pngPath} (${(fs.statSync(pngPath).size / 1024).toFixed(0)} KB)`);
}
console.log("Done.");
