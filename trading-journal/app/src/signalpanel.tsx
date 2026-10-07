// Einstiegs-Check: prüft live über TradingView-Kerzen die Trade-Bedingungen
// (MCB-Signal auf der Timeframe-Leiter, RSI nahe Extrem, Premium/Discount) und zeigt das Urteil.
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { cn, fmt, type MarketState, type Settings } from './lib';
import { STRENGTH_LABEL, type Side, type Signals, type TfCheck, type Verdict } from './signals';
import { Card, CircularProgress, Detail, Expand, InfoToggle, Pill, Segmented } from './ui';
import { useIsland } from './island';
import { spring } from './physics';

const KIND: Record<string, { text: string; long: boolean; strong: boolean }> = {
  bottom: { text: 'Bottom', long: true, strong: true },
  buy: { text: 'Kaufsignal', long: true, strong: true },
  bull: { text: 'Einstieg', long: true, strong: false },
  top: { text: 'Top', long: false, strong: true },
  sell: { text: 'Verkaufssignal', long: false, strong: true },
  bear: { text: 'Einstieg Short', long: false, strong: false },
};

export function SignalPanel({ sig, market, settings }: { sig: Signals | null; market: MarketState; settings: Settings }) {
  const cfg = settings.signals;
  const [side, setSide] = useState<Side | null>(null);
  const [info, setInfo] = useState(false);
  const cur: Side = side ?? sig?.best.side ?? 'long';
  const v = sig ? sig[cur] : null;
  useSignalAlerts(sig);

  return (
    <Card title="Einstiegs-Check" note={sig ? `live · ${cfg.ladder.join(' → ')}` : undefined}
      action={<div className="flex items-center gap-2">
        <Segmented size="sm" value={cur} onChange={(x) => setSide(x)} options={[{ v: 'long', label: 'Long' }, { v: 'short', label: 'Short' }]}
          tones={{ long: '!border-win/30', short: '!border-loss/30' }} />
        <InfoToggle open={info} onClick={() => setInfo((o) => !o)} label="Einstiegs-Check" />
      </div>}>
      {!sig || !v ? (
        <p className="text-[13px] leading-relaxed text-mute">
          {market.status === 'live' || market.status === 'connecting' ? 'Kerzen werden geladen …' : market.message || 'Kein Live-Zugang zu TradingView.'}
        </p>
      ) : (
        <div className="grid gap-5">
          <VerdictRow v={v} />
          <Ladder checks={sig.checks} side={cur} v={v} cfg={cfg} />
          <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
            <ZoneGauge c={sig.zone} side={cur} />
            <ul className="grid content-start gap-1.5">
              {v.reasons.map((r) => (
                <li key={r.text} className="flex items-center gap-2 text-[12.5px]">
                  <span className={cn('grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold', r.ok ? 'bg-win/20 text-win' : 'bg-white/[0.06] text-faint')}>{r.ok ? '✓' : '·'}</span>
                  <span className={r.ok ? 'text-fg' : 'text-mute'}>{r.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <Expand open={info}>
        <Detail d={{
          title: 'So prüft das Journal',
          what: `Aus den TradingView-Kerzen (${settings.market.symbol}) rechnet das Journal deine Indikatoren nach: MCB/WaveTrend (Kanal ${cfg.wtChannel}, Schnitt ${cfg.wtAverage}, Signal ${cfg.wtSignal}), RSI ${cfg.rsiLen} mit gleitendem Durchschnitt ${cfg.rsiMaLen} und Premium/Discount nach LuxAlgo (Swing-Pivots mit Länge ${cfg.swingLookback}) auf ${cfg.zoneTf}. Die laufende Kerze wird mit dem Live-Kurs ergänzt, wie im Chart. Die Werte stimmen auf ±1 Punkt mit dem Chart überein; private Indikator-Skripte selbst sind über die Schnittstelle nicht lesbar.`,
          formula: <>Long: MCB Bottom/Einstieg auf {cfg.ladder[0]} + {cfg.ladder[1]} (Pflicht) · {cfg.ladder.slice(2).join(', ')} = stärker · RSI ≤ {cfg.rsiOs + cfg.rsiNear} (Pflicht) · Discount = Bonus<br />Short: spiegelbildlich mit Top, RSI ≥ {cfg.rsiOb - cfg.rsiNear} und Premium</>,
          rows: [
            ['Signal gilt', `${cfg.signalLookback} Kerzen`],
            ['Bottom/Top', `wt1 und Kurs drehen aus ${cfg.revRange}-Kerzen-Tief/Hoch`],
            ['Kauf-/Verkaufssignal', `Kreuzung bei ≤ ${cfg.wtOs} / ≥ ${cfg.wtOb}`],
            ['Einstieg', 'Kreuzung unter (Short: über) der Nulllinie'],
            ['Stärke', 'Basis + Bestätigung = 1, jede weitere Stufe +1, Discount +1'],
            ['Score', 'Leiter 55 · RSI 20 · Zone 15 · Bottom/Top 10'],
          ],
          verdict: { tone: 'mute', text: 'Einstellbar unter Einstellungen → Einstiegs-Check. Beim Eintragen eines Trades wird der Check mitgespeichert, so siehst du später, welche Signal-Stärke wirklich Geld bringt.' },
        }} />
      </Expand>
    </Card>
  );
}

function VerdictRow({ v }: { v: Verdict }) {
  const col = v.valid ? (v.side === 'long' ? 'text-win' : 'text-loss') : 'text-fg';
  const ring = v.valid ? (v.side === 'long' ? '#3ddc84' : '#ff4d4f') : '#9b9b9b';
  return (
    <div className="flex items-center gap-5">
      <CircularProgress value={v.score / 100} size={86} stroke={8} color={ring} track="#1f1f1f">
        <span className="dot-num text-[26px] leading-none text-fg">{v.score}</span>
      </CircularProgress>
      <div className="min-w-0">
        <motion.div key={v.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring('soft')}
          className={cn('text-[19px] font-semibold tracking-tight', col)}>{v.label}</motion.div>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex gap-1" aria-label={`Stärke ${v.strength} von 4`}>
            {[1, 2, 3, 4].map((i) => (
              <motion.span key={i} className="size-2 rounded-full" initial={false}
                animate={{ backgroundColor: i <= v.strength ? ring : '#2c2c2c', scale: i <= v.strength ? 1 : 0.8 }} transition={spring('bouncy', i * 0.04)} />
            ))}
          </span>
          <span className="text-[12px] text-mute">{STRENGTH_LABEL[v.strength]} · {v.tiers} von 4 Timeframes</span>
        </div>
      </div>
    </div>
  );
}

function Ladder({ checks, side, v, cfg }: { checks: (TfCheck | null)[]; side: Side; v: Verdict; cfg: Settings['signals'] }) {
  return (
    <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-4">
      {checks.map((c, i) => {
        const tf = c?.tf ?? cfg.ladder[i];
        const on = i < v.tiers;
        const ev = c ? (side === 'long' ? c.wt.long : c.wt.short) ?? (c.wt.kind ? { kind: c.wt.kind, barsAgo: c.wt.barsAgo! } : null) : null;
        const k = ev ? KIND[ev.kind] : null;
        const match = !!k && k.long === (side === 'long');
        const role = i === 0 ? 'Basis' : i < cfg.required ? 'Bestätigung' : 'stärker';
        const rsiNear = !!c && (side === 'long' ? c.rsiLong : c.rsiShort);
        return (
          <motion.div key={tf} layout="position"
            className={cn('relative overflow-hidden rounded-xl border p-3 transition-colors duration-300',
              on ? (side === 'long' ? 'border-win/35 bg-win/[0.06]' : 'border-loss/35 bg-loss/[0.06]') : 'border-line bg-ink-950/50')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="dot-num text-[20px] leading-none text-fg">{tf}</span>
              <span className="text-[10px] uppercase tracking-[0.12em] text-faint">{role}</span>
            </div>
            {!c ? <p className="mt-3 text-[11.5px] text-faint">Zu wenig Kerzen</p> : (
              <>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-semibold', match ? (side === 'long' ? 'text-win' : 'text-loss') : k ? 'text-mute' : 'text-faint')}>
                    <span className={cn('size-2 rounded-full', !k ? 'bg-line-2' : k.long ? (k.strong ? 'bg-win' : 'border border-win') : (k.strong ? 'bg-loss' : 'border border-loss'))} />
                    {k ? k.text : 'kein Signal'}
                  </span>
                  {ev && <span className="text-[10.5px] text-faint">{ev.barsAgo === 0 ? 'jetzt' : `vor ${ev.barsAgo}`}</span>}
                </div>
                <Meter label="MCB" value={c.wt.wt1} min={-100} max={100} lo={cfg.wtOs} hi={cfg.wtOb} active={match} side={side} />
                <Meter label="RSI" value={c.rsi} min={0} max={100} lo={cfg.rsiOs + cfg.rsiNear} hi={cfg.rsiOb - cfg.rsiNear} active={rsiNear} side={side} sub={`Ø ${fmt.n1(c.rsiMa)}`} />
              </>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

/** Kleiner Balken mit Markierung und schraffierten Extrem-Bereichen. */
function Meter({ label, value, min, max, lo, hi, active, side, sub }: { label: string; value: number; min: number; max: number; lo: number; hi: number; active: boolean; side: Side; sub?: string }) {
  const p = (x: number) => `${Math.max(0, Math.min(100, ((x - min) / (max - min)) * 100))}%`;
  return (
    <div className="mt-2.5">
      <div className="flex items-baseline justify-between text-[10.5px]">
        <span className="uppercase tracking-[0.1em] text-faint">{label}</span>
        <span className={cn('num font-mono', active ? (side === 'long' ? 'text-win' : 'text-loss') : 'text-mute')}>{fmt.n1(value)}{sub && <span className="ml-1.5 text-faint">{sub}</span>}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-white/[0.05]">
        <span className="absolute inset-y-0 left-0 rounded-l-full bg-win/15" style={{ width: p(lo) }} />
        <span className="absolute inset-y-0 right-0 rounded-r-full bg-loss/15" style={{ left: p(hi) }} />
        <motion.span className={cn('absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full', active ? (side === 'long' ? 'bg-win' : 'bg-loss') : 'bg-fg')}
          initial={false} animate={{ left: p(value) }} transition={spring('soft')} />
      </div>
    </div>
  );
}

function ZoneGauge({ c, side }: { c: TfCheck | null; side: Side }) {
  if (!c) return <p className="text-[12px] text-faint">Premium/Discount: zu wenig Kerzen.</p>;
  const z = c.zone;
  const good = side === 'long' ? z.zone === 'discount' : z.zone === 'premium';
  const name = { premium: 'Premium', equilibrium: 'Equilibrium', discount: 'Discount' }[z.zone] + (z.deep ? '-Zone' : '');
  const structure = z.brk ? `${z.brk.kind} ${z.brk.dir > 0 ? '↑' : '↓'}` : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">Zone · {c.tf}</span>
        <Pill tone={good ? (side === 'long' ? 'win' : 'loss') : 'mute'}>{name} · {fmt.n0(z.pos * 100)} %</Pill>
      </div>
      <div className="relative mt-3 h-8 overflow-hidden rounded-lg border border-line">
        <div className="absolute inset-y-0 left-0 w-[47.5%] bg-gradient-to-r from-win/[0.14] to-win/[0.03]" />
        <div className="absolute inset-y-0 right-0 w-[47.5%] bg-gradient-to-l from-loss/[0.14] to-loss/[0.03]" />
        <div className="absolute inset-y-0 left-0 w-[5%] bg-win/35" title="LuxAlgo Discount-Zone" />
        <div className="absolute inset-y-0 right-0 w-[5%] bg-loss/35" title="LuxAlgo Premium-Zone" />
        <div className="absolute inset-y-0 left-[47.5%] w-[5%] bg-white/[0.07]" title="Equilibrium" />
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.1em] text-win/80">Discount</span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.1em] text-loss/80">Premium</span>
        <motion.span className="absolute inset-y-1 w-[3px] -translate-x-1/2 rounded-full bg-fg shadow-[0_0_0_3px_rgb(4_4_4/0.6)]"
          initial={false} animate={{ left: `${Math.max(2, Math.min(98, z.pos * 100))}%` }} transition={spring('soft')} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-faint">
        <span>{fmt.n0(z.lo)}</span><span>EQ {fmt.n0(z.eq)}</span><span>{fmt.n0(z.hi)}</span>
      </div>
      <p className="mt-1.5 text-[11px] text-faint">{z.lux ? `LuxAlgo-Logik · Swing-Bereich seit dem letzten Pivot${structure ? ` · Struktur ${structure}` : ''}` : 'Noch kein Swing-Pivot, Bereich der letzten 120 Kerzen'}</p>
    </div>
  );
}

/** Meldet in der Island, wenn ein gültiger Einstieg neu entsteht oder stärker wird (nicht beim ersten Laden). */
function useSignalAlerts(sig: Signals | null) {
  const notify = useIsland();
  const last = useRef<{ long: number; short: number } | null>(null);
  useEffect(() => {
    if (!sig) return;
    const now = { long: sig.long.valid ? sig.long.strength : 0, short: sig.short.valid ? sig.short.strength : 0 };
    const prev = last.current;
    last.current = now;
    if (!prev) return;
    for (const s of ['long', 'short'] as const) {
      if (now[s] > prev[s]) notify({ kind: 'signal', title: sig[s].label, value: `Score ${sig[s].score}`, valueTone: s === 'long' ? 'win' : 'loss' });
    }
  }, [sig?.long.strength, sig?.short.strength, sig?.long.valid, sig?.short.valid]);
}
