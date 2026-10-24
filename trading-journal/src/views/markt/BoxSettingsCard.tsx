/**
 * `Box-Einstellungen` (P02): `settings.boxes` written at once (like the Lage card – a switch never waits for a save
 * button; the settings page's draft does not hold these keys, so its save keeps them): Box-zu-Box on/off, alerts at the
 * candle close, browser notifications (asks the permission on the switch; a block is said honestly), the watchlist
 * scanner, the minimum grade and the watchlist (chips with remove, autocomplete to add, the default list back).
 */
import { AnimatePresence, motion } from "motion/react";
import { memo, useState, type FormEvent } from "react";
import { boxesCfgOf, DEFAULT_WATCHLIST, normalizeWatchSymbol, WATCHLIST_MAX, withBoxesSettings, type BoxesCfg, type MinGrade } from "@/domain/boxes";
import { useEntitlement } from "@/billing/entitlements";
import { cn } from "@/lib/cn";
import { Autocomplete } from "@/motion/pulse/Autocomplete";
import { Switch } from "@/motion/Switch";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { BINANCE_FUTURES_SYMBOLS } from "@/views/settings/SymbolField";
import { MARKT } from "./strings";

const S = MARKT.settings;
const GRADES: readonly { v: MinGrade; label: string }[] = [
  { v: "A", label: "A+ und A" },
  { v: "A+", label: "nur A+" },
];
const SUGGESTIONS = BINANCE_FUTURES_SYMBOLS.map((s) => s.label ?? s.value);

type Patch = Partial<Omit<BoxesCfg, "box">>;
const rawBoxes = (s: unknown): unknown => (s && typeof s === "object" ? (s as { boxes?: unknown }).boxes : undefined);

/** Writes `settings.boxes` at once (three-way merged by the store like every settings save). */
export async function writeBoxes(patch: Patch): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const prev = rawBoxes(settings);
  const boxes = withBoxesSettings(prev, patch);
  if (boxes === prev) return true;
  try {
    const next = { ...settings, boxes } as typeof settings;
    await saveSettings(next);
    return true;
  } catch {
    return false;
  }
}

function useStoredBoxes(): BoxesCfg {
  const raw = useJournal((s) => rawBoxes(s.settings));
  return boxesCfgOf(raw);
}

function Row({ id, label, help, checked, onChange, disabled }: { id: string; label: string; help: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 transition-opacity duration-200", disabled && "opacity-50")}>
      <span className="grid min-w-0 gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-[13px] text-fg">
          {label}
        </label>
        <span id={`${id}-help`} className="text-[11px] text-faint">
          {help}
        </span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-help`} disabled={disabled} className="touch-hit mt-0.5 shrink-0" />
    </div>
  );
}

export const BoxSettingsCard = memo(function BoxSettingsCard() {
  const stored = useStoredBoxes();
  // the scanner (and its alerts) is a Pro feature; the close alerts of this symbol are free (F03)
  const scannerPlan = useEntitlement("boxScanner");
  const pushToast = useUi((s) => s.pushToast);
  const reduced = useReducedFx();
  const [pending, setPending] = useState<Patch | null>(null);
  const [add, setAdd] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const cur: BoxesCfg = { ...stored, ...pending };
  const apply = (patch: Patch) => {
    setPending((p) => ({ ...p, ...patch }));
    void writeBoxes(patch).then((ok) => {
      setPending(null);
      if (!ok) pushToast({ kind: "error", title: S.failed });
    });
  };
  const onNotify = async (on: boolean) => {
    if (!on) return apply({ notify: false });
    if (typeof window === "undefined" || !("Notification" in window)) return setHint(S.notifyUnsupported);
    const perm = Notification.permission === "default" ? await Notification.requestPermission().catch(() => "denied" as NotificationPermission) : Notification.permission;
    if (perm !== "granted") {
      setHint(S.notifyDenied);
      return;
    }
    setHint(null);
    apply({ notify: true });
  };
  const addSymbol = (raw: string) => {
    const s = normalizeWatchSymbol(raw);
    if (!s) return setHint(S.invalid);
    if (cur.watchlist.includes(s)) return setAdd("");
    if (cur.watchlist.length >= WATCHLIST_MAX) return setHint(S.full(WATCHLIST_MAX));
    setHint(null);
    setAdd("");
    apply({ watchlist: [...cur.watchlist, s] });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (add.trim()) addSymbol(add);
  };
  return (
    <Card title={S.title} note={S.note} data-testid="markt-settings">
      <div className="grid gap-4 lg:grid-cols-2" data-on={cur.on ? "on" : "off"}>
        <div className="grid content-start gap-2">
          <Row id="bx-on" label={S.on} help={S.onHelp} checked={cur.on} onChange={(on) => apply({ on })} />
          <Row id="bx-alerts" label={S.alerts} help={S.alertsHelp} checked={cur.alerts} onChange={(alerts) => apply({ alerts })} disabled={!cur.on} />
          <Row id="bx-notify" label={S.notify} help={hint === S.notifyDenied || hint === S.notifyUnsupported ? hint : S.notifyHelp} checked={cur.notify} onChange={(v) => void onNotify(v)} disabled={!cur.on || !cur.alerts} />
          <Row
            id="bx-scanner"
            label={S.scanner}
            help={scannerPlan ? S.scannerHelp : S.scannerLocked}
            checked={cur.scanner && scannerPlan}
            onChange={(scanner) => apply({ scanner })}
            disabled={!scannerPlan}
          />
          <div className="grid gap-1.5 pt-1">
            <span id="bx-grade-label" className="label">
              {S.minGrade}
            </span>
            <Segmented<MinGrade> aria-labelledby="bx-grade-label" size="sm" className="justify-self-start" value={cur.minGrade} onChange={(minGrade) => apply({ minGrade })} options={GRADES} />
          </div>
        </div>
        <div className="grid content-start gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="label">
              {S.watchlist} · {cur.watchlist.length}/{WATCHLIST_MAX}
            </span>
            <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" onClick={() => apply({ watchlist: [...DEFAULT_WATCHLIST] })}>
              {S.reset}
            </Button>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label={S.watchlist} data-testid="watchlist">
            <AnimatePresence initial={false}>
              {cur.watchlist.map((s) => (
                <motion.li
                  key={s}
                  layout={reduced ? false : "position"}
                  initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8, transition: tween.exit }}
                  transition={spring.pop}
                  style={{ borderRadius: radius.pill }}
                  className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-white/[0.03] py-0.5 pl-2.5 pr-1 font-mono text-[11.5px] text-fg pointer-coarse:min-h-11"
                >
                  {s}
                  <button type="button" aria-label={S.remove(s)} className="touch-hit grid size-5 place-items-center rounded-full text-faint hover:bg-white/10 hover:text-fg pointer-coarse:size-8" onClick={() => apply({ watchlist: cur.watchlist.filter((x) => x !== s) })}>
                    ×
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <label htmlFor="bx-add" className="sr-only">
              {S.add}
            </label>
            <div className="min-w-0 flex-1">
              <Autocomplete id="bx-add" value={add} onChange={setAdd} suggestions={SUGGESTIONS} placeholder={S.addPlaceholder} onSelect={(it) => addSymbol(it.value)} autoComplete="off" />
            </div>
            <Button type="submit" size="sm" variant="primary" disabled={!add.trim()}>
              {S.addButton}
            </Button>
          </form>
          {hint && hint !== S.notifyDenied && hint !== S.notifyUnsupported ? (
            <p className="text-[11.5px] text-warn" role="note">
              {hint}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
});
