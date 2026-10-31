/**
 * Building blocks of the short trade form (Etappe 1b): the accordion group, the core grid cell, the "Felder anpassen"
 * list and the bar with `Letzten Trade duplizieren`. Pure view code – the state (open groups, layout, duplicate note)
 * lives in `TradeEditor`, the rules in `tradeFormLayout.ts` / `duplicateTrade.ts`.
 */
import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { StaggerItem } from "@/motion/Stagger";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, inputClass } from "@/primitives";
import { DUPLICATE_HINT, DUPLICATE_LABEL } from "./duplicateTrade";
import { CORE_SUB, CORE_TITLE, FIELDS, GROUPS, coreCount, isZoneId, type FieldDef, type FieldId, type FormLayout, type GroupId, type ZoneId } from "./tradeFormLayout";

/* ------------------------------------------------------------------------------------------------ copy */

export const CUSTOMIZE_COPY = {
  open: "Felder anpassen",
  title: "Felder anpassen",
  lead: "Lege fest, welche Felder oben im Kern stehen und in welchem Bereich die übrigen liegen. Das gilt nur für dieses Gerät. Kein Feld geht verloren: Was in einem Bereich liegt, wird genauso gespeichert.",
  done: "Fertig",
  reset: "Zurücksetzen",
  resetDone: "Auf die Voreinstellung zurückgesetzt.",
  resetNote: "Stellt die Voreinstellung wieder her: sechs Kernfelder, alles andere in den Bereichen.",
  core: "Kern (immer sichtbar)",
  list: "Felder",
} as const;

/** Grid cell classes of a field on the form's 2-column (phone) / 4-column (md) grid. */
const SPAN: Record<FieldDef["span"], string> = {
  one: "col-span-1",
  two: "col-span-2",
  full: "col-span-2 md:col-span-4",
};

/* ------------------------------------------------------------------------------------------ zone grid */

/** The fields of one zone on the shared grid; `render` gives the control of a field. */
export function ZoneGrid({ fields, render }: { fields: readonly FieldDef[]; render: (id: FieldId) => ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
      {fields.map((d) => (
        <div key={d.id} data-field-id={d.id} className={cn("min-w-0", SPAN[d.span])}>
          {render(d.id)}
        </div>
      ))}
    </div>
  );
}

/** Heading of a block that has no label of its own (a whole section moved into a zone). */
export function BlockHead({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <h4 className="mb-2.5 flex items-baseline gap-2 text-[13px] font-semibold">
      {title}
      {sub && <span className="text-xs font-normal text-faint">{sub}</span>}
    </h4>
  );
}

/* --------------------------------------------------------------------------------------------- core */

/** The always-visible block: `Kernfelder` heading and its fields. */
export function CoreSection({ children }: { children: ReactNode }) {
  const id = useId();
  return (
    <StaggerItem as="section" aria-labelledby={id} data-testid="form-core" className="grid gap-3.5 pb-5">
      <h3 id={id} className="flex items-baseline gap-2 text-[13.5px] font-semibold">
        {CORE_TITLE}
        <span className="text-xs font-normal text-faint">{CORE_SUB}</span>
      </h3>
      {children}
    </StaggerItem>
  );
}

/* ------------------------------------------------------------------------------------------ accordion */

export interface FormGroupProps {
  id: GroupId;
  title: string;
  /** Short list of what is inside ("Stop-Loss, Take-Profit …"). */
  hint: string;
  /** Filled optional fields (`n ausgefüllt`), 0 = no badge. */
  filled: number;
  open: boolean;
  onToggle: () => void;
  /** Open / close without the height animation (the jump to an invalid field measures the final layout). */
  instant?: boolean;
  children: ReactNode;
}

/**
 * One accordion group. The content stays MOUNTED while the group is closed (state, live check and validation of every
 * field keep working), it is only clipped to 0 px, hidden from sight and `inert` (out of the tab order and of the
 * accessibility tree). The height animates once, on `tween.collapse` (declared height exception, like `Collapse`).
 * The header is a full-width button ≥ 44 px tall on touch screens.
 */
