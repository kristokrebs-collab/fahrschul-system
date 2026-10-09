import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { Autocomplete } from "@/motion/pulse/Autocomplete";
import { Marquee } from "@/motion/pulse/Marquee";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { NotchedFrame } from "@/motion/pulse/NotchedFrame";
import { StripWipe } from "@/motion/pulse/StripWipe";
import { WidgetGrid } from "@/motion/pulse/WidgetGrid";

/*
 * Dev gallery of the A2 pulse UI primitives (120 Hz checks + visual review). `?c=select|autocomplete|notch|grid|wipe|marquee`
 * shows one section only (isolated check120 runs), `&bare` removes the app backdrop.
 */
const params = new URLSearchParams(location.search);
const only = params.get("c");
// `?bare`: drop the app backdrop (full-viewport noise film + gradients) so check120 measures the component alone
if (params.has("bare")) {
  const st = document.createElement("style");
  st.textContent = "body{background-image:none!important}body::before{display:none!important}";
  document.head.appendChild(st);
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D", "3D", "1W"];
const SETUPS = [
  { id: "bsl", name: "BSL/EQL Liquidity Sweep", color: "#6f9dc9", n: 6 },
  { id: "fvg", name: "FVG Retest", color: "#c9975b", n: 4 },
  { id: "ob", name: "Order Block Reclaim", color: "#8c83cf", n: 2 },
  { id: "rng", name: "Range Deviation", color: "#46a6a0", n: 1 },
];
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "LTCUSDT"];
const SEARCH = [
  ...SETUPS.map((s) => ({ value: `setup:${s.id}`, label: s.name, group: "Grundlagen" })),
  { value: "emo:ruhig", label: "Ruhig", group: "Emotionen" },
  { value: "emo:gierig", label: "Gierig", group: "Emotionen" },
  { value: "emo:ängstlich", label: "Ängstlich", group: "Emotionen" },
  { value: "side:long", label: "Long", group: "Richtung" },
  { value: "side:short", label: "Short", group: "Richtung" },
  { value: "note:asia", label: "Asia-Hoch gesweept, Reclaim abgewartet", group: "Notizen" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  if (only && only !== id) return null;
  return (
    <section data-section={id} className="grid gap-4 rounded-2xl border border-line bg-ink-900 p-5">
      <h2 className="label">{title}</h2>
      {children}
    </section>
  );
}

function SelectDemo() {
  const [tf, setTf] = useState("15m");
  const [setup, setSetup] = useState("all");
  const [cur, setCur] = useState("USDT");
  return (
    <div className="grid gap-6">
      {/* clipping + scrolling container: the panel must escape it */}
      <div className="grid max-h-[150px] grid-cols-2 gap-3 overflow-hidden rounded-xl border border-line p-3">
        <div className="grid min-w-0 content-start gap-1.5">
          <label htmlFor="f-pair" className="label">
            Paar
          </label>
          <input id="f-pair" className="w-full rounded-xl border border-line bg-ink-950/70 px-3 py-2 text-[13.5px] text-fg" defaultValue="BTCUSDT" />
        </div>
        <div className="grid min-w-0 content-start gap-1.5">
          <label htmlFor="f-tf" className="label">
            Timeframe
          </label>
          <MorphSelect id="f-tf" value={tf} onChange={setTf} options={[{ value: "", label: "–" }, ...TIMEFRAMES.map((t) => ({ value: t, label: t }))]} />
        </div>
        <p className="col-span-2 text-[12px] text-faint">Unter dem Feld liegt weiterer Inhalt (Status, Grundlagen …).</p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <MorphSelect
          aria-label="Entscheidungsgrundlage"
          data-testid="setup-select"
          className="w-auto min-w-[190px]"
          value={setup}
          onChange={setSetup}
          options={[{ value: "all", label: "Alle Grundlagen" }, ...SETUPS.map((s) => ({ value: s.id, label: s.name, hint: String(s.n) })), { value: "none", label: "Ohne Grundlage" }]}
        />
        <span className="text-[12px] text-faint">gewählt: {setup}</span>
      </div>
      <div className="grid max-w-[260px] gap-1.5">
        <label htmlFor="s-currency" className="label">
          Währung
        </label>
        <MorphSelect id="s-currency" heading="Währung" value={cur} onChange={setCur} options={["USDT", "USD", "EUR"].map((c) => ({ value: c, label: c }))} />
      </div>
    </div>
  );
}

function AutocompleteDemo() {
  const [q, setQ] = useState("");
  const [sym, setSym] = useState("BTCUSDT");
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <label className="relative grid min-w-[200px] sm:max-w-[280px]">
        <svg className="pointer-events-none absolute left-3 top-1/2 z-[1] size-3.5 -translate-y-1/2 text-faint" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <Autocomplete type="search" inputClassName="pl-9" placeholder="Notizen, Begründung …" value={q} onChange={setQ} aria-label="Trades durchsuchen" suggestions={SEARCH} />
      </label>
      <div className="grid gap-1.5">
        <label htmlFor="s-pair" className="label">
          Symbol
        </label>
        <Autocomplete id="s-pair" value={sym} onChange={setSym} suggestions={SYMBOLS} inputClassName="font-mono" />
      </div>
    </div>
  );
}

function NotchDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {SETUPS.slice(0, 3).map((s, i) => (
        <NotchedFrame
          key={s.id}
          outline="var(--color-line-2)"
          className="grid gap-3 bg-ink-850 p-4 pb-16"
          media={<div className="h-20 rounded-xl" style={{ background: `linear-gradient(135deg, ${s.color}, #111 80%)` }} />}
          mediaClassName="overflow-hidden rounded-xl"
        >
          <a href={`#setup-${s.id}`} data-testid={`notch-${i}`} className="text-[15px] font-medium text-fg outline-none after:absolute after:inset-0">
            {s.name}
          </a>
          <p className="text-[12.5px] text-mute">{s.n} Trades · Win-Rate 58 %</p>
        </NotchedFrame>
      ))}
    </div>
  );
}

function GridDemo() {
  const [order, setOrder] = useState(["funding", "oi", "taker", "spread"]);
  const tile = (k: string, v: string) => (
    <div className="grid h-24 content-between rounded-2xl border border-line-2 bg-ink-850 p-3.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">{k}</span>
      <span className="font-mono text-[18px] text-fg">{v}</span>
    </div>
  );
  return (
    <WidgetGrid
      aria-label="Markt-Kacheln"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      order={order}
      onOrderChange={setOrder}
      items={[
        { id: "funding", label: "Funding", node: tile("Funding", "0.0100 %") },
        { id: "oi", label: "Open Interest", node: tile("Open Interest", "8.12 Mrd") },
        { id: "taker", label: "Taker", node: tile("Taker Buy", "52.4 %") },
        { id: "spread", label: "Bid/Ask", node: tile("Bid / Ask", "0.10") },
      ]}
    />
  );
}

function drawChart(c: HTMLCanvasElement, seed: number) {
  const w = c.clientWidth;
  const h = c.clientHeight;
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = "#0a0a0a";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#1c1c1c";
  for (let y = 20; y < h; y += 40) g.strokeRect(0, y, w, 0);
  let p = h / 2;
  const n = 60;
  for (let i = 0; i < n; i++) {
    const r = Math.sin(i * 0.7 + seed * 1.9) * 0.6 + Math.cos(i * 0.23 + seed) * 0.4;
    const o = p;
    p = Math.max(20, Math.min(h - 20, p - r * 14));
    const x = (i + 0.5) * (w / n);
    g.strokeStyle = p < o ? "#3ddc84" : "#ff4d4f";
    g.beginPath();
    g.moveTo(x, Math.min(o, p) - 6);
    g.lineTo(x, Math.max(o, p) + 6);
    g.stroke();
    g.fillStyle = g.strokeStyle;
    g.fillRect(x - 2.5, Math.min(o, p), 5, Math.max(1, Math.abs(p - o)));
  }
  g.fillStyle = "#9b9b9b";
  g.font = "11px monospace";
  g.fillText(["1m", "15m", "1h", "4h"][seed % 4] ?? "", 10, 16);
}

function WipeDemo() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [n, setN] = useState(0);
  const [snap, setSnap] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (canvas.current) drawChart(canvas.current, n);
  }, [n]);
  const next = () => {
    const c = canvas.current;
    if (!c) return;
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    copy.getContext("2d")?.drawImage(c, 0, 0);
    setSnap(copy);
    setN((v) => v + 1);
  };
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <button type="button" data-testid="wipe-next" onClick={next} className="rounded-xl border border-line-2 px-3 py-1.5 text-[13px] text-fg">
          Intervall wechseln
        </button>
      </div>
      <div className="relative h-[280px] overflow-hidden rounded-xl border border-line">
        <canvas ref={canvas} className="absolute inset-0 size-full" />
        <StripWipe trigger={n} from={snap} />
      </div>
    </div>
  );
}

function MarqueeDemo() {
  const stats = ["13 Trades", "Win-Rate 61 %", "Profit-Faktor 2.4", "Ø R 1.8", "Netto +4.210 USDT", "BTCUSDT 86.100"];
  return (
    <Marquee aria-label="Journal-Statistik" className="-rotate-[1.8deg] border-y border-line bg-ink-850 py-4">
      {stats.map((s, i) => (
        <span key={s} className="flex items-center font-mono text-[13px] uppercase tracking-[0.3em] text-mute">
          {i > 0 && <span className="px-6 text-signal">✦</span>}
          {s}
        </span>
      ))}
    </Marquee>
  );
}

function Gallery() {
  return (
    <main className="mx-auto grid max-w-[1100px] gap-6 px-4 py-8 text-fg">
      <h1 className="font-dot text-[28px]">pulse · UI</h1>
      <Section id="select" title="MorphSelect">
        <SelectDemo />
      </Section>
      <Section id="autocomplete" title="Autocomplete">
        <AutocompleteDemo />
      </Section>
      <Section id="notch" title="NotchedFrame">
        <NotchDemo />
      </Section>
      <Section id="grid" title="WidgetGrid">
        <GridDemo />
      </Section>
      <Section id="wipe" title="StripWipe">
        <WipeDemo />
      </Section>
      <Section id="marquee" title="Marquee">
        <MarqueeDemo />
      </Section>
      <div className="h-[40vh]" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
