/**
 * „Daten- und Alarmqualität“ (F27): a check report on what the app can know about its own data and alerts – how long the app was
 * actually open (alerts run only then), the periods it was closed, the delay between a candle's close and the alert, duplicate and
 * held-back alerts (Zustellprotokoll) and, on request, holes in the candle feed. Pure numbers from `@/domain/missed/quality`; the
 * traces are the presence beat (`@/market/presence`), the signal archive and the delivery log.
 *
 * What is unknown is shown as „unbekannt“, never filled in: the presence trace starts the day it is first written.
 */
import { useMemo, useState } from "react";
import { durationText, qualityReport, QUALITY_WINDOW_DAYS, SLOW_ALERT_MS, type GapCheck } from "@/domain/missed";
import { pct0 } from "@/lib/format";
import { useDeliveryLog } from "@/market/keylevels/deliveryLog";
import { presenceSegments } from "@/market/presence";
import { useSignalArchive } from "@/market/signalArchive";
import { tvSymbolToBinance } from "@/market/symbol";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { stamp } from "./signalUi";
import { KV, SampleLine } from "./ui";

export const QUALITY_STRINGS = {
  title: "Daten- und Alarmqualität",
  note: "Was die App über ihre eigenen Alarme und Kerzen weiß – Lücken, Verspätung, Ausfälle.",
  banner: "Alarme laufen nur bei offener App. Ist der Tab zu, der Browser beendet oder das Gerät im Schlaf, entsteht kein Signal und kein Alarm – es gibt keine Überwachung auf einem Server.",
  unknownShare: "Zeitanteil, in dem die App offen war: unbekannt. Die Aufzeichnung dazu beginnt erst jetzt und füllt sich, solange die App läuft; Vergangenes lässt sich nicht ableiten.",
  noDelay: "Noch kein Alarm mit bekanntem Kerzenschluss gespeichert – die Verspätung lässt sich erst danach lesen.",
  delayNote: "Verspätung = Alarmzeit minus Schluss der Kerze, auf der das Signal beruht. Beim Einstiegs-Check sind darin die 60 Sekunden Wartezeit gegen Nachzeichnen enthalten; eine falsch gehende Geräteuhr zeigt sich hier ebenfalls als Verspätung.",
  logNote: "Das Zustellprotokoll hält nur die letzten 200 Zeilen auf diesem Gerät.",
  gapsHint: "Lädt die Stunden-Kerzen der letzten 14 Tage deiner Signal-Märkte und sucht Lücken. Ob eine Lücke an der Börse (Wartung, kein Handel) oder an der Verbindung liegt, sagt die Prüfung nicht.",
  gapsNone: "Noch nicht geprüft.",
  noMarkets: "Es gibt noch keinen Markt zum Prüfen – sobald die App Signale festhält oder ein Markt gewählt ist, steht er hier.",
} as const;

const ms = (v: number | null): string => durationText(v);

