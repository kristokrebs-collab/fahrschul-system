/**
 * Pine → TradingView testen → Export hier vergleichen (F14 / F64). One card in the TradingView section (its own lazy chunk):
 * the idea of the builder becomes a readable Pine v6 strategy the trader pastes into TradingView, a link opens the chart of
 * the same market and interval, and the strategy-tester export comes back through the comparison card below.
 *
 * Honest by construction: blocks that cannot be translated are listed BY NAME (never dropped), the differences to the lab
 * run are named, and there is no login and no account access – the app only builds a text and a link, and only reads the
 * file the trader exports himself.
 */
import { useId, useMemo, useState } from "react";
import { feePreset } from "@/domain/backtest/index";
import { validateCustom } from "@/domain/lab";
import { DEFAULT_PINE_ENGINE, toPine, tvChartUrl, type PineEngine } from "@/domain/lab/pine";
import { sanitizeSignalCfg } from "@/domain/signals";
import { buttonBase, buttonSize, buttonVariant } from "@/primitives/Button";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { Input } from "@/primitives/Input";
import { cn } from "@/lib/cn";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { useLabor } from "./laborStore";
import { FieldRow } from "./ui";

export const PINE = {
  title: "Pine-Skript für TradingView",
  note: "Pine → in TradingView testen → Strategietester-Export hier vergleichen.",
  steps: [
    { t: "Pine erzeugen", d: "Aus deiner Idee im Labor entsteht ein lesbares Pine-v6-Skript mit denselben Regeln, Stop, Ziel und Verwaltung." },
    { t: "In TradingView testen", d: "Skript im Pine-Editor einfügen, „Zum Chart hinzufügen“. Der Strategietester zeigt die Trades auf den Kerzen von TradingView." },
    { t: "Export hier vergleichen", d: "Strategietester → „Liste der Trades“ → als CSV exportieren und unten laden. Das Labor legt beide Trade-Listen nebeneinander." },
  ],
  noAccess: "Kein Login und kein Zugriff auf dein TradingView-Konto: Die App erzeugt nur Text und einen Link und liest nur die Datei, die du selbst exportierst. Nichts wird an TradingView geschickt.",
  generate: "Pine-Skript erzeugen",
  hide: "Skript ausblenden",
  notCustom: "Den Pine-Export gibt es für „Eigene Idee“: nur deren Regelbaum lässt sich nach Pine übertragen. Wähle oben „Eigene Idee“ oder lade eine Strategie aus der Bibliothek.",
  hasErrors: "Die Idee hat noch Fehler. Behebe zuerst die rot markierten Punkte in der Prüfung der Idee.",
  tick: "Tick-Größe des Marktes (optional)",
  tickHint: "Nur für die Slippage: TradingView rechnet sie in Ticks. Die Größe steht in TradingView unter Symbol-Info, z. B. 0,1 für BTCUSDT.P.",
  copy: "Kopieren",
  copied: "Pine-Skript kopiert",
  copyFailed: "Kopieren war nicht möglich. Markiere den Text im Feld und kopiere ihn von Hand.",
  save: "Als Datei speichern",
  open: "Chart in TradingView öffnen",
  openHint: "Öffnet nur einen Link auf den Chart. TradingView sieht nichts von deiner Idee.",
  code: "Pine-Skript (nur lesen)",
  summary: (ok: number, all: number) => (ok === all ? `Alle ${all} Bausteine sind übersetzt.` : `${ok} von ${all} Bausteinen sind übersetzt.`),
  gapsTitle: "Nicht übersetzt – im Skript als Eingabe „als erfüllt annehmen“, Standard aus",
  gapsNote: "Bis du sie setzt, handelt das Skript nicht wie das Labor.",
  notes: "Warum die Zahlen in TradingView abweichen können",
  costsFrom: (run: boolean) => (run ? "Gebühren, Größe und Slippage stammen aus dem letzten Lauf." : "Gebühren, Größe und Slippage stammen aus den aktuellen Einstellungen (noch kein Lauf)."),
  noLink: "Für diesen Markt gibt es keinen Link.",
} as const;

async function copyText(text: string, area: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the selection route */
  }
  try {
    if (area) {
      area.focus();
      area.select();
      return document.execCommand("copy");
    }
  } catch {
    /* ignore */
  }
  return false;
}

