/**
 * Renders the mock exchange screenshots of the OCR tests (`npm run`-free, run by hand):
 *
 *   node tests/fixtures/ocr/generate.mjs
 *
 * Every picture is built from HTML with a seeded data set, so the PNG and its `*.truth.json` (what is printed in it) are
 * reproducible. They imitate the PATTERNS of exchange histories (dark / light theme, a table and 390 px phone cards, red
 * and green numbers, gray labels, chevrons, a status bar) – they are NOT screenshots of a real app; the one real
 * screenshot is `bitunix-positionshistorie-1.jpg`. The point of the mocks: ≥ 8 rows with known values, so the hit rate
 * of the reader can be measured per field.
 */
import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** Small seeded PRNG (mulberry32): the same pictures every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MARKETS = [
  { symbol: "BTCUSDT", base: "BTC", price: 81200, dec: 1, qty: [0.008, 0.045], qd: 4 },
  { symbol: "ETHUSDT", base: "ETH", price: 3412.5, dec: 2, qty: [0.2, 1.4], qd: 3 },
  { symbol: "SOLUSDT", base: "SOL", price: 168.4, dec: 2, qty: [3, 22], qd: 1 },
  { symbol: "XRPUSDT", base: "XRP", price: 0.5312, dec: 4, qty: [300, 2400], qd: 0 },
];

const p2 = (n) => String(n).padStart(2, "0");
const wall = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
};
const group = (n, dec) => {
  const [i, f] = n.toFixed(dec).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
};

/** n closed positions: side, prices, quantity, net result (fees ≈ 0.12 % of the notional taken off), times. */
function positions(seed, n) {
  const r = rng(seed);
  const out = [];
  let t = Date.UTC(2026, 9, 24, 15, 40, 0);
  for (let i = 0; i < n; i++) {
    const m = MARKETS[Math.floor(r() * MARKETS.length)];
    const side = r() < 0.55 ? "long" : "short";
    const lev = [3, 5, 8, 10, 13, 15, 20][Math.floor(r() * 7)];
    const entry = Number((m.price * (0.985 + r() * 0.03)).toFixed(m.dec));
    const move = (r() - 0.55) * 0.012;
    const exit = Number((entry * (1 + (side === "long" ? move : -move))).toFixed(m.dec));
    const qty = Number((m.qty[0] + r() * (m.qty[1] - m.qty[0])).toFixed(m.qd));
    const gross = (exit - entry) * qty * (side === "long" ? 1 : -1);
    const fees = entry * qty * (0.0011 + r() * 0.0003);
    const pnl = Number((gross - fees).toFixed(8));
    const closed = t - Math.floor(r() * 40) * 60_000 - Math.floor(r() * 60) * 1000;
    const opened = closed - (20 + Math.floor(r() * 2600)) * 60_000 - Math.floor(r() * 60) * 1000;
    t = opened - (5 + Math.floor(r() * 300)) * 60_000;
    const roi = (pnl / ((entry * qty) / lev)) * 100;
    out.push({ ...m, side, lev, entry, exit, qty, pnl, roi: Number(roi.toFixed(2)), opened: wall(opened), closed: wall(closed), fees });
  }
  return out;
}

const truthOf = (list) =>
  list.map((p) => ({ pair: `${p.base}/USDT`, side: p.side, qty: p.qty, entry: p.entry, exit: p.exit, pnl: p.pnl, leverage: p.lev, openTime: p.opened, closeTime: p.closed }));

const fmtPnl = (v) => v.toFixed(8);
const col = (v) => (v < 0 ? "neg" : "pos");

const BASE_CSS = (dark) => `
  *{box-sizing:border-box;margin:0}
  body{font-family:"Helvetica Neue",Arial,"Liberation Sans",sans-serif;${dark ? "background:#0b0b0d;color:#f2f2f2" : "background:#ffffff;color:#16181d"}}
  .gray{color:${dark ? "#8a8a90" : "#6b7280"}}
  .pos{color:${dark ? "#3fa56e" : "#0e9f6e"}} .neg{color:${dark ? "#e76070" : "#d6313f"}}
`;

