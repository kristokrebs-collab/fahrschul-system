/**
 * Kaufthese (F69): the long-term thesis card. A list of the person's theses (`settings.theses`, versioned, mergeable per thesis
 * and per version), one editor with: own reason, horizon, catalysts / risks / counter-arguments, buy zone, typed price with its
 * source, next report date (typed – the app does not know it), review date; scenarios Bär / Basis / Bulle through the DCF; the
 * conditions that would refute the thesis as checkable thresholds; the check against the filed numbers of the newest quarter
 * (only while the app is open) with source and stand; versions with what changed.
 *
 * The thesis text, prices, rates and dates are the person's own and are never rewritten; everything computed carries its
 * assumptions or its SEC source. A triggered condition produces a PROPOSAL to look again and to save a version – nothing changes
 * by itself. No order, no recommendation. Lazy-ready: `lazy(() => import("@/views/analyst/ThesisPanel"))`.
 */
import { useCallback, useMemo, useState } from "react";
import { newThesis, thesesCfgOf, updateThesis, type Thesis, type ThesisPatch } from "@/domain/thesis";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { normalizeTicker } from "@/market/sec";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { Sub } from "./parts";
import { ThesisEditor } from "./ThesisEditor";
import { TH } from "./strings";
import { useThesisMonitor, writeTheses } from "./thesisStore";
import type { ThesisPanelProps } from "./types";

/** The section anchors of the editor (`data-section`), for a host's `SectionNav`. */
export const THESIS_SECTIONS = [
  { id: "thesis-text", label: "Begründung" },
  { id: "thesis-scenarios", label: "Szenarien" },
  { id: "thesis-checks", label: "Widerlegen" },
  { id: "thesis-versions", label: "Versionen" },
] as const;

