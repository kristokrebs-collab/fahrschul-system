#!/usr/bin/env node
// Renders the v2 thumbnails to 1280x720 PNGs with headless Chromium.
//
// v1 (build-thumbnails.js) followed the rules but read flat: pure line art
// on flat paper, no light, no depth. It survived the "legible at 210px"
// test and failed the "makes someone feel something" test, which is the
// one that decides whether a thumbnail gets clicked.
//
// v2 keeps every v1 rule — one dominant object, one visible conflict,
// 2-3 words that do NOT repeat the title, legible at ~210px — and adds the
// production values that separate a diagram from a poster:
//
//   * a spotlight gradient that puts light where the subject is
//   * a real vignette, so the eye is pushed inward
//   * layered shadows under the focal object so it sits ON the paper
//   * feTurbulence paper grain, at low opacity, over everything
//   * type that is genuinely large and tightly tracked
//
// Every SVG element here writes its stroke/fill as explicit attributes.
// Do NOT reintroduce shared CSS classes for stroke colour: a class beats a
// presentation attribute, which is how v1 silently painted a red danger
// needle in accent blue. That bug cost an afternoon.
//
// Usage:  node build-thumbnails-v2.js [--browser /path/to/chrome]
// Output: thumbnails/out-v2/<id>.png

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "out-v2");
fs.mkdirSync(OUT, { recursive: true });

const INK = "#141414";
const PAPER = "#F2EBDD";

// Shared page chrome. `spotX`/`spotY` place the key light over the subject
// so the focal object is the brightest thing in frame — the single cheapest
// way to make a flat drawing read as photographed.
const shell = (accent, spotX, spotY, body) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { margin: 0 }
  * { margin:0; padding:0; box-sizing:border-box }
  body { width:1280px; height:720px; overflow:hidden; position:relative;
         background:${PAPER};
         font-family:"Arial Black", Arial, Helvetica, sans-serif; }

  /* Key light sits UNDER the art (z-index:0) so it never washes the ink out.
     A white radial painted over the subject turns black line work grey —
     that is exactly what v2's first render did. Light below, shadow above. */
  .light { position:absolute; inset:0; z-index:0;
           background: radial-gradient(circle at ${spotX} ${spotY},
             rgba(255,253,247,1) 0%, rgba(250,244,231,.55) 30%, rgba(0,0,0,0) 62%); }

  /* Vignette rides on top but only ever darkens, and never reaches the middle. */
  .vig { position:absolute; inset:0; z-index:3; pointer-events:none;
         background: radial-gradient(ellipse at 50% 46%,
           rgba(0,0,0,0) 48%, rgba(26,20,12,.20) 84%, rgba(18,13,6,.42) 100%); }

  /* paper fibre — feTurbulence, kept light enough to texture but not to fog */
  .grain { position:absolute; inset:0; z-index:4; opacity:.11;
           mix-blend-mode:multiply; pointer-events:none; }

  .art { position:relative; z-index:2 }

  .kicker { position:absolute; z-index:2; top:34px; left:48px; font-size:23px; letter-spacing:4px;
            color:${INK}; opacity:.42; font-family:Arial,sans-serif; font-weight:700 }
  .band { position:absolute; z-index:5; left:0; bottom:0; width:100%; height:12px; background:${accent} }

  .txt { position:absolute; z-index:2; font-weight:900; color:${INK}; line-height:.88;
         letter-spacing:-3px; text-transform:uppercase;
         text-shadow: 0 3px 0 rgba(242,235,221,.9), 0 6px 22px rgba(0,0,0,.20); }
  .hl { color:${accent} }
  .sub { position:absolute; z-index:2; font-size:31px; font-weight:700; font-family:Arial,sans-serif;
         color:${INK}; opacity:.68; line-height:1.22 }

  svg { position:absolute; z-index:2 }
  .drop { filter: drop-shadow(0 16px 26px rgba(30,22,10,.34)) drop-shadow(0 3px 5px rgba(30,22,10,.22)); }
  .back { opacity:.26; z-index:1 }
</style></head><body>
<div class="light"></div>
${body}
<div class="vig"></div>
<svg class="grain" width="1280" height="720">
  <filter id="fbm"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/></filter>
  <rect width="1280" height="720" filter="url(#fbm)"/>