/* ------------------------------------------------------------------ 1: desktop table, dark, English */
function tableDarkEn(list) {
  const rows = list
    .map(
      (p) => `<tr>
  <td class="sym">${p.symbol}</td>
  <td class="${p.side === "long" ? "pos" : "neg"}">${p.side === "long" ? "Long" : "Short"}</td>
  <td>${p.lev}x</td>
  <td class="num">${group(p.entry, p.dec)}</td>
  <td class="num">${group(p.exit, p.dec)}</td>
  <td class="num">${p.qty}</td>
  <td class="num ${col(p.pnl)}">${fmtPnl(p.pnl)}</td>
  <td class="date">${p.opened}</td>
  <td class="date">${p.closed}</td></tr>`,
    )
    .join("\n");
  return `<style>${BASE_CSS(true)}
  body{width:1180px;padding:18px 24px;font-size:13px}
  .tabs{display:flex;gap:28px;font-size:15px;margin-bottom:14px;border-bottom:1px solid #26262b;padding-bottom:10px}
  .tabs .active{color:#fff;border-bottom:2px solid #fff;padding-bottom:9px;margin-bottom:-11px}.tabs span{color:#8a8a90}.tabs .active{color:#fff}
  table{width:100%;border-collapse:collapse}
  th{font-weight:400;color:#8a8a90;text-align:left;padding:10px 8px;border-bottom:1px solid #26262b;font-size:12.5px}
  td{padding:12px 8px;border-bottom:1px solid #18181c}
  .num{text-align:left;font-variant-numeric:tabular-nums}
  </style>
  <div class="tabs"><span>Order History</span><span class="active">Position History</span><span>Trade History</span></div>
  <table><thead><tr><th>Symbol</th><th>Side</th><th>Leverage</th><th>Entry Price</th><th>Exit Price</th><th>Closed Qty</th><th>Realized PnL</th><th>Open Time</th><th>Close Time</th></tr></thead>
  <tbody>${rows}</tbody></table>`;
}

/* ------------------------------------------------------------------ 2: phone cards, dark, German (Bitunix-like) */
function cardsDarkDe(list) {
  const cards = list
    .map(
      (p) => `<section>
  <div class="head"><b>${p.symbol}</b><span class="gray">▯▯ &nbsp;|&nbsp; Geschlossen &rsaquo;</span></div>
  <div class="tags"><span class="${p.side === "long" ? "pos" : "neg"}">${p.side === "long" ? "Long" : "Short"}</span><i></i><span>Isoliert</span><i></i><span>${p.lev}X</span></div>
  <div class="row"><span class="gray u">Position PnL (Gewinn und Verlust)</span><span class="${col(p.pnl)}">${fmtPnl(p.pnl)} &rsaquo;</span></div>
  <div class="row"><span class="gray">ROI</span><span class="${col(p.pnl)}">${p.roi.toFixed(2)} %</span></div>
  <div class="row"><span class="gray">Einstiegspreis</span><span>${group(p.entry, p.dec)} &rsaquo;</span></div>
  <div class="row"><span class="gray">Schlusspreis (USDT)</span><span>${group(p.exit, p.dec)}</span></div>
  <div class="row"><span class="gray">Maximal gehalten (${p.base})</span><span>${p.qty} &rsaquo;</span></div>
  <div class="row"><span class="gray">Geschlossene Menge (${p.base})</span><span>${p.qty}</span></div>
  <div class="row"><span class="gray">Zeit geöffnet</span><span>${p.opened}</span></div>
  <div class="row"><span class="gray">Zeit geschlossen</span><span>${p.closed}</span></div>
</section>`,
    )
    .join("\n");
  return `<style>${BASE_CSS(true)}
  body{width:390px;font-size:14px;padding-top:6px}
  .bar{display:flex;justify-content:space-between;padding:8px 16px;font-size:13px}
  h1{font-size:17px;font-weight:600;text-align:center;padding:12px 0}
  .tabs{display:flex;justify-content:space-around;font-size:15px;color:#8a8a90;border-bottom:1px solid #1d1d21;padding:8px 0 10px}.tabs .active{color:#fff;border-bottom:2px solid #fff;padding-bottom:9px;margin-bottom:-11px}
  .chips{display:flex;gap:10px;padding:14px 16px 8px}.chips span{background:#1a1a1e;border-radius:10px;padding:7px 12px;font-size:14px}
  section{padding:14px 16px 8px;border-bottom:8px solid #0f0f12}
  .head{display:flex;justify-content:space-between;font-size:17px;margin-bottom:6px}.head .gray{font-size:14px}
  .tags{display:flex;align-items:center;gap:10px;font-size:13px;margin-bottom:12px}.tags i{width:1px;height:12px;background:#3a3a40}
  .row{display:flex;justify-content:space-between;padding:7px 0;font-size:14px}.u{text-decoration:underline dashed #55555b}
  </style>
  <div class="bar"><b>22:44</b><span>▾ ▮▮▮ 50</span></div><h1>Vertragsaufträge</h1>
  <div class="tabs"><span>Auftragshistorie</span><span class="active">Positionshistorie</span><span>Tradehistorie</span></div>
  <div class="chips"><span>Alle ▾</span><span>Alle Statusse ▾</span><span>Letzte 30 Tage ▾</span></div>
  ${cards}`;
}

