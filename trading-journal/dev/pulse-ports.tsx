/**
 * Demos of the P01 pulse ports (ScrubTimeline, MilestoneRail, MagnifyRow, FullscreenWipe, GlyphZoom, ReelWindow,
 * CardSpread, OrbitSpread, LaunchGrid) for the dev gallery `dev/pulse-ui.html` (`?c=<id>&bare`). Sample data only –
 * dev harness, never part of the app bundle.
 */
import { useMotionValue, useTransform, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { FullscreenWipe, WipeItem } from "@/motion/pulse/FullscreenWipe";
import { GlyphZoom } from "@/motion/pulse/GlyphZoom";
import { LaunchGrid, LaunchSlot } from "@/motion/pulse/LaunchGrid";
import { MagnifyRow } from "@/motion/pulse/MagnifyRow";
import { MilestoneRail, type Milestone } from "@/motion/pulse/MilestoneRail";
import { OrbitSpread } from "@/motion/pulse/OrbitSpread";
import { ReelWindow } from "@/motion/pulse/ReelWindow";
import { ScrubTimeline, type ScrubSpan } from "@/motion/pulse/ScrubTimeline";

export function DemoBtn({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} className="rounded-full border border-line-2 px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] text-mute transition-colors hover:text-fg">
      {children}
    </button>
  );
}

