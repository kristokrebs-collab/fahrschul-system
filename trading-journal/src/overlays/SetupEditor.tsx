import { AnimatePresence, Reorder, motion, useDragControls, type Variants } from "motion/react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { nextSetupColor, SETUP_PALETTE } from "@/domain/defaults";
import type { ChecklistItem, Setup, SetupAccount, Settings } from "@/domain/types";
import { newChecklistItemId, newSetupId } from "@/lib/ids";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Icon } from "@/primitives/icons";
import { Input, Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";
import { revealInvalid } from "@/primitives/fieldFx";

export interface SetupEditorProps {
  /** Overrides `uiStore.setupEditor.open`. */
  open?: boolean;
  /** Overrides `uiStore.setupEditor.setupId` (undefined → new setup). */
  setupId?: string;
  /** Opened from the trade editor: no card morph (Plan 6.3). Overrides the store flag. */
  fromTrade?: boolean;
  /** Overrides `uiStore.closeSetupEditor`. */
  onClose?: () => void;
  /** Called with the saved setup (the trade editor selects a freshly created setup). */
  onSaved?: (setup: Setup) => void;
}

export const SETUP_ACCOUNT_OPTIONS: readonly { v: SetupAccount; label: string }[] = [
  { v: "makro", label: "Makro" },
  { v: "scalp", label: "Scalp" },
  { v: "both", label: "Beide" },
];

export const SETUP_EDITOR_STRINGS = {
  titleNew: "Neue Entscheidungsgrundlage",
  titleEdit: "Grundlage bearbeiten",
  name: "Name",
  namePlaceholder: "z. B. 4H-Breakout über 85.900",
  account: "Konto",
  rules: "Regeln",
  rulesPlaceholder: "Woran erkenne ich das Setup? Wo liegt der Stop? Was ist das Ziel?",
  checklist: "Checkliste",
  checklistHelp: "Diese Punkte hakst du beim Eintragen eines Trades ab.",
  addItem: "+ Punkt hinzufügen",
  removeItem: "Punkt entfernen",
  color: "Farbe",
  usedBy: (n: number) => `In ${n} Trades verwendet`,
  del: "Löschen",
  delConfirm: "Löschen?",
  delUsed: (n: number) => `${n} Trades verlieren die Zuordnung.`,
  yes: "Ja",
  no: "Nein",
  cancel: "Abbrechen",
  save: "Speichern",
  errName: "Bitte einen Namen angeben.",
  errSave: "Speichern fehlgeschlagen.",
  errDelete: "Löschen fehlgeschlagen.",
  toastCreated: "Grundlage angelegt",
  toastUpdated: "Grundlage aktualisiert",
  toastDeleted: "Grundlage gelöscht",
} as const;

type Form = Setup;

function emptyForm(setups: readonly Setup[]): Form {
  return { id: "", name: "", desc: "", color: nextSetupColor(setups), account: "both", checklist: [] };
}

/** Bundle `Z$` save shape: trimmed name/desc, `id || Lf("s_")`, empty checklist items dropped. */
export function finalizeSetup(form: Form): Setup {
  return {
    ...form,
    name: form.name.trim(),
    desc: form.desc.trim(),
    id: form.id || newSetupId(),
    checklist: form.checklist.filter((c) => c.text.trim()).map((c) => ({ ...c, text: c.text.trim() })),
  };
}

/** Upsert by id (replace or append) – Bundle lines 51735–51755. */
export function upsertSetup(settings: Settings, setup: Setup): Settings {
  const exists = settings.setups.some((s) => s.id === setup.id);
  return { ...settings, setups: exists ? settings.setups.map((s) => (s.id === setup.id ? setup : s)) : [...settings.setups, setup] };
}

export function removeSetup(settings: Settings, id: string): Settings {
  return { ...settings, setups: settings.setups.filter((s) => s.id !== id) };
}

/**
 * Setup editor sheet (Bundle `Z$`, Plan 6.3 / 3.3). Editing morphs out of the setup card
 * (`layoutId="setup-card-{id}"`, `spring.sheet`); a new setup or `fromTrade` slides in. Checklist items
 * can be added, removed and reordered (`Reorder` from motion, drag handle + arrow keys); ids via
 * `newChecklistItemId()`. Saves through `useJournal().saveSettings` (upsert into `settings.setups`).
 *
 * Motion: the fields cascade in after the sheet body mounts (`StaggerItem`); checklist rows enter/leave and lift
 * while dragged (scale 1.02 + a pre-rendered shadow layer); the colour selection ring glides between swatches
 * (`layoutId="sf-color-{useId}"`); a missing name shakes the field into view; `Löschen` is a `HoldConfirm`.
 */
export function SetupEditor(props: SetupEditorProps) {
  const store = useUi((s) => s.setupEditor);
  const closeStore = useUi((s) => s.closeSetupEditor);
  const pushToast = useUi((s) => s.pushToast);
  const settings = useJournal((s) => s.settings);
  const trades = useJournal((s) => s.trades);
  const saveSettings = useJournal((s) => s.saveSettings);

  const open = props.open ?? store.open;
  const setupId = props.open !== undefined ? props.setupId : store.setupId;
  const fromTrade = props.fromTrade ?? store.fromTrade;
  const onClose = props.onClose ?? closeStore;

  const existing = useMemo(() => (setupId ? settings.setups.find((s) => s.id === setupId) : undefined), [settings.setups, setupId]);
  const usedBy = useMemo(() => (existing ? trades.filter((t) => (t.setups || []).includes(existing.id)).length : 0), [trades, existing]);

  const [form, setForm] = useState<Form>(() => emptyForm(settings.setups));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const reduced = useReducedFx();
  const { trigger: deleteTrigger, no: deleteNo } = useConfirmFocus(confirmDelete);

  // Reset when the sheet opens or targets another setup (render-phase state adjustment, no effect).
  // A background settings update while typing must not wipe the form, hence the id-based key.
  const openKey = open ? (existing?.id ?? "__new") : "";
  const [seenKey, setSeenKey] = useState("");
  if (openKey !== seenKey) {
    setSeenKey(openKey);
    if (open) {
      setError("");
      setConfirmDelete(false);
      setBusy(false);
      setForm(existing ? structuredClone(existing) : emptyForm(settings.setups));
    }
  }

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const setItems = (checklist: ChecklistItem[]) => patch({ checklist });

  async function save() {
    if (!form.name.trim()) {
      setError(SETUP_EDITOR_STRINGS.errName);
      revealInvalid("sf-name", { reduced });
      return;
    }
    const setup = finalizeSetup(form);
    setBusy(true);
    try {
      await saveSettings(upsertSetup(useJournal.getState().settings, setup));
      pushToast({ kind: "success", title: existing ? SETUP_EDITOR_STRINGS.toastUpdated : SETUP_EDITOR_STRINGS.toastCreated });
      props.onSaved?.(setup);
      onClose();
    } catch {
      setError(SETUP_EDITOR_STRINGS.errSave);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy(true);
    try {
      await saveSettings(removeSetup(useJournal.getState().settings, existing.id));
      pushToast({ kind: "info", title: SETUP_EDITOR_STRINGS.toastDeleted });
      onClose();
    } catch {
      setError(SETUP_EDITOR_STRINGS.errDelete);
    } finally {
      setBusy(false);
    }
  }

  const layoutId = existing && !fromTrade ? `setup-card-${existing.id}` : undefined;
  const checklistIds = form.checklist.map((c) => c.id).join();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      layoutId={layoutId}
      title={existing ? SETUP_EDITOR_STRINGS.titleEdit : SETUP_EDITOR_STRINGS.titleNew}
      footer={
        <>
          {existing &&
            (confirmDelete ? (
              <motion.span
                key="confirm"
                className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]"
                initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ default: tween.fade, scale: spring.pop }}
              >
                {usedBy ? SETUP_EDITOR_STRINGS.delUsed(usedBy) : SETUP_EDITOR_STRINGS.delConfirm}
                <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
                  {SETUP_EDITOR_STRINGS.yes}
                </Button>
                <Button ref={deleteNo} size="sm" onClick={() => setConfirmDelete(false)}>
                  {SETUP_EDITOR_STRINGS.no}
                </Button>
              </motion.span>
            ) : (
              // a setup that trades still use never goes on a hold alone: the hold opens the inline warning with the count
              <HoldConfirm ref={deleteTrigger} disabled={busy} onAsk={() => setConfirmDelete(true)} onConfirm={() => (usedBy > 0 ? setConfirmDelete(true) : void remove())}>
                {SETUP_EDITOR_STRINGS.del}
              </HoldConfirm>
            ))}
          <span className="flex-1" />
          {error && (
            <span role="alert" className="text-[12.5px] font-medium text-[#ff8a90]">
              {error}
            </span>
          )}
          <Button onClick={onClose}>{SETUP_EDITOR_STRINGS.cancel}</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {SETUP_EDITOR_STRINGS.save}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <StaggerItem>
          <Field label={SETUP_EDITOR_STRINGS.name} htmlFor="sf-name">
            <Input
              id="sf-name"
              value={form.name}
              onChange={(e) => {
                patch({ name: e.target.value });
                if (error === SETUP_EDITOR_STRINGS.errName) setError("");
              }}
              invalid={error === SETUP_EDITOR_STRINGS.errName}
              placeholder={SETUP_EDITOR_STRINGS.namePlaceholder}
              autoComplete="off"
            />
          </Field>
        </StaggerItem>

        <StaggerItem>
          <Field label={<span id="sf-account-label">{SETUP_EDITOR_STRINGS.account}</span>}>
            <Segmented aria-labelledby="sf-account-label" value={form.account} onChange={(account) => patch({ account })} options={SETUP_ACCOUNT_OPTIONS} />
          </Field>
        </StaggerItem>

        <StaggerItem>
          <Field label={SETUP_EDITOR_STRINGS.rules} htmlFor="sf-desc">
            <Textarea id="sf-desc" rows={3} className="leading-relaxed" value={form.desc} onChange={(e) => patch({ desc: e.target.value })} placeholder={SETUP_EDITOR_STRINGS.rulesPlaceholder} />
          </Field>
        </StaggerItem>

        <StaggerItem>
          <Field label={SETUP_EDITOR_STRINGS.checklist} help={SETUP_EDITOR_STRINGS.checklistHelp}>
            <div className="grid gap-2">
              <Reorder.Group axis="y" values={form.checklist} onReorder={setItems} className="grid gap-2" aria-label={SETUP_EDITOR_STRINGS.checklist}>
                <AnimatePresence mode="popLayout" initial={false}>
                  {form.checklist.map((item, i) => (
                    <ChecklistRow
                      key={item.id}
                      item={item}
                      index={i}
                      count={form.checklist.length}
                      ids={checklistIds}
                      onChange={(text) => setItems(form.checklist.map((c) => (c.id === item.id ? { ...c, text } : c)))}
                      onRemove={() => setItems(form.checklist.filter((c) => c.id !== item.id))}
                      onMove={(dir) => setItems(moveItem(form.checklist, i, dir))}
                    />
                  ))}
                </AnimatePresence>
              </Reorder.Group>
              <Button size="sm" className="justify-self-start" onClick={() => setItems([...form.checklist, { id: newChecklistItemId(), text: "" }])}>
                {SETUP_EDITOR_STRINGS.addItem}
              </Button>
            </div>
          </Field>
        </StaggerItem>

        <StaggerItem>
          <Field label={<span id="sf-color-label">{SETUP_EDITOR_STRINGS.color}</span>}>
            <ColorRadios value={form.color} onChange={(color) => patch({ color })} />
          </Field>
        </StaggerItem>

        {existing && (
          <StaggerItem className="justify-self-start">
            <Badge tone="mute">{SETUP_EDITOR_STRINGS.usedBy(usedBy)}</Badge>
          </StaggerItem>
        )}
      </form>
    </Sheet>
  );
}