function download(name: string, text: string): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PineCard({ className }: { className?: string }) {
  const cfg = useLabor((s) => s.cfg);
  const runCfg = useLabor((s) => s.runCfg);
  const result = useLabor((s) => s.result);
  const bars = useLabor((s) => s.bars);
  const rawSignals = useJournal((s) => s.settings.signals);
  const pushToast = useUi((s) => s.pushToast);
  const [shown, setShown] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [tickText, setTickText] = useState("");
  const area = useId();
  const [ref, setRef] = useState<HTMLTextAreaElement | null>(null);

  const costs = runCfg ?? cfg;
  const custom = cfg.strategy === "custom";
  const errors = useMemo(() => (custom ? validateCustom(cfg.custom, { funding: cfg.funding === "history" }).filter((i) => i.level === "error") : []), [custom, cfg.custom, cfg.funding]);
  const tick = Number(tickText.replace(",", "."));
  const refPrice = result && result.symbol === cfg.symbol ? bars[bars.length - 1]?.c : undefined;
  const out = useMemo(() => {
    if (!shown || !custom || errors.length) return null;
    const engine: PineEngine = {
      ...DEFAULT_PINE_ENGINE,
      capital: costs.capital,
      riskPct: costs.riskPct,
      maxLeverage: costs.maxLeverage,
      makerBps: feePreset(costs.exchange).makerBps,
      takerBps: feePreset(costs.exchange).takerBps,
      slippage: costs.slippage,
      funding: costs.funding,
    };
    return toPine(cfg.custom, { symbol: cfg.symbol, signal: sanitizeSignalCfg(rawSignals), engine, tick: Number.isFinite(tick) && tick > 0 ? tick : undefined, refPrice });
  }, [shown, custom, errors.length, cfg.custom, cfg.symbol, costs, rawSignals, tick, refPrice]);
  const link = tvChartUrl(cfg.symbol, cfg.custom.interval);

  return (
    <Card title={PINE.title} note={PINE.note} className={className} data-testid="labor-pine">
      <div className="grid gap-4">
        <ol className="grid gap-2 sm:grid-cols-3" data-testid="labor-pine-steps">
          {PINE.steps.map((s, i) => (
            <li key={s.t} className="grid content-start gap-1 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3">
              <span className="num font-mono text-[11px] text-faint">Schritt {i + 1}</span>
              <span className="text-[13px] font-semibold">{s.t}</span>
              <span className="text-[12px] leading-relaxed text-mute">{s.d}</span>
            </li>
          ))}
        </ol>
        <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute" data-testid="labor-pine-noaccess">
          {PINE.noAccess}
        </p>

        {!custom ? (
          <p className="text-[12.5px] text-mute" data-testid="labor-pine-notcustom">
            {PINE.notCustom}
          </p>
        ) : errors.length ? (
          <p role="status" className="text-[12.5px] text-warn" data-testid="labor-pine-errors">
            {PINE.hasErrors}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={shown ? "ghost" : "primary"} onClick={() => setShown((s) => !s)} aria-expanded={shown} data-testid="labor-pine-make">
              {shown ? PINE.hide : PINE.generate}
            </Button>
            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" className={cn(buttonBase, buttonSize.sm, buttonVariant.ghost, "touch-hit")} data-testid="labor-pine-open">
                {PINE.open}
              </a>
            ) : (
              <span className="text-[12px] text-faint">{PINE.noLink}</span>
            )}
            <span className="text-[11.5px] text-faint">{PINE.openHint}</span>
          </div>
        )}

        {out && (
          <div className="grid gap-4" data-testid="labor-pine-result">
            <p className="text-[12.5px]" data-testid="labor-pine-summary">
              {PINE.summary(out.translated, out.total)} <span className="text-mute">{PINE.costsFrom(!!runCfg)}</span>
            </p>
            {out.gaps.length > 0 && (
              <div className="grid gap-1.5 rounded-xl border border-warn/30 bg-warn/[0.05] px-3.5 py-3" data-testid="labor-pine-gaps">
                <h3 className="text-[12.5px] font-semibold text-warn">{PINE.gapsTitle}</h3>
                <ul className="grid gap-1.5">
                  {out.gaps.map((g) => (
                    <li key={g.id} className="text-[12px] leading-snug" data-gap={g.block}>
                      <span className="font-semibold">{g.label}</span> <span className="text-mute">({g.side === "long" ? "Long" : "Short"}, {g.id}): {g.text}.</span> <span className="text-mute">{g.reason}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11.5px] text-faint">{PINE.gapsNote}</p>
              </div>
            )}
            <FieldRow label={PINE.tick} htmlFor={`${area}-tick`} hint={PINE.tickHint} className="max-w-[16rem]">
              <Input id={`${area}-tick`} numeric value={tickText} placeholder="z. B. 0,1" onChange={(e) => setTickText(e.target.value)} autoComplete="off" data-testid="labor-pine-tick" />
            </FieldRow>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    void copyText(out.code, ref).then((ok) => pushToast(ok ? { kind: "success", title: PINE.copied } : { kind: "error", title: PINE.copyFailed }))
                  }
                  data-testid="labor-pine-copy"
                >
                  {PINE.copy}
                </Button>
                <Button size="sm" onClick={() => download(out.fileName, out.code)} data-testid="labor-pine-save">
                  {PINE.save}
                </Button>
                <span className="num font-mono text-[11px] text-faint">{out.fileName}</span>
              </div>
              <label htmlFor={area} className="sr-only">
                {PINE.code}
              </label>
              <textarea
                id={area}
                ref={setRef}
                readOnly
                value={out.code}
                spellCheck={false}
                rows={14}
                className="max-h-[28rem] w-full resize-y rounded-xl border border-line bg-ink-950/70 p-3 font-mono text-[11.5px] leading-relaxed text-fg/90 outline-none focus:border-white/40"
                data-testid="labor-pine-code"
              />
            </div>
            <div className="grid gap-2">
              <button type="button" className="touch-hit justify-self-start text-[12px] text-mute hover:text-fg" aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)} data-testid="labor-pine-notes-toggle">
                {notesOpen ? "− " : "+ "}
                {PINE.notes}
              </button>
              <Collapse open={notesOpen}>
                <ul className="grid list-disc gap-1.5 pl-4 text-[12px] leading-relaxed text-mute marker:text-faint" data-testid="labor-pine-notes">
                  {out.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </Collapse>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
