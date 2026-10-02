import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { heroTileValue } from "@/domain/explain";
import { CONFIG } from "@/intro/introConfig";
import { createDirector, type Director } from "@/intro/director";
import { n0, pct0 } from "@/lib/format";
import { priceMv } from "@/market/motionValues";
import { tvSymbolToBinance } from "@/market/symbol";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { PixelTextFill } from "@/motion/pulse/PixelTextFill";
import { Typewriter } from "@/motion/pulse/Typewriter";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

export interface IntroStageProps {
  /** stage covers the app (true) or only the skip pill remains while the journal builds itself (false) */
  covering: boolean;
  directorRef: RefObject<Director | null>;
  onBuild(): void;
  onDone(): void;
  onSkip(): void;
}

interface Reel {
  label: string;
  value: string;
  unit?: string;
  tone?: "win" | "loss";
}

const GRID_BG = `radial-gradient(circle at ${CONFIG.stage.gridDot}px ${CONFIG.stage.gridDot}px, ${CONFIG.stage.gridColor} ${CONFIG.stage.gridDot}px, transparent ${CONFIG.stage.gridDot + 0.5}px)`;
const WORDMARK_FONT = "font-dot font-extrabold leading-none tracking-[-0.02em] text-[clamp(52px,min(16vw,12.5vh),136px)]";

const plural = (n: number, one: string, many: string) => `${n0(n)} ${n === 1 ? one : many}`;

/** "13 Trades · 4 Grundlagen · BTCUSDT 86.100" from the loaded journal and the live price (when one has arrived). */
export function introDataLine(trades: number, setups: number, symbol: string, price: number): string {
  const parts = [plural(trades, "Trade", "Trades"), plural(setups, "Grundlage", "Grundlagen")];
  parts.push(price > 0 ? `${symbol} ${n0(Math.round(price))}` : symbol);
  return parts.join(" · ");
}

function useReels(): Reel[] {
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const cur = useJournal((s) => s.settings.currency);
  const symbol = useJournal((s) => tvSymbolToBinance(s.settings.market.symbol));
  return useMemo(() => {
    const g = view.g;
    const price = priceMv.get();
    const reels: Reel[] = [
      { label: "Netto-P&L", value: heroTileValue("net", view), unit: cur, tone: g.net > 0 ? "win" : g.net < 0 ? "loss" : undefined },
      { label: "Win-Rate", value: pct0(g.winRate) },
      { label: "Profit-Faktor", value: heroTileValue("pf", view) },
      { label: "Ø R", value: heroTileValue("avgR", view) },
      { label: "Max. Drawdown", value: heroTileValue("maxDD", view) },
      { label: "Trades", value: String(g.n) },
      price > 0 ? { label: symbol, value: n0(Math.round(price)), unit: "Live" } : { label: "Erwartungswert", value: heroTileValue("exp", view), unit: cur },
    ];
    return reels;
  }, [view, cur, symbol]);
}

/** The data line, frozen once typing starts (the typewriter reserves the final box). Waits briefly for the journal. */
function useDataLine(go: boolean): string | null {
  const loaded = useJournal((s) => s.loaded);
  const trades = useJournal((s) => s.trades.length);
  const setups = useJournal((s) => s.settings.setups.length);
  const symbol = useJournal((s) => tvSymbolToBinance(s.settings.market.symbol));
  const [line, setLine] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!go || loaded) return;
    const id = window.setTimeout(() => setTimedOut(true), CONFIG.type.waitMax);
    return () => window.clearTimeout(id);
  }, [go, loaded]);
  if (go && line === null && (loaded || timedOut)) {
    const next = loaded ? introDataLine(trades, setups, symbol, priceMv.get()) : "Journal wird geladen";
    setLine(next);
    return next;
  }
  return line;
}

/**
 * Full-screen intro stage (portal to body, outside the inert app root): Nothing dot grid, signal dot + rotating marker
 * in the "O", AsciiCascade wordmark, PixelTextFill statement, typed data line, reel window with the user's KPIs and
 * the canvas for the glyph-portal dive. All motion is written by the director (director.ts); React renders only the
 * content and the discrete beats.
 */