export function moveItem<T>(list: readonly T[], from: number, dir: -1 | 1): T[] {
  const to = from + dir;
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it as T);
  return out;
}

/**
 * Colour radios: the selection ring is one element that glides to the chosen swatch (`layoutId="sf-color-{useId}"`,
 * `spring.segment`). It is a sibling of the swatch, so the swatch's hover scale never distorts its measurement.
 */
function ColorRadios({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const id = useId();
  const reduced = useReducedFx();
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="sf-color-label">
      {SETUP_PALETTE.map((hex) => {
        const on = value === hex;
        return (
          <span key={hex} className="relative grid size-8 place-items-center">
            {on && (
              <motion.span
                layoutId={`sf-color-${id}`}
                layoutDependency={value}
                aria-hidden="true"
                className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-fg"
                style={{ borderRadius: radius.pill }}
                transition={spring.segment}
              />
            )}
            <motion.button
              type="button"
              role="radio"
              aria-label={`Farbe ${hex}`}
              aria-checked={on}
              onClick={() => onChange(hex)}
              whileHover={reduced ? undefined : { scale: 1.1 }}
              whileTap={reduced ? undefined : { scale: 0.9 }}
              transition={spring.press}
              className="size-8 rounded-full"
              style={{ background: hex, boxShadow: "inset 0 0 0 2px var(--color-ink-850)" }}
            />
          </span>
        );
      })}
    </div>
  );
}