</svg>
<div class="band"></div>
</body></html>`;

// ---------------------------------------------------------------------------
// 4 — Phone / variable reward.
//     Dominant object: a phone. Conflict: its screen is a slot machine.
//     "NOT A PHONE" names the tension; the title names the behaviour.
// ---------------------------------------------------------------------------
const ACC4 = "#00A99A";
const reel = (x, sym) => `
  <rect x="${x}" y="150" width="86" height="300" rx="9" fill="#FFFDF6" stroke="${INK}" stroke-width="7"/>
  <!-- blurred neighbours above/below sell the spin without motion -->
  <g opacity=".22">${sym(x + 43, 205)}${sym(x + 43, 395)}</g>
  <g opacity=".55">${sym(x + 43, 246)}${sym(x + 43, 354)}</g>
  ${sym(x + 43, 300)}`;
const symCherry = (cx, cy) => `<circle cx="${cx - 11}" cy="${cy + 8}" r="15" fill="${ACC4}" stroke="${INK}" stroke-width="6"/><circle cx="${cx + 14}" cy="${cy + 12}" r="12" fill="none" stroke="${INK}" stroke-width="6"/><path d="M${cx - 11},${cy - 7} C${cx - 4},${cy - 26} ${cx + 10},${cy - 24} ${cx + 14},${cy}" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
const symBar = (cx, cy) => `<rect x="${cx - 26}" y="${cy - 13}" width="52" height="26" rx="5" fill="${ACC4}" stroke="${INK}" stroke-width="6"/>`;
const symSeven = (cx, cy) => `<path d="M${cx - 16},${cy - 20} L${cx + 16},${cy - 20} L${cx - 4},${cy + 22}" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;

const t4 = shell(ACC4, "30%", "46%",
  `<div class="kicker">THE INVISIBLE WHY</div>
   <svg class="drop" width="430" height="646" viewBox="0 0 400 600" style="left:74px; top:40px">
     <rect x="24" y="18" width="352" height="564" rx="46" fill="#151515"/>
     <rect x="36" y="30" width="328" height="540" rx="38" fill="#FFFDF6" stroke="${INK}" stroke-width="8"/>
     <rect x="150" y="46" width="100" height="13" rx="6" fill="${INK}" opacity=".55"/>
     <g transform="translate(48,62) scale(0.86)">
       ${reel(28, symCherry)}${reel(140, symBar)}${reel(252, symSeven)}
     </g>
     <!-- payline: the one thing on the page that is not ink-black -->
     <path d="M56,320 L344,320" fill="none" stroke="${ACC4}" stroke-width="11" stroke-linecap="round"/>
     <rect x="132" y="516" width="136" height="12" rx="6" fill="${INK}" opacity=".38"/>
   </svg>
   <div class="txt" style="right:54px; top:136px; font-size:130px; text-align:right">
     <span class="hl">NOT</span><br>A<br>PHONE</div>
   <div class="sub" style="right:58px; top:536px; text-align:right">
     Same machine.<br>Different casing.</div>`
);

// ---------------------------------------------------------------------------
// 5 — Decoy effect.
//     Dominant object: three price tiers. Conflict: the middle one is lit
//     like a prize and is the one you are meant to take.
// ---------------------------------------------------------------------------
const ACC5 = "#C62828";
const tier = (x, y, w, h, dim, price) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"
        fill="${dim ? "#E7DFCE" : "#FFFDF6"}" stroke="${INK}" stroke-width="8" opacity="${dim ? .58 : 1}"/>
  <text x="${x + w / 2}" y="${y + 62}" text-anchor="middle" font-family="Arial Black, Arial"
        font-size="46" fill="${INK}" opacity="${dim ? .55 : 1}">${price}</text>`;

