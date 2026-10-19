import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ScreenshotRef } from "@/domain/types";
import { cn } from "@/lib/cn";
import { toInputString } from "@/lib/parse";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { CheckboxRow } from "@/primitives/CheckboxRow";
import { inputClass } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { ShotImage } from "@/journal/screenshots/ShotThumb";
import { buildCandidates, resolveZone, type Candidate } from "./candidate";
import { checksOf, type Check, type CheckFix, type FieldKey } from "./checks";
import { blobOfShot, extractError, ExtractError, prepareImages, requestExtraction } from "./client";
import { MAX_IMAGES, type ExtractReply } from "./contract";
import { assignShots, toDraft } from "./draft";
import { mergeCandidates } from "./merge";
import { applyEdits, attentionRows, rowsOf, type Edit, type Row } from "./rows";
import { closeShotImport, startDrafts, useShotImport } from "./store";
import { localZoneId, ZONE_CHOICES } from "./time";
import { detectLocaleStyle } from "./locale";

export const EXTRACT_STRINGS = {
  title: "Aus Screenshot übernehmen",
  lead: "Die KI liest Einstieg, Ausstieg, Stop, Menge, Gebühren und Ergebnis aus deinen Screenshots. Du prüfst nur, was markiert ist – gespeichert wird erst, wenn du im Editor auf „Speichern“ drückst.",
  privacy: "Die gewählten Bilder werden verkleinert und nur zum Auslesen an die KI (Anthropic) gesendet. Sie werden dort nicht von dir gespeichert und hier nicht protokolliert.",
  pick: (max: number) => `Wähle bis zu ${max} Bilder, die zu denselben Trades gehören (z. B. Position und Orderhistorie).`,
  read: "Auslesen",
  cancel: "Abbrechen",
  preparing: "Bilder werden verkleinert …",
  reading: "Die KI liest die Bilder … das dauert bis zu 20 Sekunden.",
  retry: "Erneut versuchen",
  manual: "Von Hand eintragen",
  none: "Es wurde kein Trade erkannt. Probiere einen größeren Ausschnitt oder trage die Werte von Hand ein – dein Screenshot bleibt am Trade.",
  refusal: "Die KI hat dieses Bild nicht gelesen. Du kannst die Werte von Hand eintragen.",
  found: (n: number) => (n === 1 ? "1 Trade erkannt" : `${n} Trades erkannt`),
  attention: (n: number) => (n === 0 ? "Nichts Unsicheres – prüfe die Werte trotzdem kurz." : n === 1 ? "1 Feld braucht deinen Blick" : `${n} Felder brauchen deinen Blick`),
  zone: "Zeitzone der Screenshots",
  zoneAuto: "Wie im Bild, sonst deine Zeit",
  open: (n: number) => (n === 1 ? "Entwurf öffnen" : `${n} Entwürfe öffnen`),
  reopenNote: "Der Editor wird mit den erkannten Werten neu aufgesetzt – bereits eingetippte Eingaben bleiben nicht erhalten. Die Bilder bleiben am Trade.",
  pickNone: "Wähle mindestens einen Trade.",
} as const;
const S = EXTRACT_STRINGS;

/* ------------------------------------------------------------------ state */

type Phase = { name: "select" } | { name: "preparing" } | { name: "reading" } | { name: "preview"; reply: ExtractReply; sent: ScreenshotRef[] } | { name: "empty"; text: string; notes: string[] } | { name: "error"; text: string; detail?: string };

interface State {
  phase: Phase;
  /** Indices (into the editor's pictures) picked for reading. */
  picked: number[];
  zoneId: string;
  edits: Edit[];
  /** Trader's overrides of "taken over": id → boolean. */
  taken: Record<string, boolean>;
}

type Action =
  | { type: "reset"; picked: number[] }
  | { type: "toggleShot"; i: number }
  | { type: "phase"; phase: Phase }
  | { type: "zone"; id: string }
  | { type: "edit"; edit: Edit }
  | { type: "take"; id: string; on: boolean };