/** A small deterministic chart thumbnail (sample art for reels / cards). */
function Thumb({ seed, tone = "#3ddc84", label, fill = false }: { seed: number; tone?: string; label?: string; fill?: boolean }) {
  const pts = Array.from({ length: 14 }, (_, i) => {
    const y = 60 - Math.sin(i * 0.9 + seed) * 16 - Math.cos(i * 0.37 + seed * 2) * 10 - i * 1.6;
    return `${(i / 13) * 160},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className={`relative grid w-full place-items-stretch bg-ink-900 ${fill ? "h-full" : "aspect-[16/10]"}`}>
      <svg viewBox="0 0 160 90" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <linearGradient id={`thumb-${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={tone} stopOpacity="0.25" />
            <stop offset="1" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={`0,90 ${pts} 160,90`} fill={`url(#thumb-${seed})`} stroke="none" />
        <polyline points={pts} fill="none" stroke={tone} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      {label && <span className="absolute left-2 top-1.5 font-mono text-[9px] tracking-[0.1em] text-mute">{label}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ ScrubTimeline */

const SESSION: ScrubSpan[] = [
  { id: "asia", label: "Asia-Range", start: 0, duration: 150, tone: "mute", meta: "Range 1,2 %" },
  { id: "sweep", label: "London-Sweep", start: 150, duration: 25, tone: "signal", meta: "Hoch genommen" },
  { id: "entry", label: "Einstieg Long", start: 172, duration: 6, tone: "win", meta: "86.120" },
  { id: "tp1", label: "Teilgewinn", start: 178, duration: 70, tone: "win", meta: "+1,0 R" },
  { id: "be", label: "Stop auf BE", start: 248, duration: 4, tone: "fg", meta: "risikofrei" },
  { id: "tp2", label: "Ziel 2", start: 252, duration: 118, tone: "win", meta: "+2,1 R" },
  { id: "ny", label: "NY-Volatilität", start: 330, duration: 90, tone: "warn" },
];
const hhmm = (m: number) => {
  const t = Math.round(m) + 60;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function ScrubDemo() {
  const time = useMotionValue(172);
  const r = useTransform(time, (t) => {
    const p = Math.min(1, Math.max(0, (t - 172) / (370 - 172)));
    return `${(p * 2.1).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} R`;
  });
  return (
    <div className="grid gap-3">
      <ScrubTimeline label="Session-Replay" title="Session-Replay · BTCUSDT" total={420} spans={SESSION} time={time} markers={[{ at: 172, label: "Einstieg", tone: "win" }]} formatTime={hhmm} playSeconds={8} speeds={[1, 2, 4]} />
      <p className="text-[12.5px] text-mute">
        Live-Wert aus derselben Zeit (MotionValue, null Renders): <motion.span className="dot-num text-[15px] text-win">{r}</motion.span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ MilestoneRail */

const GOALS: Milestone[] = [
  { id: "a", date: "Woche 1", title: "Regeln aufgeschrieben", text: "5 Einstiegsregeln, 2 Ausstiegsregeln." },
  { id: "b", date: "Woche 2", title: "20 Trades im Journal", text: "Jeder Trade mit Screenshot und Grund." },
  { id: "c", date: "Woche 3", title: "Nur A+-Setups", text: "Alles unter Note B wird ausgelassen." },
  { id: "d", date: "Woche 4", title: "Profit-Faktor über 1,8", text: "Gemessen über die letzten 30 Trades." },
  { id: "e", date: "Woche 6", title: "Risiko auf 1 % senken", text: "Größe nach Volatilität." },
];

export function MilestoneDemo() {
  const [active, setActive] = useState(2);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2">
        <DemoBtn testId="milestone-next" onClick={() => setActive((a) => (a + 1) % GOALS.length)}>
          Nächster Meilenstein
        </DemoBtn>
      </div>
      <div className="grid gap-8 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <MilestoneRail key={`v${active}`} items={GOALS} active={active} label="Plan für die nächsten Wochen" />
        <MilestoneRail key={`h${active}`} items={GOALS} active={active} orientation="horizontal" label="Plan horizontal" />
      </div>
    </div>
  );
}

export function PinnedDemo() {
  return (
    <div className="grid">
      <p className="text-[12.5px] text-mute">Scrollen: der Abschnitt pinnt, die Spur gleitet seitwärts.</p>
      <MilestoneRail items={[...GOALS, { id: "f", date: "Woche 8", title: "Konto verdoppelt", text: "Nur mit den besten Setups." }]} active={3} orientation="horizontal" pinned label="Roadmap" />
    </div>
  );
}

/* ------------------------------------------------------------------ MagnifyRow */

const glyph = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
export function MagnifyDemo() {
  const [sel, setSel] = useState("alle");
  const items = [
    { id: "alle", label: "Alle Gruppen", d: "M4 6h16M4 12h16M4 18h16" },
    { id: "scalp", label: "Scalper", d: "M13 2 4 14h7l-1 8 9-12h-7z" },
    { id: "swing", label: "Swing", d: "M3 17c4-8 7-8 9-4s5 4 9-4" },
    { id: "krypto", label: "Krypto", d: "M8 4v16M12 4v16M6 8h9a3 3 0 0 1 0 6H6m0 0h10a3 3 0 0 1 0 6H6" },
    { id: "mentor", label: "Mentoren", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0" },
    { id: "ranking", label: "Rangliste", d: "M6 20V10M12 20V4M18 20v-7" },
  ];
  return (
    <div className="grid justify-items-start gap-4 pt-8">
      <MagnifyRow label="Gruppen" items={items.map((i) => ({ id: i.id, label: i.label, icon: glyph(i.d), active: sel === i.id, onSelect: () => setSel(i.id) }))} />
      <p className="text-[12.5px] text-mute">
        Gewählt: <span className="text-fg">{items.find((i) => i.id === sel)?.label}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ FullscreenWipe */

export function WipeFsDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid justify-items-start gap-3">
      <DemoBtn testId="fswipe-open" onClick={() => setOpen(true)}>
        Bericht bereit zeigen
      </DemoBtn>
      <FullscreenWipe open={open} onClose={() => setOpen(false)} label="Wochenbericht bereit" autoCloseMs={6000}>
        <div className="mx-auto grid min-h-full max-w-[880px] content-center gap-8 px-6 py-20">
          <WipeItem index={0}>
            <span className="label">Wochenbericht · KW 41</span>
          </WipeItem>
          <WipeItem index={1}>
            <h2 className="text-[clamp(40px,8vw,84px)] font-medium leading-[0.95] tracking-[-0.04em] text-fg">Bericht bereit.</h2>
          </WipeItem>
          <WipeItem index={2} className="grid grid-cols-3 gap-4">
            {[
              ["Netto", "+2.140 USDT", "text-win"],
              ["Trefferquote", "64 %", "text-fg"],
              ["Bestes Setup", "Sweep", "text-fg"],
            ].map(([k, v, c]) => (
              <div key={k} className="grid gap-1 border-t border-white/15 pt-3">
                <span className="label">{k}</span>
                <span className={`dot-num text-[clamp(18px,3vw,28px)] ${c}`}>{v}</span>
              </div>
            ))}
          </WipeItem>
          <WipeItem index={3}>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-ink-950">
              Bericht ansehen
            </button>
          </WipeItem>
        </div>
      </FullscreenWipe>
    </div>
  );
}

/* ------------------------------------------------------------------ GlyphZoom */

export function GlyphDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <DemoBtn testId="glyph-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? "Zurück" : "Share-Karte erzeugen"}
        </DemoBtn>
      </div>
      <GlyphZoom word="+2,1R" open={open} label="Share-Karte" className="h-[260px] rounded-2xl border border-line sm:h-[320px]">
        <div className="grid size-full place-items-center bg-[radial-gradient(120%_90%_at_20%_10%,#e5202e_0%,#5a0b12_45%,#0a0a0a_100%)] p-6">
          <div className="grid w-full max-w-[420px] gap-2 rounded-2xl border border-white/15 bg-black/55 p-5">
            <span className="label">Trade geteilt</span>
            <span className="dot-num text-[34px] text-win">+2,1 R</span>
            <span className="text-[13px] text-mute">BTCUSDT Long · London-Sweep · A+</span>
          </div>
        </div>
      </GlyphZoom>
    </div>
  );
}

/* ------------------------------------------------------------------ ReelWindow */

export function ReelDemo() {
  const [n, setN] = useState(0);
  const tones = ["#3ddc84", "#f2f2f2", "#ff4d4f", "#3ddc84", "#9b9b9b", "#3ddc84", "#e5202e"];
  const names = ["SWEEP", "FVG", "RANGE", "OB", "BREAK", "RETEST", "A+"];
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <DemoBtn testId="reel-replay" onClick={() => setN((v) => v + 1)}>
          Replay
        </DemoBtn>
      </div>
      <ReelWindow
        play={n}
        label="Beispiel-Setups"
        lines={["Deine Setups", "in Bewegung"]}
        swapLines={["Trade the best.", "Vergiss den Rest."]}
        reels={tones.map((t, i) => (
          <Thumb key={i} seed={i + 1} tone={t} label={names[i]} fill />
        ))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ CardSpread */

const PLANS = [
  { name: "Free", price: "0 €", note: "Journal lokal" },
  { name: "Pro", price: "12 €", note: "Cloud, Coach, Berichte" },
  { name: "Premium", price: "24 €", note: "Börsen-Sync, Strategie-Labor" },
];
export function SpreadDemo() {
  const [n, setN] = useState(0);
  return (
    <div className="grid gap-6">
      <div className="flex gap-2">
        <DemoBtn testId="spread-replay" onClick={() => setN((v) => v + 1)}>
          Karten neu austeilen
        </DemoBtn>
      </div>
      <CardSpread play={n} className="grid gap-3 sm:grid-cols-3" label="Tarife">
        {PLANS.map((p, i) => (
          <article key={p.name} className={`grid gap-2 rounded-2xl border p-5 ${i === 1 ? "border-signal/50 bg-ink-800" : "border-line-2 bg-ink-850"}`}>
            <span className="label">{p.name}</span>
            <span className="dot-num text-[30px] text-fg">{p.price}</span>
            <span className="text-[12.5px] text-mute">{p.note}</span>
          </article>
        ))}
      </CardSpread>
      <CardSpread variant="fan" label="Strategien auffächern" cards={Array.from({ length: 8 }, (_, i) => <Thumb key={i} seed={i * 3 + 2} tone={i % 3 === 0 ? "#e5202e" : i % 2 ? "#f2f2f2" : "#3ddc84"} fill />)}>
        <h3 className="text-[6cqw] font-bold leading-none tracking-[-0.035em] text-fg">Strategien im Vergleich.</h3>
        <p className="text-[max(11px,1.6cqw)] text-white/50">Tippen fächert auf und wieder zu.</p>
      </CardSpread>
    </div>
  );
}

/* ------------------------------------------------------------------ OrbitSpread */

const TRAITS = [
  ["Disziplin", "82"],
  ["Geduld", "71"],
  ["Timing", "64"],
  ["Risiko", "58"],
  ["Ausstieg", "77"],
  ["Fokus", "69"],
  ["Ruhe", "74"],
  ["Regeln", "88"],
];
export function OrbitDemo() {
  return (
    <OrbitSpread
      label="Trader-Profil"
      listLabel="Eigenschaften"
      items={TRAITS.map(([k, v], i) => (
        <div key={k} className="grid size-full content-between bg-[linear-gradient(160deg,#1c1c1c,#0a0a0a)] p-[1.2cqw]">
          <span className="font-mono text-[max(7px,1.25cqw)] tracking-[0.12em] text-mute uppercase">{k}</span>
          <span className={`dot-num text-[3.4cqw] ${Number(v) >= 75 ? "text-win" : "text-fg"}`}>{v}</span>
          <span className="h-[0.25cqw] w-full rounded-full bg-white/10">
            <span className={`block h-full rounded-full ${i === 7 ? "bg-signal" : "bg-fg/70"}`} style={{ width: `${v}%` }} />
          </span>
        </div>
      ))}
    >
      <h3 className="text-[5.6cqw] font-semibold leading-none tracking-[-0.06em] text-fg">Dein Profil.</h3>
      <p className="max-w-[56cqw] text-[max(10px,1.4cqw)] text-white/60">Acht Eigenschaften aus deinen letzten 120 Trades. Pfeiltasten drehen den Ring.</p>
    </OrbitSpread>
  );
}

/* ------------------------------------------------------------------ LaunchGrid */

export function LaunchDemo() {
  const [n, setN] = useState(0);
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <DemoBtn testId="launch-replay" onClick={() => setN((v) => v + 1)}>
          Replay
        </DemoBtn>
      </div>
      <LaunchGrid
        play={n}
        label="Trade Journal PRO"
        slots={["Gefühl", "Zufall", "FOMO", "Disziplin"].map((w, i) => (
          <span key={w} className={`rounded-md px-2 py-0.5 ${i === 3 ? "bg-fg text-ink-950" : "bg-ink-700 text-fg"}`}>
            {w}
          </span>
        ))}
        cards={Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="aspect-[3/4]">
            <Thumb seed={i * 2 + 1} tone={i === 0 ? "#3ddc84" : "#9b9b9b"} label={i === 0 ? "A+ SETUP" : undefined} fill />
          </div>
        ))}
        aside={
          <div className="grid h-full content-between gap-6 p-6">
            <span className="label">Pro</span>
            <div className="grid gap-1">
              <DotMatrixText text="12" size={7} label="12 Euro" />
              <span className="text-[12.5px] text-mute">pro Monat · jederzeit kündbar</span>
            </div>
            <ul className="grid gap-1.5 text-[13px] text-fg">
              <li>Cloud-Sync auf allen Geräten</li>
              <li>Coach mit Wochenbericht</li>
              <li>Börsen-Import</li>
            </ul>
          </div>
        }
        hud={
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-ink-900 px-5 py-4">
            <span className="text-[14px] text-fg">14 Tage kostenlos testen.</span>
            <button type="button" className="rounded-full bg-fg px-4 py-2 text-[13px] font-medium text-ink-950">
              Pro starten
            </button>
          </div>
        }
      >
        <span className="label">Trade Journal PRO</span>
        <h3 className="text-[clamp(30px,5vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-fg">
          Trade mit <LaunchSlot />, nicht mit Gefühl.
        </h3>
        <p className="max-w-[420px] text-[14px] text-mute">Dein Journal zeigt dir, welche Setups wirklich Geld verdienen.</p>
      </LaunchGrid>
    </div>
  );
}
