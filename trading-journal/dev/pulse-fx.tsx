/**
 * Dev-only gallery of the `@/motion/fx` effects (P01) – visual review, 120 Hz checks and the e2e contract
 * (`tests/e2e/motion-fx.spec.ts`). Not part of the app bundle: open http://localhost:<port>/dev/pulse-fx.html with the
 * Vite dev server. `?c=<id>` shows one section (glow|streak|radar|liquid|equity|heat|flap|coach|confidence|cascade|
 * dissolve|spotlight|celebrate|matrix), `&bare` removes the app backdrop.
 */
import { animate, useMotionValue } from "motion/react";
import { StrictMode, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { Celebrate } from "@/motion/Celebrate";
import { BreakoutStreak, type StreakDirection } from "@/motion/fx/BreakoutStreak";
import { celebrateRecord, celebrateStreak } from "@/motion/fx/celebrate";
import { CoachStream } from "@/motion/fx/CoachStream";
import { ConfidenceMeter } from "@/motion/fx/ConfidenceMeter";
import { DissolveOut } from "@/motion/fx/DissolveOut";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { EquityDraw } from "@/motion/fx/EquityDraw";
import { GlowBreak, type GlowBreakTone } from "@/motion/fx/GlowBreak";
import { HeatGridReveal, heatColor } from "@/motion/fx/HeatGridReveal";
import { LiquidGauge } from "@/motion/fx/LiquidGauge";
import { NumberCascade } from "@/motion/fx/NumberCascade";
import { RadarSweep } from "@/motion/fx/RadarSweep";
import { SplitFlap } from "@/motion/fx/SplitFlap";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import { MotionNumber } from "@/motion/MotionNumber";
import { MotionRoot } from "@/motion/MotionRoot";
import { tween } from "@/motion/tokens";

const params = new URLSearchParams(location.search);
const only = params.get("c");
if (params.has("bare")) {
  const st = document.createElement("style");
  st.textContent = "body{background-image:none!important}body::before{display:none!important}";
  document.head.appendChild(st);
}

function Section({ id, title, note, children, actions }: { id: string; title: string; note?: string; children: ReactNode; actions?: ReactNode }) {
  if (only && only !== id) return null;
  return (
    <section data-section={id} className="grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-ink-900 p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h2 className="label">{title}</h2>
          {note ? <p className="text-[12px] text-faint">{note}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Btn({ children, onClick, testId, active }: { children: ReactNode; onClick: () => void; testId?: string; active?: boolean }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full border border-line-2 px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] text-mute transition-colors hover:text-fg aria-pressed:border-fg/40 aria-pressed:text-fg"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ sample data (deterministic) */

const EQUITY = [10000, 10120, 10080, 10310, 10260, 10540, 10490, 10720, 10910, 10840, 11080, 11300, 11210, 11560, 11720, 11650, 11980, 12240, 12180, 12480];
const BENCH = [10000, 10060, 10150, 10090, 10180, 10260, 10220, 10300, 10370, 10340, 10420, 10480, 10450, 10520, 10600, 10560, 10640, 10700, 10690, 10760];
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const HOURS = 12;
const heat = Array.from({ length: DAYS.length * HOURS }, (_, i) => Math.sin(i * 1.7) * 0.6 + Math.cos(i * 0.43) * 0.4);
const best = heat.reduce((b, v, i) => (v > (heat[b] ?? -Infinity) ? i : b), 0);
const ANSWER =
  "Deine besten Trades kommen aus dem Liquidity Sweep in der London-Session: 68 % Trefferquote, Ø 2,1 R. " +
  "Short-Trades nach 20 Uhr kosten dich dagegen Geld. Konzentrier dich nächste Woche auf A+-Setups und lass den Rest liegen.";

/* ------------------------------------------------------------------ sections */

function GlowDemo() {
  const [tone, setTone] = useState<GlowBreakTone>("win");
  const [n, setN] = useState(0);
  const pts = "0,120 40,104 80,110 120,86 160,92 200,64 240,70 280,40 320,48 360,30";
  return (
    <Section
      id="glow"
      title="GlowBreak"
      note="RSI-/Level-Bruch: Glow atmet 3×, endliche Sonar-Ringe"
      actions={
        <>
          {(["win", "loss", "soft"] as const).map((t) => (
            <Btn key={t} active={tone === t} onClick={() => setTone(t)}>
              {t}
            </Btn>
          ))}
          <Btn testId="glow-replay" onClick={() => setN((v) => v + 1)}>
            Replay
          </Btn>
        </>
      }
    >
      <div className="relative h-[150px] overflow-hidden rounded-xl border border-line bg-ink-950">
        <svg viewBox="0 0 360 150" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          <line x1="0" x2="360" y1="64" y2="64" stroke="#2c2c2c" strokeDasharray="3 4" />
          <polyline points={pts} fill="none" stroke="#9b9b9b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="absolute inset-0">
          <GlowBreak x={0} y={0} tone={tone} play={n} className="left-[55.5%] top-[42.6%]" />
        </div>
        <span className="absolute left-3 top-2 font-mono text-[10.5px] tracking-[0.12em] text-faint">RSI · Bruch der Trendlinie</span>
      </div>
    </Section>
  );
}

function StreakDemo() {
  const [dir, setDir] = useState<StreakDirection>("up");
  const [n, setN] = useState(0);
  return (
    <Section
      id="streak"
      title="BreakoutStreak"
      note="Canvas-Chevrons in Ausbruchsrichtung, ≤ 40, endlich"
      actions={
        <>
          {(["up", "down", "right"] as const).map((d) => (
            <Btn key={d} active={dir === d} onClick={() => setDir(d)}>
              {d}
            </Btn>
          ))}
          <Btn testId="streak-replay" onClick={() => setN((v) => v + 1)}>
            Ausbruch
          </Btn>
        </>
      }
    >
      <div className="relative grid h-[180px] place-items-center overflow-hidden rounded-xl border border-line bg-ink-950">
        <div className="relative z-[1] grid place-items-center gap-1 text-center">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-faint">BTCUSDT · 4H-BOX</span>
          <span className={dir === "down" ? "dot-num text-[30px] text-loss" : "dot-num text-[30px] text-win"}>{dir === "down" ? "Ausbruch ↓" : "Ausbruch ↑"}</span>
        </div>
        <BreakoutStreak key={dir} direction={dir} tone={dir === "down" ? "loss" : "win"} play={n} />
      </div>
    </Section>
  );
}

function RadarDemo() {
  const [on, setOn] = useState(true);
  return (
    <Section id="radar" title="RadarSweep" note="läuft nur während eines Scans (motion-exception radar-sweep)" actions={<Btn testId="radar-toggle" active={on} onClick={() => setOn((v) => !v)}>{on ? "Scan stoppen" : "Scan starten"}</Btn>}>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex items-center gap-3">
          <RadarSweep active={on} label={on ? "Scan läuft" : "Scan pausiert"} size={56} />
          <div className="grid gap-0.5">
            <span className="text-[13px] text-fg">{on ? "Scanne 42 Märkte …" : "Scan pausiert"}</span>
            <span className="font-mono text-[11px] text-faint">4H · 1D Boxen</span>
          </div>
        </div>
        <div className="relative h-[110px] overflow-hidden rounded-xl border border-line bg-ink-950">
          <svg viewBox="0 0 300 110" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
            <polyline points="0,80 30,70 60,76 90,50 120,58 150,40 180,48 210,30 240,36 270,22 300,28" fill="none" stroke="#5f5f5f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <RadarSweep active={on} variant="band" />
        </div>
      </div>
    </Section>
  );
}

function LiquidDemo() {
  const [v, setV] = useState(0.46);
  const mv = useMotionValue(0.46);
  const pct = useMotionValue(46);
  const set = (next: number) => {
    const c = Math.max(0, Math.min(1, next));
    setV(c);
    mv.set(c);
    animate(pct, c * 100, tween.collapse);
  };
  return (
    <Section
      id="liquid"
      title="LiquidGauge"
      note="Tagesverlust-Limit füllt sich zur roten Kante – Welle nur bei Änderung"
      actions={
        <>
          <Btn testId="liquid-down" onClick={() => set(v - 0.18)}>
            −18 %
          </Btn>
          <Btn testId="liquid-up" onClick={() => set(v + 0.18)}>
            +18 %
          </Btn>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-6">
        <LiquidGauge value={v} label="Tagesverlust-Limit" valueText={`${Math.round(v * 100)} % genutzt`} className="h-[160px] w-[92px]">
          <span className="dot-num text-[22px] text-fg">
            <MotionNumber source={pct} decimals={0} suffix=" %" tone="none" />
          </span>
        </LiquidGauge>
        <LiquidGauge value={mv} shape="round" tone="win" danger={null} label="Wochenziel" className="w-[120px]">
          <span className="label">Ziel</span>
        </LiquidGauge>
        <p className="max-w-[240px] text-[12.5px] text-mute">Ab 80 % kippt die Füllung ins Signalrot. In Ruhe schläft die Schleife.</p>
      </div>
    </Section>
  );
}

function EquityDemo() {
  const [n, setN] = useState(0);
  const race = useMotionValue(1);
  const runRace = () => {
    race.set(0);
    animate(race, 1, { duration: 2.2, ease: "linear" });
  };
  return (
    <Section
      id="equity"
      title="EquityDraw"
      note="Pfad-Draw mit leuchtendem Kopf; extern über progress (Rennen)"
      actions={
        <>
          <Btn testId="equity-replay" onClick={() => setN((v) => v + 1)}>
            Neu zeichnen
          </Btn>
          <Btn testId="equity-race" onClick={runRace}>
            Rennen
          </Btn>
        </>
      }
    >
      <EquityDraw values={EQUITY} play={n} label="Kontostand: 10.000 → 12.480 USDT" height={130} />
      <div className="relative">
        <EquityDraw values={BENCH} progress={race} tone="mute" area={false} baseline={null} label="Benchmark" height={90} />
        <div className="absolute inset-0">
          <EquityDraw values={EQUITY} progress={race} area={false} baseline={null} label="Du" height={90} />
        </div>
      </div>
    </Section>
  );
}

function HeatDemo() {
  const [n, setN] = useState(0);
  return (
    <Section id="heat" title="HeatGridReveal" note="radiale Kaskade ab der besten Zelle, Stagger gedeckelt" actions={<Btn testId="heat-replay" onClick={() => setN((v) => v + 1)}>Replay</Btn>}>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <div className="grid gap-[3px] pt-[1px]" style={{ gridTemplateRows: `repeat(${DAYS.length}, minmax(0, 1fr))` }}>
          {DAYS.map((d) => (
            <span key={d} className="font-mono text-[10px] leading-[18px] text-faint">
              {d}
            </span>
          ))}
        </div>
        <HeatGridReveal cols={HOURS} origin={best} play={n} className="gap-[3px]" aria-label="Ergebnis nach Wochentag und Stunde" role="img">
          {heat.map((v, i) => (
            <span key={i} className="block h-[18px] rounded-[4px]" style={{ background: heatColor(v) }} />
          ))}
        </HeatGridReveal>
      </div>
    </Section>
  );
}

const PERIODS = ["Tag", "Woche", "Monat", "Jahr"] as const;
function FlapDemo() {
  const [i, setI] = useState(1);
  const [q, setQ] = useState(3);
  return (
    <Section
      id="flap"
      title="SplitFlap"
      note="Perioden- und Labelwechsel über TextRoll roll"
      actions={
        <>
          {PERIODS.map((p, k) => (
            <Btn key={p} testId={`flap-${p}`} active={i === k} onClick={() => setI(k)}>
              {p}
            </Btn>
          ))}
          <Btn onClick={() => setQ((v) => (v % 4) + 1)}>Quartal +1</Btn>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-4 text-[22px] font-medium">
        <span className="text-[13px] text-mute">Bericht für die</span>
        <SplitFlap text={PERIODS[i]!} order={PERIODS} />
        <SplitFlap text={`Q${q} 2026`} tiles minChars={7} className="font-mono text-[18px]" />
      </div>
    </Section>
  );
}

function CoachDemo() {
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const timers = useRef<number[]>([]);
  const ask = () => {
    timers.current.forEach((t) => clearTimeout(t));
    setText("");
    setThinking(true);
    const words = ANSWER.split(" ");
    let at = 900;
    for (let k = 6; k <= words.length + 5; k += 6) {
      const chunk = words.slice(0, Math.min(words.length, k)).join(" ");
      timers.current.push(window.setTimeout(() => setText(chunk), at));
      at += 520;
    }
    timers.current.push(window.setTimeout(() => setThinking(false), at));
  };
  return (
    <Section id="coach" title="CoachStream" note="Typewriter + TextShimmer, voller Text sr-only, Streaming setzt fort" actions={<Btn testId="coach-ask" onClick={ask}>Coach fragen</Btn>}>
      <div className="min-h-[96px] rounded-xl border border-line bg-ink-950 p-4 text-[14px] leading-relaxed text-fg">
        <CoachStream text={text} thinking={thinking} />
      </div>
    </Section>
  );
}

function ConfidenceDemo() {
  const [k, setK] = useState(0);
  const sets = [
    [82, 55, 24],
    [64, 91, 38],
  ] as const;
  const vals = sets[k % 2]!;
  return (
    <Section id="confidence" title="ConfidenceMeter" note="DotMatrix-Rampe + RollingDigits; schwache Edges bleiben leise" actions={<Btn testId="confidence-next" onClick={() => setK((v) => v + 1)}>Neu bewerten</Btn>}>
      <div className="grid gap-3">
        <ConfidenceMeter value={vals[0]} label="Sweep London" />
        <ConfidenceMeter value={vals[1]} label="FVG Retest" />
        <ConfidenceMeter value={vals[2]} label="Range-Abweichung" />
      </div>
    </Section>
  );
}

function CascadeDemo() {
  const [n, setN] = useState(0);
  const [ror, setRor] = useState(0.8);
  return (
    <Section
      id="cascade"
      title="NumberCascade"
      note="Hochzählen mit Ziffernregen, Spalten rasten von links ein"
      actions={
        <>
          <Btn testId="cascade-replay" onClick={() => setN((v) => v + 1)}>
            Replay
          </Btn>
          <Btn onClick={() => setRor((v) => (v > 1 ? 0.8 : 3.4))}>Risiko ändern</Btn>
        </>
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
        <div className="grid gap-1">
          <span className="label">Netto-P&amp;L</span>
          <NumberCascade value={12480.5} decimals={2} signed suffix=" USDT" play={n} className="dot-num text-[30px] text-win" />
        </div>
        <div className="grid gap-1">
          <span className="label">Risk of Ruin</span>
          <NumberCascade value={ror} decimals={1} suffix=" %" play={n} className="dot-num text-[30px] text-fg" />
        </div>
      </div>
    </Section>
  );
}

const ROWS = [
  { id: "a", t: "BTCUSDT Long · +2,1 R" },
  { id: "b", t: "ETHUSDT Short · −1,0 R" },
  { id: "c", t: "SOLUSDT Long · +0,6 R" },
];
function DissolveDemo() {
  const [rows, setRows] = useState(ROWS);
  const [gone, setGone] = useState<string | null>(null);
  return (
    <Section id="dissolve" title="DissolveOut" note="Pixel-Auflösung beim Löschen über clip-path-Schritte" actions={<Btn testId="dissolve-reset" onClick={() => setRows(ROWS)}>Zurücksetzen</Btn>}>
      <ul className="grid gap-2" data-testid="dissolve-list">
        {rows.map((r) => (
          <li key={r.id}>
            <DissolveOut
              active={gone === r.id}
              onDone={() => {
                setRows((list) => list.filter((x) => x.id !== r.id));
                setGone(null);
              }}
              className="flex items-center justify-between rounded-xl border border-line-2 bg-ink-850 px-4 py-3"
            >
              <span className="text-[13.5px] text-fg">{r.t}</span>
              <button type="button" data-testid={`dissolve-${r.id}`} onClick={() => setGone(r.id)} className="rounded-full border border-line-2 px-2.5 py-1 text-[11px] text-mute hover:text-loss">
                Löschen
              </button>
            </DissolveOut>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SpotlightDemo() {
  const [n, setN] = useState(0);
  return (
    <Section id="spotlight" title="SpotlightSweep" note="einmalige rote Signallinie über eine Karte" actions={<Btn testId="spotlight-replay" onClick={() => setN((v) => v + 1)}>Replay</Btn>}>
      <div className="relative overflow-hidden rounded-2xl border border-line-2 bg-ink-850 p-5">
        <SpotlightSweep play={n} />
        <span className="label">Leak gefunden</span>
        <p className="mt-2 text-[15px] text-fg">Revenge-Trades nach zwei Verlusten: −1.240 USDT in 30 Tagen.</p>
      </div>
    </Section>
  );
}

function CelebrateDemo() {
  const a = useRef<HTMLButtonElement>(null);
  const b = useRef<HTMLButtonElement>(null);
  return (
    <Section id="celebrate" title="Celebrate-Presets" note="streak (Serie ≥ 5 mit Echo) und record (roter Signalpunkt)">
      <div className="flex flex-wrap items-center gap-3">
        <button ref={a} type="button" data-testid="celebrate-streak" onClick={() => celebrateStreak(a.current, { streak: 6 })} className="rounded-full bg-fg px-4 py-2 text-[13px] font-medium text-ink-950">
          6er-Serie
        </button>
        <button ref={b} type="button" data-testid="celebrate-record" onClick={() => celebrateRecord(b.current)} className="rounded-full border border-signal/60 px-4 py-2 text-[13px] font-medium text-fg">
          Neuer Rekord
        </button>
      </div>
    </Section>
  );
}

function MatrixDemo() {
  const [n, setN] = useState(1);
  return (
    <Section id="matrix" title="DotMatrixText" note="Textmodus, '/', Buchstaben, Presets wave · snake · chevrons" actions={<Btn testId="matrix-next" onClick={() => setN((v) => (v % 5) + 1)}>Schritt +1</Btn>}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <DotMatrixText text="A+" tone="signal" preset="chevrons" presetTone="win" size={6} label="Note A plus" />
        <DotMatrixText text={`${n}:5`} size={5} label={`Schritt ${n} von 5`} />
        <DotMatrixText text="3/4" size={5} tone="fg" label="3 von 4" />
        <DotMatrixText text="SCAN" size={4} preset="wave" presetPosition="before" tone="mute" presetTone="signal" />
        <DotMatrixText text="PRO" size={5} tone="fg" preset="snake" presetTone="signal" />
        <DotMatrixText text="+2,4%" tone="win" size={4} preset="chevrons-left" presetTone="mute" presetPosition="before" />
      </div>
    </Section>
  );
}

function Gallery() {
  return (
    <main data-gallery="pulse-fx" className="mx-auto grid max-w-[1100px] gap-5 px-4 py-8 text-fg">
      <h1 className="font-dot text-[28px]">pulse · FX</h1>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <GlowDemo />
        <StreakDemo />
        <RadarDemo />
        <LiquidDemo />
        <EquityDemo />
        <HeatDemo />
        <FlapDemo />
        <CoachDemo />
        <ConfidenceDemo />
        <CascadeDemo />
        <DissolveDemo />
        <SpotlightDemo />
        <CelebrateDemo />
        <MatrixDemo />
      </div>
      <Celebrate />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionRoot>
      <Gallery />
    </MotionRoot>
  </StrictMode>,
);
