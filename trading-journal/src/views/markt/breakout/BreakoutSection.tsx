/**
 * Scanner „Wer bricht aus?“ (Markt-Seite, eigener Lazy-Chunk samt Stylesheet): zwölf Märkte gegen EINE erklärte Regel – die Spanne
 * der ersten 30 Minuten einer Sitzung, der erste Schluss außerhalb, dazu Volumen und Trend (`@/domain/breakout`).
 *
 * Ehrlich gebaut:
 *  - Echte öffentliche 5-Minuten-Kerzen (`@/market/breakout/candles`: Binance → EU-Proxy → Bybit); die Quelle und der Stand stehen
 *    unter den Karten (`SourceStand`). Ohne Kerzen gibt es den Grund in Worten, nie Ersatzdaten.
 *  - Der Zähler „Geprüft 7/12“ ist der echte Stand der Abrufe; jede Karte füllt sich, wenn ihre Kerzen da sind. Nichts wird abgespielt.
 *  - Kein Orderknopf, kein „jetzt“, keine Belohnung: die Karte mit den meisten erfüllten Gründen wird ruhig markiert; erfüllt keine alles,
 *    sagt die Seite das. „In den Rechner übernehmen“ belegt nur Felder vor.
 *
 * Bewegung: die zwölf Plätze bauen sich nacheinander auf (45 ms je Karte, CSS), die Gründe springen einzeln an (45 ms), nach dem Lauf
 * sortieren sich die Karten per Feder nach Note (`layout`, nur transform); das Radar dreht nur, während wirklich geladen wird
 * (`RadarSweep`). Reduzierte Bewegung: Endzustand sofort. Feste Höhen überall – nichts springt, wenn Daten kommen.
 */
import { motion } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { BREAKOUT_SESSIONS, BREAKOUT_SYMBOLS, calcPrefill, GRADE_RANK, type BreakoutRead, type BreakoutSessionId } from "@/domain/breakout";
import { hhmm } from "@/market/format";
import { RadarSweep } from "@/motion/fx/RadarSweep";
import { canObserveInView, useFirstInView } from "@/motion/inView";
import { MotionNumber } from "@/motion/MotionNumber";
import { TextScramble } from "@/motion/TextScramble";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { SourceStand } from "@/ui/SourceStand";
import { MiniCandles } from "./MiniCandles";
import { checkedCount, useBreakoutScan, type Row } from "./scanStore";
import { BREAKOUT } from "./strings";
import { toCalculator } from "./toCalculator";
import "./breakout.css";