/* ------------------------------------------------------------------ 3: desktop order table, light, English */
function orders(list) {
  // each position becomes an opening and a closing order
  const out = [];
  for (const p of list) {
    const openLabel = p.side === "long" ? "Open Long" : "Open Short";
    const closeLabel = p.side === "long" ? "Close Long" : "Close Short";
    const feeOpen = Number((p.entry * p.qty * 0.0006).toFixed(8));
    const feeClose = Number((p.exit * p.qty * 0.0006).toFixed(8));
    const gross = (p.exit - p.entry) * p.qty * (p.side === "long" ? 1 : -1);
    const pnl = Number((gross - feeOpen - feeClose).toFixed(8));
    out.push({ ...p, label: openLabel, kind: "open", price: p.entry, fee: feeOpen, rpnl: null, at: p.opened });
    out.push({ ...p, label: closeLabel, kind: "close", price: p.exit, fee: feeClose, rpnl: pnl, at: p.closed });
  }
  return out;
}

function tableLightOrders(list) {
  const rows = orders(list)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .map(
      (o) => `<tr>
  <td class="date">${o.at}</td>
  <td class="sym">${o.symbol}</td>
  <td class="${o.label.endsWith("Long") ? "pos" : "neg"}">${o.label}</td>
  <td class="num">${group(o.price, o.dec)}</td>
  <td class="num">${o.qty}</td>
  <td class="num">${o.fee.toFixed(8)}</td>
  <td class="num ${o.rpnl == null ? "" : col(o.rpnl)}">${o.rpnl == null ? "--" : fmtPnl(o.rpnl)}</td></tr>`,
    )
    .join("\n");
  return `<style>${BASE_CSS(false)}
  body{width:1100px;padding:18px 24px;font-size:13.5px}
  h2{font-size:17px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse}
  th{font-weight:500;color:#6b7280;text-align:left;padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;background:#f8fafc}
  td{padding:11px 8px;border-bottom:1px solid #f1f5f9}
  </style><h2>Trade History</h2>
  <table><thead><tr><th>Time</th><th>Symbol</th><th>Direction</th><th>Price</th><th>Qty</th><th>Fee</th><th>Realized PnL</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The truth of the order table: the pairs that were generated (one trade per position, fees = both orders'). */
function truthOfOrders(list) {
  return orders(list)
    .filter((o) => o.kind === "close")
    .map((o) => ({ pair: `${o.base}/USDT`, side: o.side, qty: o.qty, entry: o.entry, exit: o.exit, pnl: o.rpnl, leverage: null, openTime: o.opened, closeTime: o.closed }));
}

/* ------------------------------------------------------------------ 4: phone order cards, dark, German (Bitunix-like) */
function orderCardsDarkDe(list) {
  const cards = orders(list)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .map(
      (o) => `<section>
  <div class="head"><b>${o.symbol}</b><span class="gray">${o.at}</span></div>
  <div class="tags"><span class="${o.label.endsWith("Long") ? "pos" : "neg"}">${o.label.replace("Open Long", "Long öffnen").replace("Open Short", "Short öffnen").replace("Close Long", "Long schließen").replace("Close Short", "Short schließen")}</span><i></i><span>Isoliert</span><i></i><span>${o.lev}X</span></div>
  <div class="row"><span class="gray">Realisierter PnL</span><span class="${o.rpnl == null ? "" : col(o.rpnl)}">${o.rpnl == null ? "--" : fmtPnl(o.rpnl)}</span></div>
  <div class="row"><span class="gray">Durchschnittspreis</span><span>${group(o.price, o.dec)}</span></div>
  <div class="row"><span class="gray">Auftragspreis</span><span>Markt</span></div>
  <div class="row"><span class="gray">Auftragsmenge</span><span>${o.qty}</span></div>
  <div class="row"><span class="gray">Ausgeführt</span><span>${o.qty}</span></div>
  <div class="row"><span class="gray">Gebühr</span><span>${o.fee.toFixed(8)}</span></div>
</section>`,
    )
    .join("\n");
  return `<style>${BASE_CSS(true)}
  body{width:390px;font-size:14px;padding-top:6px}
  .bar{display:flex;justify-content:space-between;padding:8px 16px;font-size:13px}
  h1{font-size:17px;font-weight:600;text-align:center;padding:12px 0}
  .tabs{display:flex;justify-content:space-around;font-size:15px;color:#8a8a90;border-bottom:1px solid #1d1d21;padding:8px 0 10px}.tabs .active{color:#fff;border-bottom:2px solid #fff;padding-bottom:9px;margin-bottom:-11px}
  section{padding:14px 16px 8px;border-bottom:8px solid #0f0f12}
  .head{display:flex;justify-content:space-between;font-size:17px;margin-bottom:6px}.head .gray{font-size:13px}
  .tags{display:flex;align-items:center;gap:10px;font-size:13px;margin-bottom:12px}.tags i{width:1px;height:12px;background:#3a3a40}
  .row{display:flex;justify-content:space-between;padding:7px 0;font-size:14px}
  </style>
  <div class="bar"><b>09:12</b><span>▾ ▮▮▮ 71</span></div><h1>Vertragsaufträge</h1>
  <div class="tabs"><span class="active">Auftragshistorie</span><span>Positionshistorie</span><span>Tradehistorie</span></div>
  ${cards}`;
}

const JOBS = [
  { name: "table-dark-en", html: tableDarkEn, data: () => positions(11, 10), truth: truthOf, dpr: 1, width: 1230 },
  { name: "cards-dark-de-390", html: cardsDarkDe, data: () => positions(23, 8), truth: truthOf, dpr: 1.5, width: 390, jpeg: true },
  { name: "orders-light-en", html: tableLightOrders, data: () => positions(37, 5), truth: truthOfOrders, dpr: 1, width: 1150 },
  { name: "ordercards-dark-de-390", html: orderCardsDarkDe, data: () => positions(41, 4), truth: truthOfOrders, dpr: 1.5, width: 390, jpeg: true },
];

const executablePath = existsSync(CHROMIUM) ? CHROMIUM : undefined;
const browser = await chromium.launch({ executablePath });
for (const j of JOBS) {
  const data = j.data();
  const page = await browser.newPage({ viewport: { width: j.width, height: 800 }, deviceScaleFactor: j.dpr });
  await page.setContent(`<!doctype html><meta charset="utf-8">${j.html(data)}`);
  // phone screenshots are JPEG like the real ones (and a tall dark PNG is large)
  await page.screenshot({ path: join(here, j.jpeg ? `${j.name}.jpg` : `${j.name}.png`), fullPage: true, ...(j.jpeg ? { type: "jpeg", quality: 72 } : { type: "png" }) });
  writeFileSync(join(here, `${j.name}.truth.json`), `${JSON.stringify({ trades: j.truth(data) }, null, 2)}\n`);
  await page.close();
  console.log("written", j.name, data.length);
}
await browser.close();
