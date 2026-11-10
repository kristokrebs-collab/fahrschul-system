/**
 * Versions of the rule drafts (F15): the list of a draft's versions with the change in plain language, notes, restore, and two
 * versions side by side (parameters, and the key numbers of their lab runs when there are some).
 */
import { useId, useMemo, useState } from "react";
import { compareRows, diffConfigs, MAX_NOTE } from "@/domain/lab/versions";
import { summarizeCustom } from "@/domain/lab";
import { cn } from "@/lib/cn";
import { dateTime } from "@/lib/format";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { pushToast } from "@/store/uiStore";
import { DRAFTS } from "./draftStrings";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { pctText, pfText, rText } from "./ui";
import { restoreVersion, saveEditorAsVersion } from "./versionActions";
import { useVersions } from "./versionsStore";

const V = DRAFTS.versions;

function NoteField({ draftId, n, note }: { draftId: string; n: number; note: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const setNote = useVersions((s) => s.setNote);
  const commit = (): void => {
    if (draft != null && draft.trim() !== note) setNote(draftId, n, draft);
    setDraft(null);
  };
  return <Input aria-label={`${V.note} ${V.version(n)}`} value={draft ?? note} maxLength={MAX_NOTE} placeholder={V.notePlaceholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} autoComplete="off" spellCheck={false} className="text-[12.5px]" data-testid="version-note" />;
}

export function VersionsCard({ className }: { className?: string }) {
  const uid = useId();
  const drafts = useLabor((s) => s.drafts);
  const runs = useLabor((s) => s.runs);
  const map = useVersions((s) => s.map);
  const [pick, setPick] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState("");
  const [aPick, setAPick] = useState<number | null>(null);
  const [bPick, setBPick] = useState<number | null>(null);
  const draft = drafts.find((d) => d.id === pick) ?? drafts[0] ?? null;
  const list = useMemo(() => (draft ? (map[draft.id] ?? []) : []), [draft, map]);
  const newest = list[list.length - 1];
  const shown = useMemo(() => [...list].reverse(), [list]);
  const a = list.find((v) => v.n === aPick) ?? list[list.length - 2] ?? null;
  const b = list.find((v) => v.n === bPick) ?? newest ?? null;
  const rows = useMemo(() => (a && b ? compareRows(a.config, b.config) : []), [a, b]);
  const runFor = (key: string) => runs.find((r) => r.strategy === "custom" && r.id.startsWith(`custom#${key}:`)) ?? null;

  const save = (): void => {
    if (!draft) return;
    const r = saveEditorAsVersion(draft.id, saveNote);
    if (!r.ok) pushToast({ kind: "error", title: V.full });
    else if (r.n == null) pushToast({ kind: "info", title: V.unchanged });
    else {
      pushToast({ kind: "success", title: V.saved(r.n) });
      setSaveNote("");
    }
  };

  return (
    <Card title={V.title} note={V.lead} className={className} data-testid="labor-versions">
      {!draft ? (
        <p className="text-[13px] text-mute" data-testid="labor-versions-empty">
          {V.empty}
        </p>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-end">
            <div className="grid gap-1.5">
              <label htmlFor={`${uid}-draft`} className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
                {V.draft}
              </label>
              <MorphSelect id={`${uid}-draft`} value={draft.id} onChange={(v) => { setPick(v); setAPick(null); setBPick(null); }} options={drafts.map((d) => ({ value: d.id, label: d.origin ? `${d.name} (${V.foreign})` : d.name }))} wrap data-testid="labor-versions-draft" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {draft.origin && (
                <Badge tone="warn" title={DRAFTS.playbook.foreignNote}>
                  {V.foreign}
                </Badge>
              )}
              <span className="text-[12px] text-faint">{summarizeCustom(draft.config)[0]}</span>
            </div>
          </div>

          <div className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3">
            <Input aria-label={V.saveNote} value={saveNote} maxLength={MAX_NOTE} placeholder={V.saveNote} onChange={(e) => setSaveNote(e.target.value)} autoComplete="off" className="text-[12.5px]" data-testid="labor-versions-savenote" />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={save} data-testid="labor-versions-save">
                {V.saveBtn(draft.name)}
              </Button>
            </div>
          </div>

          <ol className="grid gap-2" aria-label={V.listLabel} data-testid="labor-version-list">
            {shown.map((v) => {
              const prev = list[list.findIndex((x) => x.n === v.n) - 1];
              const lines = prev ? diffConfigs(prev.config, v.config) : [];
              const isNew = v.n === newest?.n;
              return (
                <li key={v.n} className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="labor-version" data-n={v.n}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                      {V.version(v.n)}
                      {isNew && (
                        <Badge tone="teal" dot>
                          {V.current}
                        </Badge>
                      )}
                      <span className="num text-[11.5px] font-normal text-faint">{v.at ? dateTime(new Date(v.at)) : ""}</span>
                    </span>
                    <Button size="sm" disabled={isNew} onClick={() => { if (restoreVersion(draft.id, v.n)) pushToast({ kind: "success", title: V.restored(v.n), detail: V.restoredDetail }); }} aria-label={`${V.restore}: ${V.version(v.n)}`} data-testid="labor-version-restore">
                      {V.restore}
                    </Button>
                  </div>
                  {!prev ? (
                    <p className="text-[12.5px] text-mute">{V.first}</p>
                  ) : lines.length ? (
                    <ul className="grid gap-1 text-[12.5px] leading-relaxed text-fg/90" aria-label={V.changes} data-testid="labor-version-diff">
                      {lines.map((l) => (
                        <li key={l} className="flex gap-2">
                          <span aria-hidden="true" className="mt-[8px] size-1 shrink-0 rounded-full bg-signal" />
                          <span className="min-w-0 [overflow-wrap:anywhere]">{l}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-mute">{V.noRuleChange}</p>
                  )}
                  <NoteField draftId={draft.id} n={v.n} note={v.note} />
                </li>
              );
            })}
          </ol>

          <div className="grid gap-3 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="labor-version-compare">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">{V.compare}</h3>
            {list.length < 2 || !a || !b ? (
              <p className="text-[12.5px] text-mute">{V.compareNeed}</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{V.a}</span>
                    <MorphSelect aria-label={V.a} value={String(a.n)} onChange={(v) => setAPick(Number(v))} options={list.map((v) => ({ value: String(v.n), label: V.version(v.n) }))} data-testid="labor-compare-a" />
                  </div>
                  <div className="grid gap-1.5">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{V.b}</span>
                    <MorphSelect aria-label={V.b} value={String(b.n)} onChange={(v) => setBPick(Number(v))} options={list.map((v) => ({ value: String(v.n), label: V.version(v.n) }))} data-testid="labor-compare-b" />
                  </div>
                </div>
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-left text-[12px]" data-testid="labor-compare-rows">
                    <thead>
                      <tr className="text-[10.5px] uppercase tracking-[0.1em] text-faint">
                        <th scope="col" className="py-1.5 pr-3 font-semibold">{V.rowsHead}</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold">{V.version(a.n)}</th>
                        <th scope="col" className="py-1.5 font-semibold">{V.version(b.n)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.label} className={cn("border-t border-line align-top", r.changed && "bg-white/[0.03]")} data-changed={r.changed ? "true" : "false"}>
                          <th scope="row" className="py-2 pr-3 font-medium">{r.label}</th>
                          <td className="py-2 pr-3 [overflow-wrap:anywhere]">{r.a}</td>
                          <td className={cn("py-2 [overflow-wrap:anywhere]", r.changed && "text-fg")}>{r.b}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid gap-2" data-testid="labor-compare-metrics">
                  <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{V.metrics}</h4>
                  {a.key === b.key ? (
                    <p className="text-[12px] text-mute">{V.onlyOne}</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[a, b].map((v) => {
                        const run = runFor(v.key);
                        return (
                          <div key={v.n} className="rounded-lg border border-line px-3 py-2 text-[12px]" data-testid="labor-compare-run" data-n={v.n}>
                            <span className="font-medium">{V.version(v.n)}</span>
                            {!run ? (
                              <p className="mt-1 text-mute">{V.noRun}</p>
                            ) : (
                              <>
                                <p className="mt-1 text-faint">{V.runOf(run.symbol, run.interval === "1d" ? "1D" : run.interval, LABOR.periods[run.period], run.n)}</p>
                                <dl className="mt-1 grid grid-cols-3 gap-2">
                                  <div><dt className="text-faint">Ø R</dt><dd className="num font-mono">{rText(run.avgR)}</dd></div>
                                  <div><dt className="text-faint">Win-Rate</dt><dd className="num font-mono">{pctText(run.winRate, 0, false)}</dd></div>
                                  <div><dt className="text-faint">Netto</dt><dd className="num font-mono">{pctText(run.netPct, 1)}</dd></div>
                                  <div><dt className="text-faint">Max DD</dt><dd className="num font-mono">{pctText(-run.maxDD, 0, false)}</dd></div>
                                  <div><dt className="text-faint">PF</dt><dd className="num font-mono">{pfText(run.pf)}</dd></div>
                                  <div><dt className="text-faint">Trades</dt><dd className="num font-mono">{run.n}</dd></div>
                                </dl>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