const S = BREAKOUT;
const SESSION_OPTS = BREAKOUT_SESSIONS.map((v) => ({ v, label: S.sessions[v] }));
const de = (x: number, d: number): string => x.toFixed(d).replace(".", ",").replace("-", "−");
/** A price with the places its size needs (76.095 · 2.243,5 · 698,90 · 51,890 · 0,07148). */
export const pxText = (p: number): string => {
  const d = p >= 10_000 ? 0 : p >= 1000 ? 1 : p >= 100 ? 2 : p >= 1 ? 3 : 5;
  return p.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const signedPct = (x: number, d = 1): string => `${x > 0 ? "+" : ""}${de(x, d)} %`;
const isTop = (r: BreakoutRead): boolean => r.grade != null && GRADE_RANK[r.grade] >= GRADE_RANK.A;

/** "+0,42 % · 0,8 ATR" – distance of the last close from the mark. */
export function distText(r: BreakoutRead): string {
  if (r.distPct == null) return "–";
  const atr = r.distAtr != null ? ` · ${de(Math.abs(r.distAtr), 1)} ATR` : "";
  if (r.status === "breakout") return `${signedPct(r.distPct, 2)}${atr}${r.distPct < 0 ? ` (${S.back})` : ""}`;
  return `${de(r.distPct, 2)} % ${r.nearEdge === "high" ? S.toHigh : S.toLow}${atr}`;
}

type ChipState = "y" | "n" | "u";
const chipState = (v: boolean | null): ChipState => (v == null ? "u" : v ? "y" : "n");
const CHIP_WORD: Record<ChipState, string> = { y: S.chipState.yes, n: S.chipState.no, u: S.chipState.unknown };

function chipsOf(r: BreakoutRead): { key: string; text: string; s: ChipState }[] {
  const b = r.status === "breakout";
  return [
    { key: "breakout", text: S.chips.breakout, s: b ? "y" : "n" },
    { key: "volume", text: r.volumeX != null ? `Vol ${de(r.volumeX, 1)}×` : S.chips.volume, s: b ? chipState(r.reasons.volume) : "u" },
    { key: "trend", text: S.chips.trend, s: b ? chipState(r.reasons.trend) : "u" },
  ];
}

function cardLabel(r: BreakoutRead): string {
  const parts = [r.base, r.grade ? `Note ${r.grade}` : null, r.statusText, ...chipsOf(r).map((c) => `${c.text}: ${CHIP_WORD[c.s]}`), r.distPct != null ? `${S.facts.dist} ${distText(r)}` : null];
  return parts.filter(Boolean).join(", ");
}

function CoinCard({ row, index, selected, best, sessionShort, onSelect }: { row: Row; index: number; selected: boolean; best: boolean; sessionShort: string; onSelect: (symbol: string) => void }) {
  const base = row.symbol.replace(/USDT$/, "");
  const read = row.state === "ok" ? row.read : null;
  const style = { "--i": index } as React.CSSProperties;
  return (
    <button
      type="button"
      className="bo-card"
      style={style}
      data-testid="breakout-card"
      data-symbol={row.symbol}
      data-state={row.state}
      data-status={read?.status}
      data-grade={read?.grade ?? undefined}
      data-best={best ? "" : undefined}
      aria-pressed={read ? selected : undefined}
      aria-label={read ? cardLabel(read) : row.state === "error" ? `${base}: ${row.message}` : `${base}: ${S.pending}`}
      disabled={!read}
      onClick={() => onSelect(row.symbol)}
    >
      {best && <span className="bo-best">{S.best}</span>}
      <span className="bo-top">
        <span className="bo-tick">
          <TextScramble className="bo-name" text={base} charset="ABCDEFGHJKLMNOPRSTUVWXYZ" />
          <small>
            {row.symbol} · {sessionShort}
          </small>
        </span>
        <span className="bo-grade" data-top={read && isTop(read) ? "" : undefined} aria-hidden="true">
          {read ? (read.grade ?? "–") : ""}
        </span>
      </span>
      {read ? (
        <>
          <span className="bo-px bo-fill">
            <b>{read.price != null ? pxText(read.price) : "–"}</b>
            {read.change24h != null && <em data-tone={read.change24h > 0 ? "win" : read.change24h < 0 ? "loss" : undefined}>{signedPct(read.change24h)}</em>}
          </span>
          <MiniCandles read={read} />
          <span className="bo-chips">
            {chipsOf(read).map((c, k) => (
              <span key={c.key} className="bo-chip" data-s={c.s} style={{ "--k": k } as React.CSSProperties}>
                {c.text}
              </span>
            ))}
          </span>
          <span className="bo-st bo-fill">
            <b>{read.statusText}</b>
            {read.distPct != null ? ` · ${distText(read)}` : ""}
          </span>
        </>
      ) : (
        <>
          <span className="bo-px">
            <em>{row.state === "error" ? "–" : S.pending}</em>
          </span>
          <span className="bo-chart" aria-hidden="true">
            {row.state === "pending" && <span className="bo-skel" />}
          </span>
          <span className="bo-chips" />
          <span className="bo-st">{row.state === "error" ? row.message : ""}</span>
        </>
      )}
    </button>
  );
}

function Detail({ read }: { read: BreakoutRead | null }) {
  if (!read) {
    return (
      <div className="bo-detail" data-testid="breakout-detail" data-empty="">
        <p className="m-0 text-[13px] text-mute">{S.detailEmpty}</p>
      </div>
    );
  }
  const prefill = calcPrefill(read);
  const sig = read.signal;
  return (
    <div className="bo-detail" data-testid="breakout-detail" data-symbol={read.symbol}>
      <div>
        <h4>
          {read.base}
          {read.side ? ` · ${read.side === "long" ? "Long" : "Short"}` : ""}
          <small>
            {read.statusText} · {read.session.label}
          </small>
        </h4>
        <dl className="bo-facts">
          <div>
            <dt>{S.facts.grade}</dt>
            <dd data-testid="breakout-fact-grade">{read.grade ? `${read.grade} · ${S.gradeText[read.grade]}` : S.noGrade}</dd>
          </div>
          <div>
            <dt>{S.facts.volume}</dt>
            <dd data-testid="breakout-fact-volume">{read.volumeX != null ? `${de(read.volumeX, 1)}×` : "–"}</dd>
          </div>
          <div>
            <dt>{S.facts.level}</dt>
            <dd>{read.level != null ? pxText(read.level) : read.range ? `${pxText(read.range.low)} – ${pxText(read.range.high)}` : "–"}</dd>
          </div>
          <div>
            <dt>{S.facts.dist}</dt>
            <dd data-testid="breakout-fact-dist">{distText(read)}</dd>
          </div>
          <div>
            <dt>{S.facts.time}</dt>
            <dd data-testid="breakout-fact-time">{sig ? `${hhmm(sig.barClose)} Uhr${read.session.previousDay ? " (gestern)" : ""}` : "–"}</dd>
          </div>
          <div>
            <dt>{S.facts.atr}</dt>
            <dd>{read.atr != null ? pxText(read.atr) : "–"}</dd>
          </div>
        </dl>
      </div>
      <div>
        <span className="bo-label">{S.why}</span>
        <ul className="bo-why" key={`${read.symbol}:${read.session.id}`}>
          {read.why.slice(0, 5).map((w, k) => (
            <li key={k} style={{ "--k": k } as React.CSSProperties}>
              {w}
            </li>
          ))}
        </ul>
        <div className="bo-act">
          <Button variant="secondary" size="sm" disabled={!prefill} onClick={() => toCalculator(read)} data-testid="breakout-to-calc">
            {S.toCalc}
          </Button>
          <p>{prefill ? S.toCalcNote : S.noPrefill}</p>
        </div>
      </div>
    </div>
  );
}

export default function BreakoutSection() {
  const reduced = useReducedFx();
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const seen = useFirstInView(ref, true);
  const phase = useBreakoutScan((s) => s.phase);
  const session = useBreakoutScan((s) => s.session);
  const rows = useBreakoutScan((s) => s.rows);
  const order = useBreakoutScan((s) => s.order);
  const selected = useBreakoutScan((s) => s.selected);
  const failure = useBreakoutScan((s) => s.failure);
  const fetchedAt = useBreakoutScan((s) => s.fetchedAt);
  const start = useBreakoutScan((s) => s.start);
  const select = useBreakoutScan((s) => s.select);

  // the first scan starts when the block is really on screen (a browser with an observer); elsewhere the button starts it
  const auto = canObserveInView();
  useEffect(() => {
    if (auto && seen && useBreakoutScan.getState().phase === "idle") void start();
  }, [auto, seen, start]);

  const scanning = phase === "scanning";
  const done = phase === "done";
  const oks = Object.values(rows).filter((r): r is Extract<Row, { state: "ok" }> => r.state === "ok");
  const checked = checkedCount(rows);
  const top = oks.filter((r) => isTop(r.read)).length;
  const first = done ? rows[order[0] ?? ""] : undefined;
  const lead = first?.state === "ok" ? first.read : null;
  const bestSymbol = lead && isTop(lead) ? lead.symbol : null;
  const sel = selected ? rows[selected] : undefined;
  const selRead = sel?.state === "ok" ? sel.read : null;
  const sources = [...new Set(oks.map((r) => r.source))];
  const lastBar = oks.reduce<number | null>((m, r) => (r.read.priceAt != null && (m == null || r.read.priceAt > m) ? r.read.priceAt : m), null);
  const sessionLabel = oks[0]?.read.session.label ?? `${S.sessionShort[session]}-Sitzung`;

  let msg: string = "";
  let tone: "error" | undefined;
  if (phase === "idle") msg = S.idle;
  else if (scanning) msg = `${S.scanning}: ${checked} von ${BREAKOUT_SYMBOLS.length} Märkten geprüft.`;
  else if (failure) {
    msg = S.failed(failure);
    tone = "error";
  } else if (lead && !isTop(lead)) msg = lead.grade ? S.calm(lead.base, lead.grade) : S.none;

  return (
    <section ref={ref} className="bo-frost" aria-labelledby={titleId} data-testid="breakout-section" data-phase={phase} data-session={session}>
      <div className="bo-head">
        <div>
          <h3 id={titleId} className="bo-title">
            {S.title}
            <span>?</span>
          </h3>
          <p className="bo-lead">{S.lead(sessionLabel)}</p>
          <div className="bo-ctl">
            <Segmented<BreakoutSessionId> aria-label={S.sessionLabel} options={SESSION_OPTS} value={session} onChange={(v) => void start({ session: v })} size="sm" />
            <Button variant="secondary" size="sm" disabled={scanning} onClick={() => void start({ fresh: true })} data-testid="breakout-rescan">
              {phase === "idle" ? S.scanStart : S.rescan}
            </Button>
          </div>
        </div>
        <div className="bo-side">
          <span className="bo-radar">
            <RadarSweep active={scanning} tone="win" size={64} label={scanning ? S.scanning : undefined} />
          </span>
          <div className="bo-stats">
            <div className="bo-stat">
              <span>{S.checked}</span>
              <b data-testid="breakout-checked">
                <MotionNumber value={checked} />/{BREAKOUT_SYMBOLS.length}
              </b>
            </div>
            <div className="bo-stat">
              <span>{S.topGrades}</span>
              <b data-testid="breakout-top">
                <MotionNumber value={top} />
              </b>
            </div>
          </div>
        </div>
      </div>

      <p className="bo-msg" role="status" data-tone={tone} data-testid="breakout-msg">
        {msg}
        {failure && (
          <Button variant="secondary" size="sm" onClick={() => void start({ fresh: true })} data-testid="breakout-retry">
            {S.retry}
          </Button>
        )}
      </p>

      <ol className="bo-grid" data-done={done && !failure ? "" : undefined} data-testid="breakout-grid">
        {order.map((symbol, i) => {
          const row = rows[symbol] ?? { state: "pending", symbol };
          return (
            <motion.li key={symbol} className="bo-cell" layout={reduced ? false : "position"} transition={spring.layout}>
              <CoinCard row={row} index={i} selected={selected === symbol} best={bestSymbol === symbol} sessionShort={S.sessionShort[session]} onSelect={select} />
            </motion.li>
          );
        })}
      </ol>

      <Detail read={selRead} />

      <details className="bo-rules" data-testid="breakout-rules">
        <summary>{S.rulesTitle}</summary>
        <ol>
          {S.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </details>

      <div className="grid gap-1">
        <SourceStand
          source={sources.length ? sources.map((s) => S.sourceName[s]).join(" + ") : null}
          parts={[
            { label: S.standFetch, at: fetchedAt },
            { label: S.standBar, at: lastBar },
          ]}
          testId="breakout-stand"
        />
        <p className="m-0 text-[12px] leading-relaxed text-mute">{S.note}</p>
      </div>
    </section>
  );
}
