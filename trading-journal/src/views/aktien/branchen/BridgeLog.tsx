import { industryName } from "@/domain/industryTrend/config";
import { brancheOfSymbol, type BridgeOutcome } from "@/domain/industryTrend/bridge";
import { date as fmtDate, time as fmtTime } from "@/lib/format";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Mini } from "../ui";
import { useBridge } from "./signalBridge";

const WORD: Record<BridgeOutcome, { label: string; tone: BadgeTone }> = {
  opened: { label: "Position eröffnet", tone: "win" },
  duplicate: { label: "schon vorhanden", tone: "mute" },
  refused: { label: "nicht eröffnet", tone: "warn" },
  closed: { label: "geschlossen", tone: "win" },
  "nothing-to-close": { label: "nichts zu schließen", tone: "mute" },
  ignored: { label: "ignoriert", tone: "mute" },
};

/**
 * What the bridge did with the Branchen-Signale that arrived at the TradingView address (B3 → C1): one line per signal, newest first, with the
 * reason in words. Paper only. Shown only once there is something to show; signals that still wait (candles could not be loaded) are said too.
 */
export function BridgeLog() {
  const entries = useBridge((s) => s.log.entries);
  const waiting = useBridge((s) => s.waiting);
  const running = useBridge((s) => s.running);
  const list = entries.slice(-6).reverse();
  const waits = Object.values(waiting);
  if (!list.length && !waits.length && !running) return null;
  return (
    <section aria-labelledby="paper-bridge-h" className="grid gap-2" data-testid="paper-bridge">
      <Mini>
        <span id="paper-bridge-h">Signale von TradingView</span>
      </Mini>
      <p className="text-[12px] text-faint">Was die Papier-Brücke mit angekommenen Branchen-Signalen gemacht hat. Sie arbeitet nur, solange die App offen ist; es wird nichts gesendet. Veraltete Signale werden ignoriert.</p>
      {running && (
        <p className="text-[12.5px] text-mute" role="status" data-testid="paper-bridge-running">
          Ein Signal wird gerade geprüft …
        </p>
      )}
      {waits.length > 0 && (
        <p className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[12.5px] leading-snug text-fg" role="status" data-testid="paper-bridge-waiting">
          {waits.length === 1 ? "Ein Signal wartet" : `${waits.length} Signale warten`}: {waits[0]} Beim nächsten Abruf wird es erneut versucht.
        </p>
      )}
      {list.length > 0 && (
        <ul className="grid gap-1.5" data-testid="paper-bridge-list">
          {list.map((e) => {
            const w = WORD[e.outcome];
            const code = brancheOfSymbol(e.symbol);
            return (
              <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12.5px]" data-testid="paper-bridge-entry" data-outcome={e.outcome}>
                <span className="min-w-0 truncate font-medium text-fg">
                  {e.symbol ?? "?"}
                  {code ? ` · ${industryName(code)}` : ""}
                  {e.state ? ` · ${e.state === "gruen" ? "grün" : "rot"}` : ""}
                </span>
                <Badge tone={w.tone} className="justify-self-end">
                  {w.label}
                </Badge>
                <span className="col-span-2 text-[11.5px] leading-snug text-mute">{e.note}</span>
                <span className="num col-span-2 text-[11px] text-faint">
                  {fmtDate(new Date(e.at))} {fmtTime(new Date(e.at))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
