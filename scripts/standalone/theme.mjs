/**
 * The complete stylesheet for the standalone build, as one string.
 *
 * Written by hand rather than extracted from Tailwind: the offline files must
 * carry every rule they use and nothing else, and a utility framework's output
 * is neither small nor readable once inlined.
 *
 * Brightness: the previous build sat on #060708 — near-black — for the whole
 * night half. That was the single most common note. The ink scale now starts
 * at #12171e, a deep blue-grey with real colour in it, and the daylight half
 * is unchanged. The page still reads as a night drive; it no longer reads as
 * a black rectangle.
 */
export const css = /* css */ `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  /* Ink — night asphalt, lifted well clear of black */
  --ink-950:#12171e; --ink-900:#171d26; --ink-850:#1e2530; --ink-800:#26303c;
  --ink-750:#2f3a48; --ink-700:#3a4655; --ink-600:#4c5a6b; --ink-500:#66768a;
  --ink-400:#8494a8;
  /* Chalk — road-marking paint */
  --chalk:#f4f2ed; --chalk-soft:#dcd9d2; --chalk-dim:#a9b0ba; --chalk-faint:#7b8593;
  /* Dawn — the daylight end */
  --dawn-50:#f7f4ee; --dawn-100:#efebe1; --dawn-200:#e3ddd1; --dawn-300:#d0c9bb;
  /* Signal — Verkehrsrot */
  --signal:#e10a17; --signal-400:#ff3b45; --signal-600:#c00711;
  --amber:#e0a11a;
  --ok:#3f9d6d;

  --font-display:'Archivo',ui-sans-serif,system-ui,'Segoe UI',sans-serif;
  --font-sans:'Instrument Sans',ui-sans-serif,system-ui,'Segoe UI',sans-serif;
  --ease-route:cubic-bezier(.22,.61,.36,1);
  --header-h:4.5rem;
  --daylight:0;
  --shell:min(76rem,100% - 3rem);
}

html{-webkit-text-size-adjust:100%;scroll-padding-top:calc(var(--header-h) + 1rem)}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}

body{
  background:var(--ink-950); color:var(--chalk);
  font-family:var(--font-sans); font-size:1rem; line-height:1.6;
  -webkit-font-smoothing:antialiased; overflow-x:hidden; isolation:isolate;
}
h1,h2,h3,h4{font-family:var(--font-display);font-weight:800;line-height:1.03;letter-spacing:-.02em;text-wrap:balance}
p{text-wrap:pretty}
h1,h2,h3,h4,p,li{overflow-wrap:break-word;hyphens:auto}
a{color:inherit}
img,video,canvas,svg{display:block;max-width:100%}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--signal-400);outline-offset:3px;border-radius:3px}
::selection{background:var(--signal);color:#fff}
.tabular{font-variant-numeric:tabular-nums}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ── Layout ─────────────────────────────────────────────── */
.shell{width:var(--shell);margin-inline:auto;position:relative}
.chapter{padding:clamp(4.5rem,8vw,7rem) 0;position:relative}
.day + .day{padding-top:0}
.eyebrow{display:flex;align-items:center;gap:.75rem;font-size:.6875rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--chalk-dim)}
.eyebrow::before{content:'';width:2rem;height:2px;background:var(--signal);flex:none}
.h-chapter{font-size:clamp(2rem,4.4vw,3.4rem);margin-top:1.15rem}
.lead{font-size:clamp(1.02rem,1.55vw,1.2rem);line-height:1.62;color:var(--chalk-dim);margin-top:1.15rem;max-width:54ch}

/* ── The daylight arc ───────────────────────────────────── */
.sky{position:fixed;inset:0;z-index:-30;pointer-events:none;
  background-color:color-mix(in oklab,var(--ink-950),var(--dawn-300) calc(var(--daylight)*34%))}
.sky::after{content:'';position:absolute;inset:0;
  background:radial-gradient(120% 70% at 50% calc(118% - var(--daylight)*46%),
    color-mix(in oklab,#ffdcb8 calc(20% + var(--daylight)*32%),transparent),transparent 68%);
  opacity:calc(.3 + var(--daylight)*.7)}

.day{
  --ink-950:#f7f4ee; --ink-900:#f0ece3; --ink-850:#e8e3d9; --ink-800:#dfd9cd;
  --ink-750:#d4cec1; --ink-700:#c6bfb0; --ink-600:#a9a294; --ink-500:#8c857a; --ink-400:#6f6961;
  --chalk:#141a20; --chalk-soft:#2c343c; --chalk-dim:#4e5762; --chalk-faint:#6f7885;
  --signal:#c00711; --signal-400:#c00711; --signal-600:#8f050c;
  background-color:var(--ink-950); color:var(--chalk);
}
/* The sunrise: exactly one chapter crosses from night into day. Its copy
   starts below the gradient's midpoint and its eyebrow drops to full ink —
   measured on the composited pixels, --chalk-dim inside the weld only
   reaches 2.9:1, which is not a contrast anyone should have to squint past. */
.dawn{background-color:transparent;
  background-image:linear-gradient(to bottom,transparent 0,var(--ink-950) 11rem)}
.chapter.dawn{padding-top:9.5rem}
.dawn .eyebrow{color:var(--chalk)}
.dawn::before{content:'';position:absolute;inset:0 0 auto 0;height:11rem;pointer-events:none;
  background:radial-gradient(85% 100% at 50% 100%,color-mix(in oklab,#ffd2a0 55%,transparent),transparent 74%)}
.day .atmo-lanes{display:none}

/* ── Header ─────────────────────────────────────────────── */
.hdr{position:fixed;inset:0 0 auto 0;z-index:60;height:var(--header-h);display:flex;align-items:center;
  transition:background-color .35s,border-color .35s;border-bottom:1px solid transparent}
.hdr[data-solid]{background:color-mix(in oklab,#12171e 88%,transparent);border-bottom-color:rgb(255 255 255/.09);backdrop-filter:blur(14px)}
/* Over the daylight half the bar turns to paper, or it reads as a foreign object */
.hdr[data-light]{color:#141a20}
.hdr[data-light][data-solid]{background:color-mix(in oklab,#f7f4ee 90%,transparent);border-bottom-color:rgb(0 0 0/.1)}
.hdr[data-light] .nav a{color:#4e5762}
.hdr[data-light] .nav a:hover,.hdr[data-light] .nav a[aria-current]{color:#141a20;background:rgb(0 0 0/.06)}
.hdr[data-light] .brand b{color:#c00711}
.hdr[data-light] .brand small{color:#2c343c}
.hdr[data-light] .burger{border-color:rgb(0 0 0/.16);background:rgb(0 0 0/.04)}
.hdr[data-light] .burger span{background:#141a20;box-shadow:0 -5px 0 #141a20,0 5px 0 #141a20}
.hdr .shell{display:flex;align-items:center;gap:1.1rem}
.brand{display:flex;align-items:center;gap:.6rem;text-decoration:none;flex:none}
.brand b{font-family:var(--font-display);font-weight:900;font-size:1.5rem;letter-spacing:-.03em;color:var(--signal-400)}
.brand .bars{display:flex;gap:2px;height:1.5rem}
.brand .bars i{width:3px;border-radius:1px}
.brand .bars i:first-child{background:var(--amber)}
.brand .bars i:last-child{background:var(--signal-400)}
.brand small{display:block;font-family:var(--font-display);font-weight:800;font-size:.5rem;letter-spacing:.22em;line-height:1.35;color:var(--chalk-soft)}
.nav{display:none;gap:.25rem;margin-left:auto}
.nav a{padding:.5rem .7rem;border-radius:.6rem;font-size:.86rem;font-weight:600;white-space:nowrap;text-decoration:none;color:var(--chalk-dim);transition:color .2s,background-color .2s}
.nav a:hover,.nav a[aria-current]{color:var(--chalk);background:rgb(255 255 255/.06)}
.hdr .tel{display:none;font-weight:700;text-decoration:none;white-space:nowrap}
.hdr .cta{display:none}
@media(min-width:1200px){.nav{display:flex}.hdr .tel,.hdr .cta{display:inline-flex}}
.burger{margin-left:auto;width:2.75rem;height:2.75rem;display:grid;place-items:center;border:1px solid rgb(255 255 255/.14);border-radius:.7rem;background:rgb(255 255 255/.04);cursor:pointer}
@media(min-width:1200px){.burger{display:none}}
.burger span{display:block;width:1.05rem;height:2px;background:var(--chalk);box-shadow:0 -5px 0 var(--chalk),0 5px 0 var(--chalk)}
.mnav{position:fixed;inset:var(--header-h) 0 0 0;z-index:55;background:color-mix(in oklab,#12171e 97%,transparent);padding:1.5rem;overflow-y:auto;display:none}
.mnav[data-open]{display:block}
.mnav a{display:block;padding:.85rem .25rem;border-bottom:1px solid rgb(255 255 255/.08);font-size:1.05rem;font-weight:600;text-decoration:none}

/* ── Buttons ────────────────────────────────────────────── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:3.1rem;padding:0 1.65rem;white-space:nowrap;
  border-radius:.8rem;font-weight:650;font-size:.98rem;text-decoration:none;cursor:pointer;border:1px solid transparent;
  transition:background-color .25s,border-color .25s,color .25s}
.btn-primary{background:var(--signal);color:#fff;box-shadow:0 16px 44px -18px color-mix(in oklab,var(--signal) 85%,transparent)}
.btn-primary:hover{background:var(--signal-600)}
.btn-ghost{border-color:color-mix(in oklab,var(--chalk) 22%,transparent);background:color-mix(in oklab,var(--chalk) 5%,transparent);color:var(--chalk)}
.btn-ghost:hover{border-color:color-mix(in oklab,var(--chalk) 42%,transparent)}
.btn-quiet{color:var(--chalk-soft);text-decoration:underline;text-underline-offset:4px;background:none;min-height:3.1rem;padding:0 .3rem}

/* 21st.dev #5508 Shiny Button — a headlight passing over metal */
.shine{position:relative;overflow:hidden;isolation:isolate}
.shine::after{content:'';position:absolute;inset:-60%;z-index:-1;opacity:0;pointer-events:none;
  background:conic-gradient(from var(--lap,0deg),transparent 0deg,transparent 298deg,rgb(255 255 255/.75) 332deg,transparent 360deg);
  transition:opacity .3s}
.shine:hover::after,.shine:focus-visible::after{opacity:.55;animation:lap 2.1s linear infinite}
@keyframes lap{to{--lap:360deg}}
@property --lap{syntax:'<angle>';inherits:false;initial-value:0deg}

/* ── Surfaces ───────────────────────────────────────────── */
.card{border:1px solid color-mix(in oklab,var(--chalk) 12%,transparent);border-radius:1rem;
  background:color-mix(in oklab,var(--ink-850) 72%,transparent);padding:1.6rem}
.grid{display:grid;gap:1.15rem}
@media(min-width:640px){.g2{grid-template-columns:repeat(2,1fr)}}
@media(min-width:960px){.g3{grid-template-columns:repeat(3,1fr)}}
@media(min-width:960px){.g4{grid-template-columns:repeat(4,1fr)}}

/* 21st.dev #1081-adjacent orbiting border light */
.orbit{position:relative}
.orbit::before{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:1px;pointer-events:none;opacity:0;
  background:conic-gradient(from var(--lap,0deg),transparent 0deg,transparent 300deg,color-mix(in oklab,var(--signal) 90%,transparent) 342deg,transparent 360deg);
  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;transition:opacity .35s}
.orbit:hover::before{opacity:1;animation:lap 2.6s linear infinite}

/* Headlight spotlight over grouped cards */
.spot{position:relative;--mx:50%;--my:50%;--s:0}
.spot::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:var(--s);
  background:radial-gradient(260px circle at var(--mx) var(--my),color-mix(in oklab,var(--signal) 13%,transparent),transparent 66%);
  transition:opacity .35s}

/* ── Hero ───────────────────────────────────────────────── */
.hero{position:relative;min-height:100svh;display:flex;flex-direction:column;justify-content:flex-end;
  overflow:hidden;padding-top:var(--header-h);isolation:isolate}
.hero-media{position:absolute;inset:0;z-index:-2}
.hero-media video,.hero-media img{width:100%;height:100%;object-fit:cover;object-position:center bottom}
.hero-scrim{position:absolute;inset:0;z-index:-1;pointer-events:none;
  background:linear-gradient(100deg,var(--ink-950) 6%,color-mix(in oklab,var(--ink-950) 74%,transparent) 40%,transparent 74%),
             linear-gradient(to top,var(--ink-950) 2%,transparent 38%)}
/* 21st.dev #5649 paper-shader haze, rebuilt as two very slow fields */
.haze{position:absolute;inset:0;z-index:-1;pointer-events:none;
  background:radial-gradient(46% 38% at 22% 66%,color-mix(in oklab,var(--signal) 12%,transparent),transparent 70%),
             radial-gradient(52% 44% at 78% 40%,color-mix(in oklab,#9fc0dd 12%,transparent),transparent 72%);
  animation:haze 26s ease-in-out infinite alternate}
@keyframes haze{from{transform:translate3d(-2.5%,1.5%,0) scale(1.04)}to{transform:translate3d(2.5%,-1.5%,0) scale(1.1)}}
.hero-body{padding:5rem 0 4rem}
.h-hero{font-size:clamp(2.7rem,7.4vw,5.6rem);margin-top:1.3rem;max-width:16ch}
.h-hero .red{color:var(--signal-400)}

/* 21st.dev #2491 Reveal Text — the single typographic outlier */
.outlier{display:inline-block}
.outlier i{display:inline-block;white-space:pre;font-style:normal;transform-origin:50% 100%}
.outlier[data-o="armed"] i{opacity:0;transform:translateY(.42em) scaleY(.82)}
.outlier[data-o="go"] i{opacity:1;transform:none;
  transition:opacity .42s ease-out,transform .82s cubic-bezier(.2,1.42,.32,1);
  transition-delay:calc(var(--g)*42ms)}

.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:1.4rem;margin-top:3.2rem;padding-top:2rem;
  border-top:1px solid rgb(255 255 255/.12);max-width:48rem}
@media(min-width:640px){.stats{grid-template-columns:repeat(4,1fr)}}
.stats b{display:block;font-family:var(--font-display);font-size:clamp(1.6rem,3vw,2.3rem);line-height:1}
.stats span{display:block;margin-top:.45rem;font-size:.78rem;color:var(--chalk-dim);line-height:1.35}

/* ── The route canvas ───────────────────────────────────── */
#route{position:fixed;inset:0;width:100%;height:100%;z-index:-20;pointer-events:none;opacity:0;transition:opacity 1.2s ease}
#route[data-on]{opacity:1}

/* 21st.dev #3226 Minimal Dock — the chapter rail, with reflection */
.rail{position:fixed;right:1.1rem;top:50%;transform:translateY(-50%);z-index:40;display:none;flex-direction:column;
  gap:.42rem;align-items:flex-end}
@media(min-width:1180px){.rail{display:flex}}
.rail button{position:relative;width:1.35rem;height:.5rem;border:0;background:none;cursor:pointer;padding:0;display:block}
.rail button::before{content:'';position:absolute;right:0;top:50%;height:2px;width:100%;border-radius:2px;
  transform:translateY(-50%) scaleX(.55);transform-origin:right;
  background:color-mix(in oklab,var(--chalk) 42%,var(--ink-950) calc(var(--daylight)*70%));
  transition:transform .3s var(--ease-route),background-color .3s,box-shadow .3s}
.rail button::after{content:'';position:absolute;right:0;top:calc(50% + 4px);height:2px;width:100%;border-radius:2px;
  transform:translateY(-50%) scaleX(.55) scaleY(-1);transform-origin:right;opacity:.22;filter:blur(1px);
  background:inherit;background-color:color-mix(in oklab,var(--chalk) 42%,transparent)}
.rail button[data-near]::before{transform:translateY(-50%) scaleX(1);background-color:var(--signal-400);
  box-shadow:0 0 12px color-mix(in oklab,var(--signal) 75%,transparent)}
.rail button span{position:absolute;right:2rem;top:50%;transform:translateY(-50%) translateX(.4rem);
  white-space:nowrap;font-size:.7rem;font-weight:650;padding:.3rem .55rem;border-radius:.4rem;opacity:0;
  pointer-events:none;background:color-mix(in oklab,var(--ink-900) 94%,transparent);border:1px solid rgb(255 255 255/.12);
  transition:opacity .25s,transform .25s}
.rail button:hover span,.rail button:focus-visible span{opacity:1;transform:translateY(-50%) translateX(0)}

/* 21st.dev #9643 Morphing cursor — a headlight that swells over targets */
.cursor{position:fixed;left:0;top:0;z-index:5;pointer-events:none;opacity:0;transition:opacity .5s;
  width:30rem;height:30rem;margin:-15rem 0 0 -15rem;mix-blend-mode:screen;
  background:radial-gradient(closest-side,color-mix(in oklab,#ffe6c8 10%,transparent),transparent 72%);
  filter:opacity(calc(1 - var(--daylight)*.85))}
.cursor-dot{position:fixed;left:0;top:0;z-index:50;pointer-events:none;width:12px;height:12px;margin:-6px 0 0 -6px;
  border-radius:50%;border:1.5px solid var(--signal-400);opacity:0;
  transition:opacity .3s,width .3s var(--ease-route),height .3s var(--ease-route),margin .3s var(--ease-route),background-color .3s}
.cursor-dot[data-hot]{width:44px;height:44px;margin:-22px 0 0 -22px;background:color-mix(in oklab,var(--signal) 18%,transparent)}

/* ── Reveal ─────────────────────────────────────────────── */
.rv[data-rv="armed"]{opacity:0;transform:translateY(20px)}
.rv[data-rv="go"]{opacity:1;transform:none;transition:opacity .75s ease,transform .75s var(--ease-route)}
.word{display:inline-block;overflow:clip;vertical-align:bottom}
.word>i{display:inline-block;font-style:normal}
[data-rw="armed"] .word>i{transform:translateY(112%)}
[data-rw="go"] .word>i{transform:none;transition:transform .85s cubic-bezier(.19,1,.22,1);transition-delay:calc(var(--w)*58ms)}

/* ── Finder ─────────────────────────────────────────────── */
.finder{border:1px solid rgb(255 255 255/.13);border-radius:1.15rem;overflow:hidden;position:relative;
  background:color-mix(in oklab,var(--ink-850) 80%,transparent)}
.finder-bar{height:3px;background:rgb(255 255 255/.09)}
.finder-bar i{display:block;height:100%;background:var(--signal);transition:width .5s var(--ease-route)}
.finder-in{padding:1.75rem}
@media(min-width:640px){.finder-in{padding:2.25rem}}
.opt{display:flex;gap:.85rem;align-items:flex-start;padding:1rem;border-radius:.8rem;cursor:pointer;
  border:1px solid rgb(255 255 255/.12);background:rgb(255 255 255/.03);text-align:left;width:100%;
  transition:border-color .25s,background-color .25s}
.opt:hover{border-color:color-mix(in oklab,var(--signal) 55%,transparent);background:color-mix(in oklab,var(--signal) 8%,transparent)}
.opt em{flex:none;margin-top:.35rem;width:.6rem;height:.6rem;border-radius:50%;border:1px solid rgb(255 255 255/.35);transition:background-color .2s,border-color .2s}
.opt:hover em{background:var(--signal);border-color:var(--signal-400)}
.opt b{display:block;font-size:.94rem;font-weight:650}
.opt small{display:block;margin-top:.2rem;font-size:.8rem;color:var(--chalk-dim)}

/* 21st.dev #5625 Shader Animation — concentric ripple behind the finder */
.ripple{position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:.5}

/* ── Tabs (21st.dev #525 Animated Tabs) ─────────────────── */
.tabs{position:relative;display:flex;gap:.5rem;overflow-x:auto;padding-bottom:.3rem;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tabs .ind{position:absolute;left:0;top:0;z-index:0;border-radius:.75rem;opacity:0;pointer-events:none;
  background:color-mix(in oklab,var(--signal) 14%,transparent);border:1px solid color-mix(in oklab,var(--signal) 52%,transparent);
  box-shadow:0 8px 26px -14px color-mix(in oklab,var(--signal) 85%,transparent);
  transition:transform .5s var(--ease-route),width .5s var(--ease-route),height .5s var(--ease-route),opacity .3s}
.tab{position:relative;z-index:1;flex:none;min-height:3rem;padding:0 1.05rem;border-radius:.75rem;cursor:pointer;
  border:1px solid rgb(255 255 255/.12);background:none;font-size:.9rem;font-weight:650;color:var(--chalk-dim);
  transition:color .25s,border-color .25s}
.tab[aria-selected="true"]{color:var(--chalk);border-color:transparent}
.tab:hover{color:var(--chalk)}

/* ── Media ──────────────────────────────────────────────── */
.figure{position:relative;border:1px solid rgb(255 255 255/.12);border-radius:1rem;overflow:hidden}
.figure video,.figure img{width:100%;aspect-ratio:16/9;object-fit:cover}
.figure figcaption{position:absolute;right:.9rem;bottom:.6rem;font-size:.68rem;color:var(--chalk-faint);text-shadow:0 1px 3px rgb(0 0 0/.7)}
.day > .bgvid{display:none}
.bgvid{position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden;
  mask-image:linear-gradient(to bottom,transparent,#000 14%,#000 86%,transparent)}
.bgvid video,.bgvid img{width:100%;height:100%;object-fit:cover}
.day .figure{border-color:rgb(20 26 32/.14)}

/* Closing chapter — the daylight payoff. The arc has been climbing towards
   light all the way down the page; it ends on footage shot in daylight, not
   on another dark panel. The card carries 90% opacity so the copy keeps AA
   contrast even over the darkest frame the clip could ever show. */
.arrive{position:relative;overflow:hidden;isolation:isolate}
.day + .day.arrive{padding:clamp(6rem,11vw,9rem) 0 clamp(4rem,7vw,6rem)}
.arrive-film{position:absolute;inset:0;z-index:0;pointer-events:none}
.arrive-film video,.arrive-film img{width:100%;height:100%;object-fit:cover;transform:scale(1.04)}
.arrive-film::after{content:'';position:absolute;inset:0;background:linear-gradient(to bottom,
  var(--ink-950) 0,color-mix(in srgb,var(--ink-950) 20%,transparent) 20%,
  color-mix(in srgb,var(--ink-950) 20%,transparent) 78%,var(--ink-950) 100%)}
.arrive-body{position:relative;z-index:1}
.arrive-card{max-width:46rem;margin-inline:auto;padding:clamp(1.8rem,4vw,3rem);border-radius:1.4rem;
  background:color-mix(in srgb,var(--ink-950) 90%,transparent);backdrop-filter:blur(18px) saturate(1.08);
  border:1px solid rgb(20 26 32/.10);box-shadow:0 34px 80px -46px rgb(20 26 32/.55)}

/* 21st.dev #4559 View Magnifier */
.loupe{position:relative;cursor:zoom-in;overflow:hidden}
.loupe .lens{position:absolute;left:0;top:0;width:11rem;height:11rem;margin:-5.5rem 0 0 -5.5rem;border-radius:50%;
  pointer-events:none;opacity:0;background-repeat:no-repeat;border:1px solid rgb(255 255 255/.25);
  box-shadow:0 0 0 1px rgb(0 0 0/.5),0 18px 44px -12px rgb(0 0 0/.7);transition:opacity .28s}

/* ── Cockpit (21st.dev #1081 Container Scroll + #1913 mockup parallax) ── */
.cockpit{position:relative}
.cockpit-stage{position:sticky;top:calc(var(--header-h) + 1rem);height:calc(100svh - var(--header-h) - 2rem);
  display:grid;align-items:center;grid-template-columns:1fr;gap:2rem}
@media(min-width:1024px){.cockpit-stage{grid-template-columns:1fr minmax(0,22rem)}}
.phone{width:min(20rem,86vw);margin-inline:auto;border-radius:2.2rem;border:1px solid rgb(255 255 255/.16);
  background:#0b0a10;padding:.6rem;box-shadow:0 40px 90px -40px rgb(0 0 0/.9);
  transform-style:preserve-3d;will-change:transform}
.phone-screen{border-radius:1.7rem;overflow:hidden;background:#0b0a10;height:30rem;position:relative}
.phone-scroll{position:absolute;inset:0;will-change:transform}
.phone-notch{position:absolute;left:50%;top:.55rem;transform:translateX(-50%);width:5.2rem;height:1.1rem;border-radius:1rem;background:#000;z-index:2}
.appsec{padding:1.1rem 1.05rem;color:#f2eff5}
.applabel{font-size:.6rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#ff5d84}
.appcard{border:1px solid rgb(255 255 255/.1);border-radius:.85rem;padding:.85rem;margin-top:.6rem;background:rgb(255 255 255/.035)}
.appbar{height:.4rem;border-radius:1rem;background:rgb(255 255 255/.1);overflow:hidden;margin-top:.5rem}
.appbar i{display:block;height:100%;background:linear-gradient(90deg,#ff2e63,#ff5d84)}
.ring{width:5.2rem;height:5.2rem;border-radius:50%;display:grid;place-items:center;
  background:conic-gradient(#ff2e63 calc(var(--p)*1%),rgb(255 255 255/.08) 0)}
.ring i{width:4.1rem;height:4.1rem;border-radius:50%;background:#0b0a10;display:grid;place-items:center;
  font-family:var(--font-display);font-weight:800;font-size:1.15rem;font-style:normal}
.scenes{display:flex;gap:.4rem;justify-content:center;margin-top:1.2rem}
.scenes i{width:1.6rem;height:2px;border-radius:2px;background:rgb(255 255 255/.2);transition:background-color .3s,width .3s}
.scenes i[data-on]{width:2.6rem;background:var(--signal-400)}

/* ── Calculator ─────────────────────────────────────────── */
.calc{border:1px solid color-mix(in oklab,var(--chalk) 14%,transparent);border-radius:1rem;overflow:hidden}
.calc-head{padding:1.15rem 1.3rem;background:color-mix(in oklab,var(--ink-850) 60%,transparent);
  border-bottom:1px solid color-mix(in oklab,var(--chalk) 12%,transparent)}
.calc table{width:100%;border-collapse:collapse;font-size:.9rem}
.calc th,.calc td{padding:.75rem .8rem;text-align:right;vertical-align:middle}
.calc th:first-child,.calc td:first-child{text-align:left}
.calc thead th{font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--chalk-dim);font-weight:700}
.calc tbody tr{border-top:1px solid color-mix(in oklab,var(--chalk) 9%,transparent)}
.calc input{width:6.4rem;height:2.6rem;text-align:right;padding:0 .55rem;border-radius:.5rem;
  border:1px solid color-mix(in oklab,var(--chalk) 16%,transparent);
  background:color-mix(in oklab,var(--ink-950) 55%,transparent)}
.calc input.qty{width:4.2rem;text-align:center}
.calc tfoot td{font-weight:800;font-size:1.02rem;border-top:2px solid color-mix(in oklab,var(--signal) 55%,transparent)}
.verdict{margin-top:1.1rem;padding:1rem 1.2rem;border-radius:.8rem;border:1px solid color-mix(in oklab,var(--signal) 32%,transparent);
  background:color-mix(in oklab,var(--signal) 8%,transparent);font-size:.94rem}

/* ── Guide beam ─────────────────────────────────────────── */
.beam{position:relative;list-style:none;display:grid;gap:.55rem}
.beam .line{position:absolute;left:7px;top:1.5rem;bottom:1.5rem;width:1px;
  background:linear-gradient(to bottom,color-mix(in oklab,var(--signal) 45%,transparent),color-mix(in oklab,var(--chalk) 14%,transparent),transparent)}
.beam .fill{position:absolute;left:6px;top:1.5rem;bottom:1.5rem;width:3px;border-radius:2px;transform:scaleY(var(--b,0));transform-origin:top;
  background:linear-gradient(to bottom,color-mix(in oklab,var(--signal) 92%,transparent),var(--signal));
  box-shadow:0 0 14px color-mix(in oklab,var(--signal) 60%,transparent)}
.beam li{position:relative;padding-left:2.35rem}
.beam .dot{position:absolute;left:0;top:1.4rem;width:.9rem;height:.9rem;border-radius:50%;
  border:2px solid color-mix(in oklab,var(--signal) 55%,transparent);background:var(--ink-950);
  transition:background-color .45s,box-shadow .45s}
.beam .dot[data-lit]{background:var(--signal);box-shadow:0 0 16px color-mix(in oklab,var(--signal) 70%,transparent)}

/* ── Carousel (21st.dev #3052 Feature Carousel) ─────────── */
.carousel{position:relative;overflow:hidden;border-radius:1rem;border:1px solid rgb(255 255 255/.12)}
.carousel-track{display:flex;transition:transform .6s var(--ease-route)}
.carousel-track>*{flex:0 0 100%;padding:1.9rem}
.carousel-nav{display:flex;gap:.4rem;justify-content:center;padding:0 0 .6rem}
/* The bar stays 4px; the target around it is 24px, which is what a thumb
   actually hits. background-clip keeps the paint on the bar alone. */
.carousel-nav button{width:2.1rem;height:1.5rem;padding:.61rem 0;box-sizing:border-box;border:0;border-radius:2px;
  background:rgb(255 255 255/.2);background-clip:content-box;cursor:pointer;transition:background-color .3s}
.carousel-nav button[aria-current="true"]{background:var(--signal-400);background-clip:content-box}

/* ── Slider (21st.dev #2497 auto slider), carrying real class codes ── */
.slider{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.slider-row{display:flex;gap:.7rem;width:max-content;animation:slide 46s linear infinite}
.slider a{flex:none;display:flex;align-items:baseline;gap:.55rem;padding:.6rem 1rem;border-radius:.7rem;text-decoration:none;
  border:1px solid rgb(255 255 255/.12);background:color-mix(in oklab,var(--ink-850) 60%,transparent);transition:border-color .25s}
.slider a:hover{border-color:color-mix(in oklab,var(--signal) 60%,transparent)}
.slider b{font-family:var(--font-display);font-size:1rem}
.slider span{font-size:.74rem;color:var(--chalk-dim)}
@keyframes slide{to{transform:translateX(-50%)}}

/* 21st.dev #8341 Animated Profile Card — the two locations, tilting */
.tilt{transform-style:preserve-3d;transition:transform .5s var(--ease-route);will-change:transform}
.tilt>*{transform:translateZ(28px)}

/* ── Footer (21st.dev #8687 Hover Footer) ───────────────── */
.ftr{border-top:1px solid rgb(255 255 255/.1);background:var(--ink-900);padding:4rem 0 2.5rem;position:relative;z-index:1}
.ftr-grid{display:grid;gap:2rem}
@media(min-width:760px){.ftr-grid{grid-template-columns:1.3fr repeat(3,1fr)}}
.ftr-col{transition:opacity .4s,transform .5s var(--ease-route)}
@media(hover:hover){.ftr-grid:hover .ftr-col{opacity:.5}.ftr-grid .ftr-col:hover{opacity:1;transform:translateY(-4px)}}
.ftr h4{font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--chalk-faint);font-weight:800}
.ftr ul{list-style:none;margin-top:.9rem;display:grid;gap:.45rem}
.ftr a{text-decoration:none;font-size:.9rem;color:var(--chalk-dim);transition:color .2s}
.ftr a:hover{color:var(--chalk)}

/* ── Sign-in flow (21st.dev #2049) — docked to the cockpit ── */
.signin{position:relative;overflow:hidden;border-radius:1rem;border:1px solid rgb(255 255 255/.13);padding:1.8rem;
  background:color-mix(in oklab,var(--ink-850) 74%,transparent)}
.signin canvas{position:absolute;inset:0;z-index:-1;opacity:.55}
.field{display:block;margin-top:.85rem}
.field span{display:block;font-size:.78rem;font-weight:650;color:var(--chalk-dim);margin-bottom:.35rem}
.field input{width:100%;height:2.9rem;padding:0 .8rem;border-radius:.6rem;
  border:1px solid rgb(255 255 255/.15);background:rgb(255 255 255/.04)}

/* ── Misc ───────────────────────────────────────────────── */
.note{display:flex;gap:.7rem;margin-top:1.5rem;padding:.95rem 1.1rem;border-radius:.8rem;font-size:.82rem;line-height:1.55;
  color:var(--chalk-dim);border:1px solid color-mix(in oklab,var(--chalk) 12%,transparent);
  background:color-mix(in oklab,var(--chalk) 3%,transparent)}
.badge{display:inline-block;padding:.22rem .55rem;border-radius:.35rem;font-size:.66rem;font-weight:800;
  letter-spacing:.08em;text-transform:uppercase;border:1px solid color-mix(in oklab,var(--amber) 45%,transparent);color:var(--amber)}
.crumbs{display:flex;flex-wrap:wrap;gap:.5rem;font-size:.76rem;color:var(--chalk-faint);list-style:none}
.crumbs a{text-decoration:none}
.crumbs a:hover{color:var(--chalk-soft)}
.atmo-lanes{position:absolute;inset:0;pointer-events:none;opacity:.45;
  background-image:repeating-linear-gradient(90deg,transparent 0,transparent 5.4rem,rgb(255 255 255/.04) 5.4rem,rgb(255 255 255/.04) 5.5rem);
  -webkit-mask-image:linear-gradient(to bottom,transparent,#000 18%,#000 82%,transparent);
  mask-image:linear-gradient(to bottom,transparent,#000 18%,#000 82%,transparent)}
.pagehead{position:relative;padding:calc(var(--header-h) + 3.5rem) 0 3.5rem;overflow:hidden}
.h-page{font-size:clamp(2.2rem,5.4vw,4rem);margin-top:1.2rem;max-width:18ch}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
  .haze,.slider-row{animation:none!important}
  .outlier[data-o] i,.rv[data-rv],[data-rw] .word>i{opacity:1!important;transform:none!important}
  .cursor,.cursor-dot{display:none!important}
}
`