const t5 = shell(ACC5, "36%", "52%",
  `<div class="kicker">THE INVISIBLE WHY</div>
   <svg width="640" height="470" viewBox="0 0 640 470" style="left:34px; top:196px">
     <!-- outer tiers sit flat and dull; the middle one is raised and lit -->
     ${tier(10, 150, 170, 250, true, "$59")}
     ${tier(452, 150, 170, 250, true, "$125")}
     <g class="drop">
       <rect x="212" y="86" width="208" height="314" rx="16" fill="#FFFDF6" stroke="${INK}" stroke-width="10"/>
       <rect x="212" y="86" width="208" height="52" rx="16" fill="${ACC5}"/>
       <rect x="212" y="126" width="208" height="14" fill="${ACC5}"/>
       <text x="316" y="126" text-anchor="middle" font-family="Arial Black, Arial" font-size="30" fill="#FFFDF6">BEST VALUE</text>
       <text x="316" y="222" text-anchor="middle" font-family="Arial Black, Arial" font-size="58" fill="${INK}">$125</text>
       <path d="M258,268 L374,268 M258,306 L374,306 M258,344 L336,344" stroke="${INK}" stroke-width="9" stroke-linecap="round" opacity=".72"/>
     </g>
     <!-- the wire: it is bait, and the wire is the only clue -->
     <path d="M316,400 L316,446" stroke="${ACC5}" stroke-width="6" stroke-dasharray="3 13" stroke-linecap="round"/>
     <path d="M266,452 L366,452" stroke="${INK}" stroke-width="9" stroke-linecap="round" opacity=".8"/>
   </svg>
   <div class="txt" style="right:50px; top:126px; font-size:132px; text-align:right; letter-spacing:-4px">
     ONE IS<br><span class="hl">BAIT</span></div>
   <div class="sub" style="right:54px; top:456px; text-align:right">
     It isn't there to<br>be bought.</div>`
);

// ---------------------------------------------------------------------------
// 6 — Waiting time.
//     Dominant object: a clock with elastic, stretched hands. Conflict: a
//     lone figure dwarfed at the end of a corridor that recedes too far.
// ---------------------------------------------------------------------------
const ACC6 = "#6A3FB5";
const t6 = shell(ACC6, "38%", "40%",
  `<div class="kicker">THE INVISIBLE WHY</div>
   <!-- floor lines converge hard: the corridor is longer than it should be -->
   <svg class="back" width="1280" height="720" viewBox="0 0 1280 720" style="left:0; top:0">
     <path d="M-60,720 L470,372 M210,720 L512,372 M520,720 L556,372 M900,720 L604,372 M1240,720 L648,372"
           stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
     <path d="M300,470 L760,470 M232,530 L812,530 M140,614 L884,614"
           stroke="${INK}" stroke-width="5" stroke-linecap="round" opacity=".5"/>
   </svg>
   <svg class="drop" width="520" height="520" viewBox="0 0 200 200" style="left:56px; top:56px">
     <circle cx="100" cy="100" r="82" fill="#FFFDF6" stroke="${INK}" stroke-width="9"/>
     <circle cx="100" cy="100" r="82" fill="none" stroke="${INK}" stroke-width="3" opacity=".35"/>
     <path d="M100,38 L100,48 M162,100 L152,100 M100,162 L100,152 M38,100 L48,100"
           stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
     <!-- hands stretched like elastic: time is being pulled, not measured -->
     <path d="M100,100 C112,74 128,62 150,54" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
     <path d="M100,100 C92,124 84,146 74,168" fill="none" stroke="${ACC6}" stroke-width="11" stroke-linecap="round"/>
     <circle cx="100" cy="100" r="10" fill="${INK}"/>
   </svg>
   <!-- the figure: small, alone, at the far end -->
   <svg width="120" height="200" viewBox="0 0 60 100" style="left:498px; top:300px">
     <circle cx="30" cy="17" r="12" fill="${INK}"/>
     <path d="M30,31 L30,66 M30,42 L16,56 M30,42 L44,56 M30,66 L19,92 M30,66 L41,92"
           stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
   </svg>
   <div class="txt" style="right:48px; top:132px; font-size:126px; text-align:right; letter-spacing:-4px">
     <span class="hl">SAME</span><br>EIGHT<br>MINUTES</div>
   <div class="sub" style="right:52px; top:498px; text-align:right">
     One of them feels<br>like forty.</div>`
);

const DESIGNS = [
  { id: "04-phone-variable-reward", html: t4 },
  { id: "05-decoy-effect", html: t5 },
  { id: "06-waiting-time", html: t6 },
];

function findBrowser() {
  const i = process.argv.indexOf("--browser");
  if (i !== -1) return process.argv[i + 1];
  return [
    "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
    "/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find((c) => fs.existsSync(c));
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
    "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--window-size=1280,720",
    `--screenshot=${pngPath}`, `file://${htmlPath}`,
  ], { stdio: "pipe" });
  console.log(`${pngPath} (${(fs.statSync(pngPath).size / 1024).toFixed(0)} KB)`);
}
console.log("Done.");