const AUTO_ZONE = "auto";

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "reset":
      return { phase: { name: "select" }, picked: a.picked, zoneId: AUTO_ZONE, edits: [], taken: {} };
    case "toggleShot":
      return { ...s, picked: s.picked.includes(a.i) ? s.picked.filter((x) => x !== a.i) : s.picked.length >= MAX_IMAGES ? s.picked : [...s.picked, a.i].sort((x, y) => x - y) };
    case "phase":
      return { ...s, phase: a.phase };
    case "zone":
      return { ...s, zoneId: a.id };
    case "edit": {
      // a later edit of the same thing replaces the earlier one
      const same = (e: Edit) => e.id === a.edit.id && e.kind === a.edit.kind && (e.kind !== "field" || (a.edit.kind === "field" && e.key === a.edit.key));
      return { ...s, edits: [...s.edits.filter((e) => !same(e)), a.edit] };
    }
    case "take":
      return { ...s, taken: { ...s.taken, [a.id]: a.on } };
  }
}

/* ------------------------------------------------------------------ sheet */

/** The preview sheet of the screenshot import (lazy chunk – opened from `ShotImportHost`). */
export default function ExtractSheet() {
  const open = useShotImport((s) => s.open);
  const shots = useShotImport((s) => s.shots);
  const trades = useJournal((s) => s.trades);
  const currency = useJournal((s) => s.settings.currency);
  const [state, dispatch] = useReducer(reducer, { phase: { name: "select" }, picked: [], zoneId: AUTO_ZONE, edits: [], taken: {} });
  const abort = useRef<AbortController | null>(null);

  // every opening starts at the picture choice (the first four pictures are picked)
  const openedFor = useRef<ScreenshotRef[] | null>(null);
  useEffect(() => {
    if (!open) {
      openedFor.current = null;
      return;
    }
    if (openedFor.current === shots) return;
    openedFor.current = shots;
    dispatch({ type: "reset", picked: shots.slice(0, MAX_IMAGES).map((_, i) => i) });
  }, [open, shots]);

  const close = useCallback(() => {
    abort.current?.abort();
    closeShotImport();
  }, []);

  const run = useCallback(async () => {
    const chosen = state.picked.map((i) => shots[i]).filter((r): r is ScreenshotRef => !!r);
    if (!chosen.length) return;
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      dispatch({ type: "phase", phase: { name: "preparing" } });
      const blobs: Blob[] = [];
      for (const ref of chosen) {
        const b = await blobOfShot(ref);
        if (!b) throw new ExtractError("Ein Bild ist auf diesem Gerät nicht verfügbar (liegt es nur in der Cloud, melde dich an und versuche es erneut).", "gone");
        blobs.push(b);
      }
      const images = await prepareImages(blobs);
      if (ctl.signal.aborted) return;
      dispatch({ type: "phase", phase: { name: "reading" } });
      const reply = await requestExtraction(images, { timezone: localZoneId() }, ctl.signal);
      if (ctl.signal.aborted) return;
      if (!reply.trades.length) dispatch({ type: "phase", phase: { name: "empty", text: reply.reason === "refusal" ? S.refusal : S.none, notes: reply.notes } });
      else dispatch({ type: "phase", phase: { name: "preview", reply, sent: chosen } });
    } catch (e) {
      const err = extractError(e);
      if (ctl.signal.aborted) return;
      dispatch({ type: "phase", phase: { name: "error", text: err.message, ...(err.detail ? { detail: err.detail } : {}) } });
    }
  }, [state.picked, shots]);

  const phase = state.phase;
  const reply = phase.name === "preview" ? phase.reply : null;
  const sent = phase.name === "preview" ? phase.sent : [];

  const zone = useMemo(() => {
    const user = state.zoneId === AUTO_ZONE ? null : (ZONE_CHOICES.find((z) => z.id === state.zoneId)?.zone ?? null);
    return resolveZone(reply?.timezone ?? null, user, localZoneId());
  }, [reply, state.zoneId]);

  const candidates = useMemo(() => {
    if (!reply) return [];
    const built = buildCandidates(reply, { now: new Date(), zone, localZone: localZoneId(), fallbackStyle: detectLocaleStyle() });
    return applyEdits(mergeCandidates(built), state.edits);
  }, [reply, zone, state.edits]);

  const checks = useMemo(() => candidates.map((c) => checksOf(c, { trades, now: new Date(), currency })), [candidates, trades, currency]);
  const isTaken = (c: Candidate, k: Check[]) => state.taken[c.id] ?? !k.some((x) => x.level === "dup");
  const takenList = candidates.filter((c, i) => isTaken(c, checks[i]!));

  const confirm = () => {
    if (!takenList.length) return;
    const lists = assignShots(takenList, sent, shots);
    const drafts = takenList.map((c, i) => toDraft(c, lists[i]!));
    startDrafts(drafts);
    pushToast({ kind: "info", title: drafts.length === 1 ? "Entwurf aus Screenshot geöffnet" : `${drafts.length} Entwürfe aus Screenshots`, detail: drafts.length === 1 ? "Prüfe die Werte und speichere selbst." : "Der erste ist offen, die weiteren warten auf dich." });
  };

  const busy = phase.name === "preparing" || phase.name === "reading";
  return (
    <Sheet
      open={open}
      onClose={close}
      size="lg"
      title={S.title}
      dismissGuard={false}
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={close} data-testid="extract-cancel">
            {phase.name === "preview" || phase.name === "empty" || phase.name === "error" ? "Schließen" : S.cancel}
          </Button>
          {phase.name === "select" && (
            <Button variant="primary" disabled={!state.picked.length} onClick={() => void run()} data-testid="extract-read">
              {S.read}
            </Button>
          )}
          {phase.name === "error" && (
            <Button variant="primary" onClick={() => dispatch({ type: "phase", phase: { name: "select" } })} data-testid="extract-retry">
              {S.retry}
            </Button>
          )}
          {phase.name === "empty" && (
            <Button variant="primary" onClick={close} data-testid="extract-manual">
              {S.manual}
            </Button>
          )}
          {phase.name === "preview" && (
            <Button variant="primary" disabled={!takenList.length} onClick={confirm} data-testid="extract-confirm">
              {takenList.length ? S.open(takenList.length) : S.pickNone}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4" data-testid="extract-sheet" data-phase={phase.name}>
        {phase.name === "select" && <PickStep shots={shots} picked={state.picked} onToggle={(i) => dispatch({ type: "toggleShot", i })} />}
        {busy && (
          <StaggerItem>
            <p role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3 text-[13px] text-mute" data-testid="extract-busy">
              <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-signal" />
              {phase.name === "preparing" ? S.preparing : S.reading}
            </p>
            <Button
              className="mt-2"
              onClick={() => {
                abort.current?.abort();
                dispatch({ type: "phase", phase: { name: "select" } });
              }}
            >
              {S.cancel}
            </Button>
          </StaggerItem>
        )}
        {(phase.name === "error" || phase.name === "empty") && (
          <StaggerItem>
            <p role="alert" className="rounded-xl border border-warn/40 bg-warn/[0.07] px-3.5 py-3 text-[13px] leading-relaxed text-fg" data-testid="extract-message">
              {phase.text}
              {phase.name === "empty" && phase.notes.length > 0 && (
                <span className="mt-1.5 block text-[12px] text-mute" data-testid="extract-message-notes">
                  KI-Hinweis: {phase.notes.join(" · ")}
                </span>
              )}
              {phase.name === "error" && phase.detail && (
                <span className="mt-1.5 block font-mono text-[11px] text-faint" data-testid="extract-message-code">
                  Fehlercode: {phase.detail}
                </span>
              )}
            </p>
          </StaggerItem>
        )}
        {phase.name === "preview" && reply && (
          <Preview
            reply={reply}
            candidates={candidates}
            checks={checks}
            sent={sent}
            currency={currency}
            zoneText={zone.text}
            zoneId={state.zoneId}
            onZone={(id) => dispatch({ type: "zone", id })}
            isTaken={(c, i) => isTaken(c, checks[i]!)}
            onTake={(id, on) => dispatch({ type: "take", id, on })}
            onEdit={(edit) => dispatch({ type: "edit", edit })}
          />
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ step 1: pictures */

function PickStep({ shots, picked, onToggle }: { shots: readonly ScreenshotRef[]; picked: readonly number[]; onToggle: (i: number) => void }) {
  return (
    <>
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{S.lead}</p>
      </StaggerItem>
      <StaggerItem>
        <p className="mb-2 text-[12.5px] text-mute">{S.pick(MAX_IMAGES)}</p>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" aria-label="Bilder zum Auslesen">
          {shots.map((shot, i) => {
            const on = picked.includes(i);
            return (
              <li key={shot.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`Screenshot ${i + 1} ${on ? "abwählen" : "auswählen"}`}
                  disabled={!on && picked.length >= MAX_IMAGES}
                  onClick={() => onToggle(i)}
                  className={cn(
                    "relative block w-full overflow-hidden rounded-2xl border text-left transition-colors disabled:opacity-40 pointer-coarse:min-h-11",
                    on ? "border-white/50" : "border-line",
                  )}
                  data-testid="extract-shot"
                  data-on={on ? "1" : "0"}
                >
                  <span className="block aspect-[4/3] w-full bg-ink-850">
                    <ShotImage shot={shot} />
                  </span>
                  <span className={cn("absolute left-2 top-2 grid size-6 place-items-center rounded-full border text-[11px] font-semibold", on ? "border-transparent bg-fg text-ink-950" : "border-line-2 bg-ink-950/80 text-mute")} aria-hidden="true">
                    {on ? "✓" : i + 1}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </StaggerItem>
      <StaggerItem>
        <p className="text-[12px] leading-relaxed text-faint">{S.privacy}</p>
      </StaggerItem>
    </>
  );
}

/* ------------------------------------------------------------------ step 2: preview */

interface PreviewProps {
  reply: ExtractReply;
  candidates: Candidate[];
  checks: Check[][];
  sent: readonly ScreenshotRef[];
  currency: string;
  zoneText: string;
  zoneId: string;
  onZone: (id: string) => void;
  isTaken: (c: Candidate, i: number) => boolean;
  onTake: (id: string, on: boolean) => void;
  onEdit: (e: Edit) => void;
}

function Preview({ reply, candidates, checks, sent, currency, zoneText, zoneId, onZone, isTaken, onTake, onEdit }: PreviewProps) {
  const attention = candidates.reduce((n, c) => n + attentionRows(rowsOf(c, currency)).length, 0);
  return (
    <>
      <StaggerItem>
        <p role="status" aria-live="polite" className="text-[13.5px] font-medium text-fg" data-testid="extract-summary">
          {S.found(candidates.length)} · <span className={attention ? "text-warn" : "text-mute"}>{S.attention(attention)}</span>
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-faint">{S.reopenNote}</p>
      </StaggerItem>
      <StaggerItem className="grid gap-1.5 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3">
        <label htmlFor="extract-zone" className="label !text-mute">
          {S.zone}
        </label>
        <select id="extract-zone" value={zoneId} onChange={(e) => onZone(e.target.value)} className={cn(inputClass, "pointer-coarse:min-h-11")} data-testid="extract-zone">
          <option value="auto">{S.zoneAuto}</option>
          {ZONE_CHOICES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
        <p className="text-[12px] leading-relaxed text-mute" data-testid="extract-zone-text">
          {zoneText}
        </p>
      </StaggerItem>
      {reply.notes.length > 0 && (
        <StaggerItem>
          <ul className="grid gap-1 text-[12px] text-mute" aria-label="Hinweise der KI">
            {reply.notes.map((n) => (
              <li key={n}>KI-Hinweis: {n}</li>
            ))}
          </ul>
        </StaggerItem>
      )}
      {candidates.map((c, i) => (
        <StaggerItem key={c.id}>
          <CandidateCard c={c} index={i} checks={checks[i]!} sent={sent} currency={currency} taken={isTaken(c, i)} onTake={(on) => onTake(c.id, on)} onEdit={onEdit} />
        </StaggerItem>
      ))}
    </>
  );
}

const STATUS_LABEL = { planned: "Geplant", open: "Offen", closed: "Geschlossen" } as const;

function CandidateCard({ c, index, checks, sent, currency, taken, onTake, onEdit }: { c: Candidate; index: number; checks: Check[]; sent: readonly ScreenshotRef[]; currency: string; taken: boolean; onTake: (on: boolean) => void; onEdit: (e: Edit) => void }) {
  const rows = rowsOf(c, currency);
  const need = attentionRows(rows).length;
  const dup = checks.find((k) => k.level === "dup");
  const title = [c.pair.value ?? "Markt unbekannt", c.side.value ? (c.side.value === "long" ? "Long" : "Short") : null].filter(Boolean).join(" · ");
  const apply = (f: CheckFix) => onEdit(f.kind === "side" ? { id: c.id, kind: "side", value: f.value } : f.kind === "pnlMode" ? { id: c.id, kind: "pnlMode", value: f.value } : { id: c.id, kind: "impliedEntry", basis: f.basis });
  return (
    <section className={cn("grid gap-3 rounded-2xl border bg-ink-850 p-3.5", taken ? "border-line-2" : "border-line opacity-80")} aria-label={`Trade ${index + 1}: ${title}`} data-testid="extract-trade" data-pair={c.pair.value ?? ""} data-status={c.status}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <Badge tone={c.status === "planned" ? "steel" : c.status === "closed" ? "mute" : "teal"}>{STATUS_LABEL[c.status]}</Badge>
        {dup && <Badge tone="warn">Wahrscheinlich schon vorhanden</Badge>}
        {c.status !== "planned" && !c.entries.length && <Badge tone="warn">Einstieg fehlt im Bild</Badge>}
        {c.entryAssumed && <Badge tone="warn">Einstieg berechnet (Annahme)</Badge>}
        <span className="ml-auto flex items-center gap-1.5" aria-label={`Quellen: ${c.sources.map((s) => `Bild ${s + 1}`).join(", ")}`}>
          {c.sources.map((s) => {
            const ref = sent[s];
            return ref ? (
              <span key={s} className="relative size-9 overflow-hidden rounded-lg border border-line" title={`Bild ${s + 1}`}>
                <ShotImage shot={ref} />
              </span>
            ) : null;
          })}
          {c.merged > 1 && <span className="text-[11px] text-faint">{c.merged} zusammengeführt</span>}
        </span>
      </header>

      <CheckboxRow checked={taken} onToggle={() => onTake(!taken)} sub={need ? `${need} Feld${need === 1 ? "" : "er"} zu prüfen – im Editor änderbar` : undefined}>
        In den Editor übernehmen
      </CheckboxRow>

      <ul className="grid gap-1.5" aria-label="Erkannte Werte">
        {rows.map((r) => (
          <FieldRow key={r.key} c={c} row={r} onEdit={onEdit} />
        ))}
      </ul>

      {c.unreadable.length > 0 && (
        <p className="text-[12px] leading-snug text-warn" data-testid="extract-unreadable">
          Sichtbar, aber nicht sicher lesbar: {c.unreadable.join(", ")}.
        </p>
      )}

      {c.stop.value != null && c.status !== "planned" && (
        <CheckboxRow checked={c.stopOriginal} onToggle={() => onEdit({ id: c.id, kind: "stopOriginal", value: !c.stopOriginal })} sub="Sonst kommt der Stop nur als Notiz in den Trade und R bleibt leer.">
          Das war mein ursprünglicher Stop
        </CheckboxRow>
      )}

      {checks.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Prüfungen">
          {checks.map((k) => (
            <li key={k.code} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed", k.level === "info" ? "border-line text-mute" : "border-warn/40 bg-warn/[0.06] text-fg")} data-check={k.code}>
              <span className="min-w-0 flex-1">{k.text}</span>
              {[...(k.fix ? [k.fix] : []), ...(k.fixes ?? [])].map((f) => (
                <Button key={f.label} size="sm" className="max-w-full whitespace-normal text-left" onClick={() => apply(f)} data-testid={f.kind === "impliedEntry" ? `extract-fix-${f.basis ?? "drop"}` : undefined}>
                  {f.label}
                </Button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATE_LABEL = { ok: "", uncertain: "unsicher", missing: "fehlt" } as const;

function FieldRow({ c, row, onEdit }: { c: Candidate; row: Row; onEdit: (e: Edit) => void }) {
  const flagged = row.state === "uncertain" || (row.state === "missing" && !row.optional);
  const [editing, setEditing] = useState(false);
  const inputOn = row.editable && (flagged || editing || (row.state === "missing" && row.optional && editing));
  const commit = (text: string) => {
    onEdit({ id: c.id, kind: "field", key: row.key, text });
    setEditing(false);
  };
  const id = `${c.id}-${row.key}`;
  const start = row.text === "—" ? "" : startValue(c, row.key, row.text);
  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,5.25rem)_minmax(0,1fr)_auto] items-center sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-xl border px-3 py-2",
        flagged ? "border-warn/50 bg-warn/[0.07]" : "border-line bg-ink-950/40",
        row.state === "missing" && !row.optional && "border-dashed",
      )}
      data-testid={`extract-row-${row.key}`}
      data-state={row.state}
    >
      <span className="text-[12px] text-mute">{row.label}</span>
      <div className="min-w-0">
        {row.key === "side" && inputOn ? (
          <Segmented
            aria-label="Richtung"
            size="sm"
            value={c.side.value}
            onChange={(v) => onEdit({ id: c.id, kind: "side", value: v })}
            options={[
              { v: "long", label: "Long" },
              { v: "short", label: "Short" },
            ]}
            tones={{ long: "bg-win/15 border-win/30", short: "bg-loss/15 border-loss/30" }}
          />
        ) : inputOn ? (
          <input
            id={id}
            key={`${row.key}-${start}`}
            defaultValue={start}
            inputMode={row.key === "pair" ? "text" : "decimal"}
            autoComplete="off"
            spellCheck={false}
            aria-label={row.label}
            placeholder={row.optional ? "optional" : "ergänzen"}
            onBlur={(e) => e.target.value.trim() !== start.trim() && commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit((e.target as HTMLInputElement).value);
              }
            }}
            className={cn(inputClass, "py-1.5 font-mono text-[13px] pointer-coarse:min-h-11")}
            data-testid={`extract-input-${row.key}`}
          />
        ) : (
          <span className={cn("block break-words font-mono text-[13.5px]", row.text === "—" && "text-faint")} title={row.note}>
            {row.text}
          </span>
        )}
        {row.note && <span className="mt-0.5 block text-[11.5px] leading-snug text-warn">{row.note}</span>}
      </div>
      <span className="flex items-center gap-2 justify-self-end">
        {STATE_LABEL[row.state] && !(row.optional && row.state === "missing") && <span className={cn("text-[11px] font-medium", flagged ? "text-warn" : "text-faint")}>{STATE_LABEL[row.state]}</span>}
        <span className="num font-mono text-[11px] text-faint" aria-label={row.conf == null ? undefined : `Sicherheit ${Math.round(row.conf * 100)} Prozent`}>
          {row.conf == null ? "" : `${Math.round(row.conf * 100)} %`}
        </span>
        {row.editable && !inputOn && (
          <button type="button" onClick={() => setEditing(true)} aria-label={`${row.label} ändern`} className="rounded-lg px-2 py-1 text-[11.5px] text-mute underline-offset-2 hover:text-fg hover:underline pointer-coarse:min-h-11 pointer-coarse:px-3">
            ändern
          </button>
        )}
      </span>
    </li>
  );
}

/** The text an input starts with: the number in the form's own notation (comma, no grouping). */
function startValue(c: Candidate, key: FieldKey, text: string): string {
  const numeric: Partial<Record<FieldKey, number | null | undefined>> = {
    entry: c.status === "planned" ? c.plannedEntry.value : c.entries[0]?.price,
    exit: c.exits[0]?.price,
    qty: c.entries[0]?.qty,
    stop: c.stop.value,
    leverage: c.leverage.value,
    fees: c.fees.value,
    funding: c.funding.value,
    pnl: c.pnl.value,
  };
  if (key in numeric) {
    const v = numeric[key];
    return v == null ? "" : toInputString(Number(v.toPrecision(12)));
  }
  return key === "pair" ? (c.pair.value ?? "") : text;
}