export function FormGroup({ id, title, hint, filled, open, onToggle, instant, children }: FormGroupProps) {
  const reduced = useReducedFx();
  const uid = useId();
  const headId = `${uid}-h`;
  const bodyId = `${uid}-b`;
  // "closed" / "open" = the animation has ended: only then the content leaves the paint (visibility) / may overflow (focus
  // glows of the inputs); while it moves the box clips and shows the content
  const [phase, setPhase] = useState<"closed" | "moving" | "open">(open ? "open" : "closed");
  const [was, setWas] = useState(open);
  if (was !== open) {
    setWas(open);
    setPhase("moving");
  }
  return (
    <StaggerItem as="section" data-testid={`form-group-${id}`} data-open={open || undefined} className="border-t border-line">
      <h3 className="m-0">
        <button
          type="button"
          id={headId}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="touch-hit relative flex min-h-11 w-full items-center gap-3 py-2.5 text-left outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2 text-[13.5px] font-semibold">
              {title}
              {filled > 0 && (
                <span data-testid={`form-group-${id}-filled`} className="rounded-full border border-line-2 px-2 py-px text-[11px] font-medium text-mute">
                  {filled} ausgefüllt
                </span>
              )}
            </span>
            <span className="block w-0 min-w-full truncate text-xs font-normal text-faint">{hint}</span>
          </span>
          <motion.svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0 text-mute" animate={{ rotate: open ? 45 : 0 }} transition={reduced ? { duration: 0 } : spring.plus} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 1.5v9M1.5 6h9" />
          </motion.svg>
        </button>
      </h3>
      <motion.div
        id={bodyId}
        role="group"
        aria-labelledby={headId}
        inert={!open || undefined}
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={reduced || instant ? { duration: 0 } : tween.collapse}
        onAnimationComplete={() => setPhase(open ? "open" : "closed")}
        style={{ overflow: phase === "open" ? "visible" : "hidden", visibility: phase === "closed" ? "hidden" : "visible" }}
        data-group-body={id}
      >
        <div className="grid gap-3.5 pb-5 pt-1">{children}</div>
      </motion.div>
    </StaggerItem>
  );
}

/* ------------------------------------------------------------------------------------------- top bar */

export interface FormToolbarProps {
  /** Show `Letzten Trade duplizieren` (new trade, the journal has a trade). */
  canDuplicate: boolean;
  onDuplicate: () => void;
  /** The sentence after a duplicate ("Vom letzten Trade übernommen: …"), "" before. */
  note: string;
  onCustomize: () => void;
}

/** The slim bar above the core: duplicate the last trade, open the field customiser, one honest sentence below. */
export function FormToolbar({ canDuplicate, onDuplicate, note, onCustomize }: FormToolbarProps) {
  return (
    <StaggerItem data-testid="form-toolbar" className="grid gap-2 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        {canDuplicate && (
          <Button size="sm" className="pointer-coarse:min-h-11" onClick={onDuplicate} data-testid="duplicate-last">
            {DUPLICATE_LABEL}
          </Button>
        )}
        <Button size="sm" className="ml-auto pointer-coarse:min-h-11" onClick={onCustomize} data-testid="customize-open">
          {CUSTOMIZE_COPY.open}
        </Button>
      </div>
      {canDuplicate && (
        <p role="status" data-testid="duplicate-note" className="m-0 text-xs text-faint">
          {note || DUPLICATE_HINT}
        </p>
      )}
    </StaggerItem>
  );
}

/* ----------------------------------------------------------------------------------------- customise */

export interface FieldCustomizerProps {
  layout: FormLayout;
  isDefault: boolean;
  onMove: (id: FieldId, zone: ZoneId) => void;
  onReset: () => void;
  onDone: () => void;
  /** The sentence after a reset (live region), "" otherwise. */
  note: string;
}

/**
 * `Felder anpassen`: one row per field with a native select for its place (core or one of the groups) – keyboard and
 * screen reader work like any form; no drag needed on a phone. Changes apply and are stored at once.
 */
export function FieldCustomizer({ layout, isDefault, onMove, onReset, onDone, note }: FieldCustomizerProps) {
  const n = coreCount(layout);
  return (
    <StaggerItem data-testid="field-customizer" className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold">{CUSTOMIZE_COPY.title}</h3>
        <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" onClick={onDone} data-testid="customize-done">
          {CUSTOMIZE_COPY.done}
        </Button>
      </div>
      <p className="m-0 text-[12.5px] leading-relaxed text-mute">{CUSTOMIZE_COPY.lead}</p>
      <p className="m-0 text-xs text-faint" data-testid="customize-core-count" aria-live="polite">
        Kern: {n} {n === 1 ? "Feld" : "Felder"}
      </p>
      <ul className="m-0 grid list-none gap-1 p-0" aria-label={CUSTOMIZE_COPY.list}>
        {FIELDS.map((d) => {
          const sid = `cz-${d.id}`;
          return (
            <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-1.5 first:border-t-0">
              <label htmlFor={sid} className="text-[13px] leading-snug">
                {d.label}
              </label>
              <select
                id={sid}
                data-testid={sid}
                value={layout[d.id]}
                onChange={(e) => {
                  const z = e.target.value;
                  if (isZoneId(z)) onMove(d.id, z);
                }}
                className={cn(inputClass, "w-[10.5rem] pointer-coarse:min-h-11 sm:w-56")}
              >
                <option value="core">{CUSTOMIZE_COPY.core}</option>
                {GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-1.5 border-t border-line pt-4">
        <div>
          <Button size="sm" className="pointer-coarse:min-h-11" disabled={isDefault} onClick={onReset} data-testid="customize-reset">
            {CUSTOMIZE_COPY.reset}
          </Button>
        </div>
        <p className="m-0 text-xs text-faint" role="status" data-testid="customize-note">
          {note || CUSTOMIZE_COPY.resetNote}
        </p>
      </div>
    </StaggerItem>
  );
}
