/**
 * „Warum handeln oder auslassen?“ (F10) inside the Einstiegs-Check: the verdict in one line (always visible) and, opened,
 * four separate groups – Pflichtbedingungen, Optionale Bestätigungen, Widersprüche, Fehlende Daten – each row with a
 * plain-language reason, plus the „zu spät“ verdict (the price already ran more than X of the planned risk past the
 * trigger; X is the user's, default 0,5 R). A high score never overrides a failed required condition – the note says so.
 */
import { useMemo, useState } from "react";
import { explainDecision, lateMaxROf, withLateMaxR, type Decision, type RowStatus, type WhyRow } from "@/domain/decision";
import { signalBarOpen, usePriceSnapshot, getSignalCandles, type LiveSignals } from "@/market";
import type { Side } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { n1 } from "@/lib/format";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Collapse, Expander } from "@/primitives/Expander";
import { Segmented } from "@/primitives/Segmented";
import { lageSettingsOf } from "@/domain/lage";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { TestIdeaButton } from "@/views/labor/TestIdeaButton";
import { triggerClose, whyInput } from "./whyView";

export const WHY_ID = "why-section";
const PILL: Record<Decision, { label: string; tone: BadgeTone }> = {
  trade: { label: "Handeln", tone: "win" },
  caution: { label: "Vorsicht", tone: "warn" },
  skip: { label: "Auslassen", tone: "loss" },
  unclear: { label: "Unklar", tone: "mute" },
};
const GLYPH: Record<RowStatus, { g: string; cls: string; word: string }> = {
  met: { g: "✓", cls: "bg-win/20 text-win", word: "erfüllt: " },
  unmet: { g: "✕", cls: "bg-loss/15 text-loss", word: "nicht erfüllt: " },
  unknown: { g: "?", cls: "bg-warn/15 text-warn", word: "keine Daten: " },
  conflict: { g: "!", cls: "bg-warn/15 text-warn", word: "Widerspruch: " },
};
const LATE_PRESETS = [0.25, 0.5, 0.75, 1];

function Group({ title, rows, empty, testId }: { title: string; rows: readonly WhyRow[]; empty: string; testId: string }) {
  return (
    <div className="grid content-start gap-1.5" data-testid={testId}>
      <h4 className="label">
        {title} <span className="num text-faint">· {rows.length}</span>
      </h4>
      {rows.length === 0 ? (
        <p className="text-[12px] text-faint">{empty}</p>
      ) : (
        <ul className="grid gap-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-[12.5px] leading-snug" data-status={r.status}>
              <span aria-hidden="true" className={cn("mt-px grid size-4 shrink-0 place-items-center rounded-full text-[9.5px] font-bold", GLYPH[r.status].cls)}>
                {GLYPH[r.status].g}
              </span>
              <span className="min-w-0">
                <span className="sr-only">{GLYPH[r.status].word}</span>
                <span className="text-fg">{r.label}</span>
                <span className="text-mute"> – {r.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WhySection({ snap, side, feed }: { snap: LiveSignals; side: Side; feed: "loading" | "ok" | "stale" | "offline" }) {
  const [open, setOpen] = useState(false);
  const { price } = usePriceSnapshot(1000);
  const maxLateR = useJournal((s) => lateMaxROf(s.settings.signals));
  const lageOn = useJournal((s) => lageSettingsOf(s.settings.signals).on);
  const pushToast = useUi((s) => s.pushToast);
  // the reference entry = close of the signal candle (a vorläufig signal has none yet)
  const trigger = useMemo(() => {
    const base = snap.cfg.ladder[0];
    if (!base) return null;
    return triggerClose(getSignalCandles(base, { bars: 60 }), signalBarOpen(snap, side));
  }, [snap, side]);
  const why = useMemo(() => explainDecision(whyInput(snap, side, { feed, lageOn, maxLateR, trigger, price })), [snap, side, feed, lageOn, maxLateR, trigger, price]);
  const pill = PILL[why.decision];
  const presets = LATE_PRESETS.includes(maxLateR) ? LATE_PRESETS : [...LATE_PRESETS, maxLateR].sort((a, b) => a - b);

  const setLate = async (v: number) => {
    const { settings, saveSettings } = useJournal.getState();
    const signals = withLateMaxR(settings.signals, v);
    if (signals === settings.signals) return;
    try {
      await saveSettings({ ...settings, signals });
    } catch {
      pushToast({ kind: "error", title: "Speichern fehlgeschlagen" });
    }
  };

  return (
    <section className="grid gap-2" aria-label="Warum handeln oder auslassen?" data-testid={WHY_ID} data-decision={why.decision}>
      <div className="flex items-center gap-3">
        <h3 className="label flex-1">Warum handeln oder auslassen?</h3>
        <Badge tone={pill.tone} dot>
          {pill.label}
        </Badge>
        <Expander open={open} onToggle={() => setOpen((o) => !o)} label="Warum handeln oder auslassen?" controls={`${WHY_ID}-body`} />
      </div>
      <p className="text-[13px] leading-snug text-fg" data-testid="why-headline">
        {why.headline}
        <span className="text-mute"> – {why.summary}</span>
      </p>
      <Collapse open={open} id={`${WHY_ID}-body`}>
        <div className="grid gap-4 pt-1">
          <div className="grid gap-4 md:grid-cols-2">
            <Group title="Pflichtbedingungen" rows={why.required} empty="Keine Pflichtbedingung bewertbar." testId="why-required" />
            <Group title="Optionale Bestätigungen" rows={why.optional} empty="Keine." testId="why-optional" />
            <Group title="Widersprüche" rows={why.contradictions} empty="Kein Widerspruch." testId="why-conflicts" />
            <Group title="Fehlende Daten" rows={why.missing} empty="Nichts fehlt." testId="why-missing" />
          </div>
          <div className={cn("grid gap-1.5 rounded-xl border px-3 py-2.5", why.late.status === "late" ? "border-loss/40 bg-loss/[0.05]" : "border-line bg-ink-950/40")} data-testid="why-late" data-status={why.late.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="label">Rechtzeitig?</h4>
              <div className="flex items-center gap-2">
                <span id="why-late-l" className="text-[11px] text-faint">
                  Zu spät ab (Anteil des geplanten Risikos)
                </span>
                <Segmented<string> aria-labelledby="why-late-l" size="sm" value={String(maxLateR)} onChange={(v) => void setLate(Number(v))} options={presets.map((p) => ({ v: String(p), label: `${n1(p)} R` }))} />
              </div>
            </div>
            <p className="text-[12.5px] leading-snug text-mute">{why.late.text}</p>
          </div>
          {why.scoreNote && (
            <p className="text-[12px] leading-snug text-mute" data-testid="why-score-note">
              {why.scoreNote}
            </p>
          )}
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-line pt-3" data-testid="why-test-idea">
            <TestIdeaButton input={{ kind: "signal", symbol: snap.symbol, baseTf: snap.cfg.ladder[0] ?? null, verdict: snap[side] }} testId="signal-to-lab" />
            <p className="min-w-0 flex-1 basis-56 text-[11.5px] leading-snug text-faint">Legt die Regeln dieses Einstiegs-Checks als „Eigene Idee“ ins Labor, mit allem, was dort nicht abbildbar ist. Gestartet oder gespeichert wird nichts.</p>
          </div>
        </div>
      </Collapse>
    </section>
  );
}