export function ThesisPanel({ ticker: tickerProp = "", now = Date.now, monitor = true, className, bare, fetchImpl }: ThesisPanelProps) {
  const raw = useJournal((s) => s.settings.theses);
  const cfg = useMemo(() => thesesCfgOf(raw), [raw]);
  const [picked, setPicked] = useState<string | null>(null);
  const [newTicker, setNewTicker] = useState(normalizeTicker(tickerProp) ?? "");
  const [newName, setNewName] = useState("");
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // the thesis of the company the page is about is opened by default; else the one the person picked; else the first
  const ofTicker = tickerProp ? cfg.theses.find((t) => t.ticker === normalizeTicker(tickerProp)) : undefined;
  const selected: Thesis | undefined = cfg.theses.find((t) => t.id === picked) ?? ofTicker ?? cfg.theses[0];

  const { state: mon, check } = useThesisMonitor(cfg.theses, { enabled: monitor, now, ...(fetchImpl ? { fetchImpl } : {}) });

  const commit = useCallback(
    (id: string, patch: ThesisPatch): void => {
      void writeTheses((list) => list.map((x) => (x.id === id ? updateThesis(x, patch, now()) : x))).then((ok) => setSaveFailed(!ok));
    },
    [now],
  );

  const create = (): void => {
    const t = newThesis({ id: newId("th_"), ticker: newTicker, name: newName }, now());
    void writeTheses((list) => [...list, t]).then((ok) => {
      setSaveFailed(!ok);
      if (ok) {
        setPicked(t.id);
        setNewName("");
      }
    });
  };

  const remove = (id: string): void => {
    void writeTheses((list) => list.filter((x) => x.id !== id)).then((ok) => {
      setSaveFailed(!ok);
      setConfirmFor(null);
      setPicked(null);
    });
  };

  const triggeredOf = (t: Thesis): number => (t.check?.results ?? []).filter((r) => r.status === "triggered").length;

  const body = (
    <div className={cn("grid min-w-0 gap-5", className)} data-testid="thesis-panel" data-count={cfg.theses.length}>
      <p className="max-w-[78ch] text-[13px] leading-relaxed text-mute">{TH.lead}</p>
      {saveFailed && (
        <p role="alert" className="rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px]" data-testid="thesis-save-failed">
          Das Speichern hat nicht geklappt. Deine Eingabe steht noch auf dem Bildschirm; versuch es noch einmal.
        </p>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <aside className="grid min-w-0 content-start gap-4" aria-label={TH.listTitle}>
          <section className="grid gap-2">
            <Sub>{TH.listTitle}</Sub>
            {cfg.theses.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-2 p-3.5 text-[12.5px] leading-relaxed text-mute" data-testid="thesis-empty">
                {TH.noTheses}
              </p>
            ) : (
              <ul className="grid gap-1.5" data-testid="thesis-list">
                {cfg.theses.map((t) => {
                  const on = t.id === selected?.id;
                  const trig = triggeredOf(t);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(t.id)}
                        aria-current={on ? "true" : undefined}
                        className={cn("touch-hit grid w-full min-w-0 gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors", on ? "border-white/40 bg-white/[0.07]" : "border-line hover:border-line-2")}
                        data-testid="thesis-item"
                        data-id={t.id}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[13.5px] font-semibold">{t.name}</span>
                          {trig > 0 && (
                            <Badge tone="warn" dot>
                              {trig}
                            </Badge>
                          )}
                        </span>
                        <span className="num truncate font-mono text-[11.5px] text-mute">
                          {t.ticker || "ohne Kürzel"} · {t.versions.length} {t.versions.length === 1 ? "Version" : "Versionen"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3.5" data-testid="thesis-new">
            <p className="text-[13px] font-semibold">{TH.newTitle}</p>
            <Field label={TH.tickerLabel} htmlFor="thesis-new-ticker">
              <Input id="thesis-new-ticker" value={newTicker} maxLength={10} autoCapitalize="characters" spellCheck={false} placeholder="AAPL" data-testid="thesis-new-ticker" onChange={(e) => setNewTicker(e.target.value.toUpperCase())} />
            </Field>
            <Field label={TH.nameLabel} htmlFor="thesis-new-name">
              <Input id="thesis-new-name" value={newName} maxLength={60} data-testid="thesis-new-name" onChange={(e) => setNewName(e.target.value)} />
            </Field>
            <Button size="sm" variant="primary" onClick={create} disabled={cfg.theses.length >= 30} data-testid="thesis-create">
              {TH.create}
            </Button>
          </section>
        </aside>

        <div className="min-w-0">
          {selected ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="min-w-0 truncate text-[17px] font-semibold" data-testid="thesis-title">
                  {selected.name}
                </h3>
                {confirmFor === selected.id ? (
                  <span className="flex items-center gap-2" data-testid="thesis-confirm">
                    <span className="text-[12.5px] text-mute">{TH.confirmRemove}</span>
                    <Button size="sm" variant="danger" onClick={() => remove(selected.id)} data-testid="thesis-remove-yes">
                      {TH.removeYes}
                    </Button>
                    <Button size="sm" onClick={() => setConfirmFor(null)}>
                      {TH.cancel}
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" onClick={() => setConfirmFor(selected.id)} data-testid="thesis-remove">
                    {TH.remove}
                  </Button>
                )}
              </div>
              <ThesisEditor
                key={selected.id}
                t={selected}
                commit={(patch) => commit(selected.id, patch)}
                now={now}
                {...(fetchImpl ? { fetchImpl } : {})}
                checking={mon.running.has(selected.id)}
                checkError={mon.errors[selected.id] ?? null}
                onCheck={() => void check(selected.id)}
              />
            </div>
          ) : (
            <EmptyState title="Noch keine These" text={TH.noTheses} line={false} />
          )}
        </div>
      </div>

      <div data-testid="thesis-note">
        <AnalysisNote lead={TH.disclaimer} />
      </div>
    </div>
  );
  return bare ? body : <Card title={TH.title}>{body}</Card>;
}

export default ThesisPanel;