/** Drag lift: the dragged row scales up a touch while a pre-rendered shadow layer fades in (no box-shadow animation). */
const LIFT: Variants = { lifted: { scale: 1.02 } };
const LIFT_SHADOW: Variants = { lifted: { opacity: 1 } };

interface ChecklistRowProps {
  item: ChecklistItem;
  index: number;
  count: number;
  /** Item ids joined – the `layoutDependency` of every row. */
  ids: string;
  onChange: (text: string) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}

/** One checklist line: drag handle (pointer) / arrow keys (keyboard), input `Punkt {n}`, remove `Punkt entfernen`. */
function ChecklistRow({ item, index, count, ids, onChange, onRemove, onMove }: ChecklistRowProps) {
  const controls = useDragControls();
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      onMove(-1);
    } else if (e.key === "ArrowDown" && index < count - 1) {
      e.preventDefault();
      onMove(1);
    }
  };
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      layout
      layoutDependency={ids}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
      whileDrag="lifted"
      variants={LIFT}
      transition={{ ...spring.layout, layout: spring.layout }}
      style={{ borderRadius: radius.input }}
      className="relative isolate flex gap-2"
      data-testid={`checklist-item-${item.id}`}
    >
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-1 -z-10 rounded-[14px] bg-ink-850 shadow-[0_16px_36px_rgb(0_0_0/0.55)]"
        style={{ opacity: 0 }}
        variants={LIFT_SHADOW}
        transition={tween.fade}
      />
      <button
        type="button"
        aria-label={`Punkt ${index + 1} verschieben`}
        title="Ziehen oder Pfeiltasten"
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={onHandleKey}
        className="grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-xl border border-line-2 text-faint hover:text-fg active:cursor-grabbing"
      >
        <svg viewBox="0 0 12 12" className="size-3" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="2.5" r="1" />
          <circle cx="8" cy="2.5" r="1" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="8" cy="6" r="1" />
          <circle cx="4" cy="9.5" r="1" />
          <circle cx="8" cy="9.5" r="1" />
        </svg>
      </button>
      <Input value={item.text} aria-label={`Punkt ${index + 1}`} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      <button
        type="button"
        aria-label={SETUP_EDITOR_STRINGS.removeItem}
        onClick={onRemove}
        className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-2 text-mute hover:text-loss [&>svg]:size-4"
      >
        <Icon name="x" />
      </button>
    </Reorder.Item>
  );
}