function GapRows({ g }: { g: GapCheck }) {
  return (
    <li className="grid gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid="quality-gap" data-symbol={g.symbol} data-missing={g.missing}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="num font-mono text-[12.5px] text-fg">{g.symbol}</span>
        <SampleLine n={g.bars} />
      </div>
      {g.error ? (
        <p className="text-[11.5px] leading-snug text-warn">{g.error}</p>
      ) : g.gaps.length === 0 ? (
        <p className="text-[11.5px] leading-snug text-mute">Keine Lücke: {g.bars} Stunden-Kerzen, lückenlos.</p>
      ) : (
        <>
          <p className="text-[11.5px] leading-snug text-mute">
            {g.gaps.length} Lücke{g.gaps.length === 1 ? "" : "n"}, zusammen {g.missing} fehlende Kerze{g.missing === 1 ? "" : "n"}.
          </p>
          <ul className="grid gap-0.5">
            {g.gaps.slice(0, 5).map((x) => (
              <li key={x.from} className="num font-mono text-[11px] text-faint">
                {stamp(x.from)} bis {stamp(x.to)} · {x.missing} Kerze{x.missing === 1 ? "" : "n"}
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

export function DataQualityCard({ now, className }: { now: number; className?: string }) {
  const events = useSignalArchive();
  const log = useDeliveryLog();
  const marketSymbol = useJournal((s) => s.settings.market?.symbol);
  const [gaps, setGaps] = useState<GapCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // the presence trace is read on every render (cheap; the page re-renders with its minute clock) – it is a stored trace, not state
  const rep = qualityReport({ now, events, log, presence: presenceSegments(), gaps });
  const markets = useMemo(() => {
    const own = marketSymbol ? tvSymbolToBinance(marketSymbol) : "";
    return [...new Set([...(own ? [own] : []), ...events.filter((e) => e.at >= rep.from).map((e) => e.symbol)])].filter(Boolean);
  }, [events, marketSymbol, rep.from]);
  const p = rep.presence;
  const d = rep.delivery;
  const check = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { checkCandleGaps } = await import("./candleCheck");
      setGaps(await checkCandleGaps(markets));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={QUALITY_STRINGS.title} note={QUALITY_STRINGS.note} className={className} data-testid="quality-card" innerClassName="grid content-start gap-4">
      <p className="rounded-xl border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12.5px] leading-snug text-warn" role="note" data-testid="quality-banner">
        {QUALITY_STRINGS.banner}
      </p>

      <section className="grid gap-1" aria-label="Offene App">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">App offen · letzte {QUALITY_WINDOW_DAYS} Tage</h3>
        {p.known && p.share != null ? (
          <div data-testid="quality-presence" data-share={p.share.toFixed(3)}>
            <KV label="Zeitanteil offen" value={pct0(p.share)} />
            <KV label="Aufgezeichnet seit" value={p.since ? stamp(p.since) : "–"} />
            <KV label="Zu (Pausen ab 10 Min)" value={`${p.outageCount} · zusammen ${ms(p.outageMs)}`} />
            {p.outages.length > 0 && (
              <ul className="mt-1 grid gap-0.5" aria-label="Zeiträume ohne offene App">
                {p.outages.map((o) => (
                  <li key={o.from} className="num font-mono text-[11px] text-faint" data-testid="quality-outage">
                    {stamp(o.from)} bis {p.running || o.to < rep.to ? stamp(o.to) : "jetzt"} · {ms(o.ms)}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[11px] leading-snug text-faint">Die Aufzeichnung beginnt am {p.since ? stamp(p.since) : "–"}; davor ist es unbekannt, nicht „zu“.</p>
          </div>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-mute" data-testid="quality-presence-unknown">
            {QUALITY_STRINGS.unknownShare}
          </p>
        )}
      </section>

      <section className="grid gap-1" aria-label="Verspätung der Alarme">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">Verspätung · Kerzenschluss bis Alarm</h3>
        {rep.delays.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-mute" data-testid="quality-nodelay">
            {QUALITY_STRINGS.noDelay}
          </p>
        ) : (
          <div data-testid="quality-delays">
            {rep.delays.map((r) => (
              <div key={r.source} className="grid gap-0.5 border-b border-line/70 py-1.5 last:border-b-0" data-source={r.source}>
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="text-mute">{r.label}</span>
                  <span className="num font-mono text-fg">Median {ms(r.median)}</span>
                </div>
                <p className="num font-mono text-[10.5px] text-faint">
                  n {r.n}
                  {r.p90 != null ? ` · 90 % unter ${ms(r.p90)}` : " · zu wenig für 90 %"} · längste {ms(r.max)} · über {ms(SLOW_ALERT_MS)}: {r.slow}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-snug text-faint">{QUALITY_STRINGS.delayNote}</p>
      </section>

      <section className="grid gap-1" aria-label="Zustellprotokoll">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">Zustellung · letzte {QUALITY_WINDOW_DAYS} Tage</h3>
        {d.lines === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-mute" data-testid="quality-nolog">
            Das Zustellprotokoll hat in diesem Zeitraum keine Zeile.
          </p>
        ) : (
          <div data-testid="quality-delivery" data-sent={d.sent} data-duplicate={d.duplicate} data-hours={d.hours}>
            <KV label="Gesendet" value={d.sent} />
            <KV label="Doppelte unterdrückt" value={d.duplicate} />
            <KV label="Abgelehnt: außerhalb der Aktivzeit" value={d.hours} />
            <KV label="Abgelehnt: kein passender Kanal" value={d.channels} />
            <KV label="Mehrfach gesendet (gleicher Schlüssel)" value={d.repeated} tone={d.repeated > 0 ? "warn" : "fg"} />
          </div>
        )}
        <p className="text-[11px] leading-snug text-faint">
          {QUALITY_STRINGS.logNote}
          {d.oldest != null ? ` Älteste Zeile: ${stamp(d.oldest)}.` : ""}
          {d.truncated ? " Das Fenster reicht weiter zurück – ältere Zeilen fehlen." : ""}
        </p>
      </section>

      <section className="grid gap-2" aria-label="Kerzen-Lücken">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">Kerzen-Feed</h3>
        {markets.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-mute">{QUALITY_STRINGS.noMarkets}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void check()} disabled={busy} data-testid="quality-check">
              {busy ? "Prüfe …" : gaps ? "Erneut prüfen" : "Kerzen prüfen"}
            </Button>
            <span className="num font-mono text-[11px] text-faint">{markets.slice(0, 5).join(" · ")}</span>
          </div>
        )}
        {failed && (
          <p role="status" className="text-[11.5px] text-warn">
            Die Prüfung ist fehlgeschlagen – bitte noch einmal versuchen.
          </p>
        )}
        {gaps ? (
          <ul className="grid gap-2" aria-label="Ergebnis der Kerzenprüfung">
            {gaps.map((g) => (
              <GapRows key={g.symbol} g={g} />
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] leading-snug text-faint">{QUALITY_STRINGS.gapsNone} {QUALITY_STRINGS.gapsHint}</p>
        )}
      </section>
    </Card>
  );
}