export function IntroStage({ covering, directorRef, onBuild, onDone, onSkip }: IntroStageProps) {
  const [ready, setReady] = useState(false);
  const [typeGo, setTypeGo] = useState(false);
  const reels = useReels();
  const dataLine = useDataLine(typeGo);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const statementRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const reelsRef = useRef<(HTMLDivElement | null)[]>([]);
  const markerRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const pingsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const squareRef = useRef<HTMLSpanElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const textTopRef = useRef<HTMLDivElement>(null);
  const textBottomRef = useRef<HTMLDivElement>(null);
  const events = useRef({ onBuild, onDone });
  useLayoutEffect(() => {
    events.current = { onBuild, onDone };
  });

  // the wordmark is measured for the canvas: wait for Doto (capped, never blocks the intro)
  useEffect(() => {
    let live = true;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const go = () => live && setReady(true);
    const cap = window.setTimeout(go, 450);
    Promise.all([fonts?.load('800 64px "Doto"'), fonts?.load('500 20px "IBM Plex Sans"'), fonts?.load('500 12px "IBM Plex Mono"')])
      .catch(() => undefined)
      .then(go);
    return () => {
      live = false;
      window.clearTimeout(cap);
    };
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    const need = [overlayRef, gridRef, canvasRef, sceneRef, groupRef, topRef, bottomRef, statementRef, winRef, glowRef, markerRef, dotRef, squareRef, pillRef, textTopRef, textBottomRef].map((x) => x.current);
    if (need.some((x) => !x)) return;
    const d = createDirector(
      {
        overlay: overlayRef.current!,
        grid: gridRef.current!,
        canvas: canvasRef.current!,
        scene: sceneRef.current!,
        group: groupRef.current!,
        top: topRef.current!,
        bottom: bottomRef.current!,
        statement: statementRef.current!,
        win: winRef.current!,
        glow: glowRef.current!,
        reels: reelsRef.current.filter((x): x is HTMLDivElement => !!x),
        marker: markerRef.current!,
        dot: dotRef.current!,
        pings: pingsRef.current.filter((x): x is HTMLSpanElement => !!x),
        square: squareRef.current!,
        pill: pillRef.current!,
        textTop: textTopRef.current!,
        textBottom: textBottomRef.current!,
      },
      { onType: () => setTypeGo(true), onBuild: () => events.current.onBuild(), onDone: () => events.current.onDone() },
    );
    directorRef.current = d;
    return () => {
      d.destroy();
      if (directorRef.current === d) directorRef.current = null;
    };
    // refs are stable; the director lives as long as the stage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (covering) overlayRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div role="dialog" aria-modal={covering || undefined} aria-label="Intro" data-intro-stage="" className="pointer-events-none fixed inset-0 z-[95]">
      <div
        ref={overlayRef}
        tabIndex={-1}
        data-intro-overlay=""
        className="pointer-events-auto absolute inset-0 overflow-hidden outline-none [contain:strict]"
        style={{ background: CONFIG.stage.bg, pointerEvents: covering ? "auto" : "none" }}
        onPointerDown={(e) => {
          if (e.button === 0) onSkip();
        }}
      >
        <div ref={gridRef} aria-hidden="true" className="absolute inset-0" style={{ opacity: 0, backgroundImage: GRID_BG, backgroundSize: `${CONFIG.stage.gridPitch}px ${CONFIG.stage.gridPitch}px` }} />
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" style={{ visibility: "hidden" }} />
        {ready && (
          <div ref={sceneRef} aria-hidden="true" className="absolute inset-0 flex items-center justify-center px-4">
            <div ref={groupRef} className="relative flex flex-col items-center will-change-transform">
              <div ref={topRef} className="relative will-change-transform">
                <div ref={textTopRef}>
                  <AsciiCascade text={CONFIG.wordmark.top} drop={CONFIG.wordmark.drop} seed={11} className={WORDMARK_FONT} />
                </div>
              </div>
              <div ref={winRef} className="pointer-events-none absolute overflow-hidden rounded-[18px] border border-line-2 bg-ink-900 [container-type:size]" style={{ visibility: "hidden", transform: "scale(1,0.002)" }}>
                <div className="absolute inset-0 opacity-60" style={{ backgroundImage: GRID_BG, backgroundSize: "16px 16px" }} />
                {reels.map((reel, i) => (
                  <div
                    key={i}
                    ref={(el) => void (reelsRef.current[i] = el)}
                    className="absolute inset-0 flex flex-col justify-between p-[5cqw]"
                    style={{ visibility: "hidden" }}
                  >
                    <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                      <span>{reel.label}</span>
                      <span>
                        {String(i + 1).padStart(2, "0")} / {String(reels.length).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className={`font-dot font-extrabold leading-none tracking-[-0.03em] text-[min(12cqw,30cqh)] ${reel.tone === "win" ? "text-win" : reel.tone === "loss" ? "text-loss" : "text-fg"}`}>
                        {reel.value}
                      </span>
                      {reel.unit && <span className="font-sans text-[clamp(13px,1.4vw,17px)] font-medium text-mute">{reel.unit}</span>}
                    </div>
                  </div>
                ))}
                <div ref={glowRef} className="absolute inset-0 rounded-[18px]" style={{ opacity: 0, boxShadow: "inset 0 0 42px rgba(229,32,46,0.2)" }} />
              </div>
              <div ref={bottomRef} className="relative flex flex-col items-center will-change-transform">
                <div ref={textBottomRef} className="relative">
                  <AsciiCascade text={CONFIG.wordmark.bottom} drop={CONFIG.wordmark.drop} seed={23} className={WORDMARK_FONT} />
                  <div ref={markerRef} className="absolute h-0 w-0">
                    <span ref={squareRef} className="absolute left-0 top-0 block" style={{ opacity: 0, border: `${CONFIG.square.border}px solid ${CONFIG.square.color}` }} />
                    {CONFIG.signal.pings.map((_, i) => (
                      <span
                        key={i}
                        ref={(el) => void (pingsRef.current[i] = el)}
                        className="absolute left-0 top-0 block rounded-full"
                        style={{ width: CONFIG.signal.dotPx, height: CONFIG.signal.dotPx, opacity: 0, border: `1px solid ${CONFIG.signal.color}` }}
                      />
                    ))}
                    <span
                      ref={dotRef}
                      className="absolute left-0 top-0 block rounded-full"
                      style={{ width: CONFIG.signal.dotPx, height: CONFIG.signal.dotPx, background: CONFIG.signal.color, boxShadow: "0 0 12px rgba(229,32,46,0.65)", transform: "translate(-50%,-50%) scale(0)" }}
                    />
                  </div>
                </div>
                <div ref={statementRef} className="flex flex-col items-center gap-3" style={{ marginTop: `calc(${CONFIG.wordmark.drop}em + 0.2em)`, fontSize: "clamp(52px,min(16vw,12.5vh),136px)" }}>
                  <PixelTextFill lines={[CONFIG.statement.text]} delay={CONFIG.statement.delay} speed={CONFIG.statement.speed} align="center" className="text-center font-sans text-[clamp(18px,2.3vw,28px)] font-medium tracking-[-0.01em]" />
                  <span className="block min-h-[1.4em] font-mono text-[clamp(11px,1.1vw,13px)] uppercase tracking-[0.12em] text-mute">
                    {dataLine !== null && <Typewriter text={dataLine} msPerChar={CONFIG.type.msPerChar} align="center" />}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <button
        ref={pillRef}
        type="button"
        onClick={onSkip}
        className="pointer-events-auto absolute bottom-[100px] right-4 rounded-full border border-line-2 bg-ink-900/85 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-mute transition-colors duration-150 hover:border-white/40 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel sm:bottom-6 sm:right-6"
        style={{ opacity: 0 }}
      >
        Überspringen
      </button>
    </div>,
    document.body,
  );
}
