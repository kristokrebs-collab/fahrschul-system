import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { HyblockReading } from "@/domain/types";
import { cn } from "@/lib/cn";
import { nowLocalInput } from "@/lib/dates";
import { n1, signed } from "@/lib/format";
import { parseNumber, toInputString, toNonNegativeInt } from "@/lib/parse";
import { useMorphDialog } from "@/motion/MorphDialog";
import { radius, spring, tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { CheckboxRow } from "@/primitives/CheckboxRow";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { useJournal, useReadings } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

export const HYBLOCK_FORM_STRINGS = {
  title: "Hyblock-Ablesung",
  intro: "Werte aus dem Hyblock-Dashboard ablesen und eintragen. Das Journal wertet sie zusammen mit dem Live-Kurs gegen deinen Falling-Knife-Filter aus.",
  at: "Zeitpunkt",
  longPct: "Top Trader Long %",
  longPlaceholder: "z. B. 58,4",
  delta: "Whale-vs-Retail-Delta",
  deltaPlaceholder: "z. B. 12,5 oder −4",
  candles: "Delta positiv seit Kerzen",
  candlesHelp: "Aufeinanderfolgende Kerzen mit positivem Delta",
  note: "Notiz",
  notePlaceholder: "optional",
  structure: "Higher Low oder BOS auf 1H/4H",
  structureSub: "Struktur dreht selbst",
  rsi: "RSI-Divergenz oder Trendlinienbruch",
  rsiSub: "Momentum bestätigt",
  errLong: "Long-% zwischen 0 und 100 eintragen.",
  errDelta: "Delta eintragen, positiv oder negativ.",
  errSave: "Speichern fehlgeschlagen.",
  cancel: "Abbrechen",
  save: "Ablesung speichern",
  live: "Live-Werte übernehmen",
  toastSaved: "Ablesung gespeichert",
  toastDeleted: "Ablesung gelöscht",
  deleteLast: "Letzte löschen",
  confirmDelete: "Wirklich löschen",
  no: "Nein",
  del: "Löschen",
  readings: (n: number) => `${n} Ablesung${n === 1 ? "" : "en"}`,
  empty: "Noch keine Ablesung",
} as const;

/** Live values (Binance / Hyblock) that `Live-Werte übernehmen` copies into the form. */
export interface LiveHyblockValues {
  longPct: number | null;
  delta: number | null;
  deltaCandles: number | null;
}

export interface HyblockFormProps {
  /** Last manual reading – prefills `Top Trader Long %` (Bundle `tK`). Defaults to the store's newest reading. */
  last?: HyblockReading | null;
  /** When present, renders `Live-Werte übernehmen`. */
  live?: LiveHyblockValues | null;
  /** Called after save/cancel; defaults to `useMorphDialog().close()` (the form lives in the `hyblock-new` morph dialog). */
  onClose?: () => void;
  /** Override the store write (tests). */
  onSave?: (reading: Omit<HyblockReading, "id"> & { id?: string }) => Promise<void>;
  /** Injectable clock for `Zeitpunkt`. */
  now?: Date;
  className?: string;
}

interface FormState {
  at: string;
  longPct: string;
  delta: string;
  deltaCandles: string;
  note: string;
}

/**
 * Manual `Ablesung` form (Bundle `tK`, Plan 6.5): `Zeitpunkt`, `Top Trader Long %`, `Whale-vs-Retail-Delta`,
 * `Delta positiv seit Kerzen`, `Notiz`, toggles `Struktur` / `RSI`. Validation and record shape are 1:1;
 * saves via `useJournal().saveHyblock`, toast `Ablesung gespeichert` with value `{n1(longPct)} %`.
 */
export function HyblockForm({ last, live, onClose, onSave, now, className }: HyblockFormProps) {
  const readings = useReadings();
  const saveHyblock = useJournal((s) => s.saveHyblock);
  const pushToast = useUi((s) => s.pushToast);
  const dialog = useMorphDialog();
  const close = onClose ?? dialog.close;
  const prev = last === undefined ? readings[readings.length - 1] : last;

  const [form, setForm] = useState<FormState>({
    at: nowLocalInput(now),
    longPct: prev ? toInputString(prev.longPct) : "",
    delta: "",
    deltaCandles: "0",
    note: "",
  });
  const [structure, setStructure] = useState(false);
  const [rsi, setRsi] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function takeLive() {
    if (!live) return;
    setForm((f) => ({
      ...f,
      longPct: live.longPct == null ? f.longPct : toInputString(+live.longPct.toFixed(1)),
      delta: live.delta == null ? f.delta : toInputString(+live.delta.toFixed(2)),
      deltaCandles: live.deltaCandles == null ? f.deltaCandles : String(toNonNegativeInt(live.deltaCandles)),
    }));
  }

  async function save() {
    const longPct = parseNumber(form.longPct);
    const delta = parseNumber(form.delta);
    const candles = parseNumber(form.deltaCandles);
    if (longPct == null || longPct < 0 || longPct > 100) return setError(HYBLOCK_FORM_STRINGS.errLong);
    if (delta == null) return setError(HYBLOCK_FORM_STRINGS.errDelta);
    const reading = { id: "", at: form.at, longPct, delta, deltaCandles: toNonNegativeInt(candles), structure, rsi, note: form.note.trim() };
    setBusy(true);
    try {
      await (onSave ?? saveHyblock)(reading);
      pushToast({ kind: "success", title: HYBLOCK_FORM_STRINGS.toastSaved, value: `${n1(longPct)} %` });
      close();
    } catch {
      setError(HYBLOCK_FORM_STRINGS.errSave);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={cn("grid gap-4", className)}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-[13px] text-mute">{HYBLOCK_FORM_STRINGS.intro}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={HYBLOCK_FORM_STRINGS.at} htmlFor="hb-at" className="col-span-2">
          <Input id="hb-at" type="datetime-local" value={form.at} onChange={(e) => set("at")(e.target.value)} />
        </Field>
        <Field label={HYBLOCK_FORM_STRINGS.longPct} htmlFor="hb-long">
          <Input id="hb-long" numeric value={form.longPct} onChange={(e) => set("longPct")(e.target.value)} placeholder={HYBLOCK_FORM_STRINGS.longPlaceholder} />
        </Field>
        <Field label={HYBLOCK_FORM_STRINGS.delta} htmlFor="hb-delta">
          <Input id="hb-delta" numeric value={form.delta} onChange={(e) => set("delta")(e.target.value)} placeholder={HYBLOCK_FORM_STRINGS.deltaPlaceholder} />
        </Field>
        <Field label={HYBLOCK_FORM_STRINGS.candles} htmlFor="hb-c" help={HYBLOCK_FORM_STRINGS.candlesHelp}>
          <Input id="hb-c" inputMode="numeric" className="font-mono" value={form.deltaCandles} onChange={(e) => set("deltaCandles")(e.target.value)} />
        </Field>
        <Field label={HYBLOCK_FORM_STRINGS.note} htmlFor="hb-note">
          <Input id="hb-note" value={form.note} onChange={(e) => set("note")(e.target.value)} placeholder={HYBLOCK_FORM_STRINGS.notePlaceholder} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <CheckboxRow checked={structure} onToggle={() => setStructure((v) => !v)} sub={HYBLOCK_FORM_STRINGS.structureSub}>
          {HYBLOCK_FORM_STRINGS.structure}
        </CheckboxRow>
        <CheckboxRow checked={rsi} onToggle={() => setRsi((v) => !v)} sub={HYBLOCK_FORM_STRINGS.rsiSub}>
          {HYBLOCK_FORM_STRINGS.rsi}
        </CheckboxRow>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error && (
          <span role="alert" className="mr-auto text-[12.5px] text-loss">
            {error}
          </span>
        )}
        {live && (live.longPct != null || live.delta != null) && (
          <Button size="sm" onClick={takeLive} className="mr-auto">
            {HYBLOCK_FORM_STRINGS.live}
          </Button>
        )}
        <Button onClick={close}>{HYBLOCK_FORM_STRINGS.cancel}</Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {HYBLOCK_FORM_STRINGS.save}
        </Button>
      </div>
    </form>
  );
}

export interface HyblockReadingsListProps {
  /** Defaults to the store's readings (sorted by `at`). Newest first in the list. */
  readings?: HyblockReading[];
  /** Max rows shown (default 5). */
  limit?: number;
  /** Override the store delete (tests). */
  onDelete?: (id: string) => Promise<void>;
  className?: string;
}

/**
 * Readings list with per-row delete (`Löschen` → `Wirklich löschen` / `Nein`), toast `Ablesung gelöscht`.
 * Rows enter/exit via `AnimatePresence mode="popLayout"` + `layout` (Plan 3.3 lists).
 */
export function HyblockReadingsList({ readings, limit = 5, onDelete, className }: HyblockReadingsListProps) {
  const storeReadings = useReadings();
  const deleteHyblock = useJournal((s) => s.deleteHyblock);
  const pushToast = useUi((s) => s.pushToast);
  const list = [...(readings ?? storeReadings)].reverse().slice(0, limit);
  const [confirm, setConfirm] = useState<string | null>(null);
  const ids = list.map((r) => r.id).join();

  async function remove(id: string) {
    try {
      await (onDelete ?? deleteHyblock)(id);
      pushToast({ kind: "info", title: HYBLOCK_FORM_STRINGS.toastDeleted });
    } finally {
      setConfirm(null);
    }
  }

  if (list.length === 0) return <p className={cn("text-[12.5px] text-faint", className)}>{HYBLOCK_FORM_STRINGS.empty}</p>;

  return (
    <motion.ul layout layoutDependency={ids} transition={{ layout: spring.layout }} className={cn("grid gap-1.5", className)} aria-label="Ablesungen">
      <AnimatePresence mode="popLayout" initial={false}>
        {list.map((r) => (
          <motion.li
            key={r.id}
            layout
            layoutDependency={ids}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
            transition={{ ...spring.layout, layout: spring.layout }}
            style={{ borderRadius: radius.input }}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12.5px]"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="num font-mono text-mute">{r.at.replace("T", " ")}</span>
              <span className="num font-mono text-fg/90">{n1(r.longPct)} %</span>
              <span className={cn("num font-mono", r.delta > 0 ? "text-win" : r.delta < 0 ? "text-loss" : "text-mute")}>Δ {signed(r.delta, 1)}</span>
              {r.note && <span className="truncate text-faint">{r.note}</span>}
            </span>
            {confirm === r.id ? (
              <span className="flex items-center gap-2 text-[#ff8a90]" role="alert">
                {HYBLOCK_FORM_STRINGS.confirmDelete}
                <Button size="sm" variant="danger" onClick={() => void remove(r.id)}>
                  {HYBLOCK_FORM_STRINGS.del}
                </Button>
                <Button size="sm" onClick={() => setConfirm(null)}>
                  {HYBLOCK_FORM_STRINGS.no}
                </Button>
              </span>
            ) : (
              <Button size="sm" onClick={() => setConfirm(r.id)} aria-label={`${HYBLOCK_FORM_STRINGS.del}: ${r.at}`}>
                {HYBLOCK_FORM_STRINGS.del}
              </Button>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}
