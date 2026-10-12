import type { ReactNode } from "react";
import { isCloudAvailable } from "@/cloud";
import type { GoalDraft } from "@/domain/growth/goals";
import { cn } from "@/lib/cn";
import { MotionNumber } from "@/motion/MotionNumber";
import { AsciiCascade, LaunchGrid, LaunchSlot, PixelTextFill, Typewriter } from "@/motion/pulse";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { PAGES } from "@/store/uiStore";

/** German copy of the tour (P13). */
export const TOUR = {
  title: "Einführung",
  rail: "Fortschritt der Einführung",
  steps: { start: "Start", konten: "Konten", setups: "Setups", boerse: "Börse", ziel: "Ziel" },
  skip: "Überspringen",
  back: "Zurück",
  next: "Weiter",
  hold: "Halten zum Starten",
  holding: "Gleich geht's los …",
  start: {
    word: "WILLKOMMEN",
    lead: "Ab heute zählt",
    slots: ["Gefühl", "Zufall", "FOMO", "Disziplin"],
    lines: ["Dein Journal zeigt dir, was funktioniert –", "und was du lassen solltest."],
    hud: "In vier kurzen Schritten startklar.",
    cards: ["Journal", "Setups", "Risiko", "Ziele"],
  },
  konten: {
    title: "Konten und Kapital",
    lead: "Mit wie viel startest du? Das Journal rechnet Rendite, Drawdown und Risiko pro Trade daraus.",
    makro: "Startkapital Makro",
    makroHelp: "Längere Swings, Tages- und Wochencharts.",
    scalp: "Startkapital Scalp",
    scalpHelp: "Schnelle Trades, kleine Timeframes.",
    currency: "Währung",
    total: "Gesamt",
    invalid: "Bitte eine Zahl ab 0 eintragen.",
  },
  setups: {
    title: "Deine Setups",
    lead: "Setups sind deine Entscheidungsgrundlagen: feste Regeln mit Checkliste. Das Journal misst, welche wirklich Geld bringt – die stärksten stehen immer oben.",
    count: (n: number) => (n === 1 ? "1 Grundlage ist schon angelegt" : `${n} Grundlagen sind schon angelegt`),
    add: "Eigene Grundlage anlegen",
    addHint: "Die Einführung wartet so lange.",
  },
  boerse: {
    title: "Börse verbinden",
    cloudLead: "Verbinde deine Börse im Konto – nur mit Leserechten. Trades und Gebühren kommen dann von selbst ins Journal.",
    open: "Einführung beenden und Konto öffnen",
    offLead: "Der Börsen-Sync braucht das Cloud-Konto. In dieser Version ist es nicht eingerichtet.",
    offHint: "Du trägst Trades selbst ein – mit N oder dem roten Plus – oder importierst ein Backup unter Einstellungen → Daten.",
  },
  ziel: {
    title: "Ein erstes Ziel",
    lead: "Ein Prozessziel statt eines Gewinnziels: Disziplin kannst du steuern, das Ergebnis nicht.",
    none: "Ohne Ziel starten",
    saved: "Ziel gespeichert",
  },
  done: { title: "Startklar", detail: "Viel Erfolg beim ersten Trade." },
} as const;

export type GoalTemplateId = "journal" | "checklist" | "limit" | "plan";

export const GOAL_TEMPLATES: readonly { id: GoalTemplateId; title: string; text: string; draft: GoalDraft }[] = [
  {
    id: "journal",
    title: "Jeden Trade mit Notiz",
    text: "Mindestens 9 von 10 Trades pro Woche mit Begründung oder Review.",
    draft: { title: "Jeden Trade mit Notiz abschließen", kind: "process", metric: "journalRate", target: 0.9, comparator: "atLeast", period: "week", source: { kind: "onboarding" } },
  },
  {
    id: "checklist",
    title: "Checkliste komplett",
    text: "8 von 10 Trades pro Woche mit vollständiger Checkliste.",
    draft: { title: "Checkliste bei jedem Trade komplett", kind: "process", metric: "checklistRate", target: 0.8, comparator: "atLeast", period: "week", source: { kind: "onboarding" } },
  },
  {
    id: "limit",
    title: "Höchstens 3 Trades am Tag",
    text: "Schützt vor Overtrading und Revenge-Trades.",
    draft: { title: "Höchstens 3 Trades pro Tag", kind: "limit", metric: "tradesPerDay", target: 3, comparator: "atMost", period: "day", source: { kind: "onboarding" } },
  },
  {
    id: "plan",
    title: "Plan einhalten",
    text: "8 von 10 Trades pro Woche nach Plan.",
    draft: { title: "Nach Plan traden", kind: "process", metric: "planAdherence", target: 0.8, comparator: "atLeast", period: "week", source: { kind: "onboarding" } },
  },
];

/* ------------------------------------------------------------------------------------------------------- 1 Start */

function StartCard({ label, index }: { label: string; index: number }) {
  // decorative illustration (no figures – nothing here pretends to be data)
  return (
    <div className="grid aspect-[16/10] content-between bg-ink-900 p-2.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-mute">{label}</span>
      <span className="grid grid-cols-6 gap-[3px]" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} className={cn("aspect-square rounded-full", (i * 7 + index * 5) % 4 === 0 ? (index === 3 ? "bg-signal" : "bg-fg") : "bg-white/10")} />
        ))}
      </span>
    </div>
  );
}

export function StepStart({ play }: { play: number }) {
  return (
    <div data-theme-scope="dark" className="rounded-[28px]">
      <LaunchGrid
        play={play}
        playOnView={false}
        label={TOUR.title}
        slots={TOUR.start.slots.map((w, i) => (
          <span key={w} className={cn("rounded-md px-2 py-0.5", i === TOUR.start.slots.length - 1 ? "bg-fg text-ink-950" : "bg-ink-700 text-fg")}>
            {w}
          </span>
        ))}
        cards={TOUR.start.cards.map((c, i) => (
          <StartCard key={c} label={c} index={i} />
        ))}
        hud={<Typewriter text={TOUR.start.hud} className="font-mono text-[12.5px] text-mute" delay={2600} />}
      >
        <AsciiCascade text={TOUR.start.word} as="h3" className="font-dot text-[clamp(26px,7vw,46px)] font-extrabold leading-none tracking-[0.04em]" drop={0.6} reserve />
        <p className="text-[clamp(18px,3.4vw,24px)] font-semibold leading-snug text-fg">
          {TOUR.start.lead} <LaunchSlot />
        </p>
        <PixelTextFill lines={[...TOUR.start.lines]} className="text-[14px] leading-relaxed text-mute" delay={900} />
      </LaunchGrid>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------- 2 Konten */

export interface KontenDraft {
  makro: string;
  scalp: string;
  currency: "USDT" | "USD" | "EUR";
}

export const parseAmount = (s: string): number | null => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return 0;
  // German input: "25.000,50" → 25000.5; plain "2500.5" stays
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function StepKonten({ draft, onChange, invalid }: { draft: KontenDraft; onChange: (d: KontenDraft) => void; invalid: "makro" | "scalp" | null }) {
  const total = (parseAmount(draft.makro) ?? 0) + (parseAmount(draft.scalp) ?? 0);
  return (
    <div className="grid gap-5">
      <StepHead title={TOUR.konten.title} lead={TOUR.konten.lead} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={TOUR.konten.makro} htmlFor="ob-makro" help={TOUR.konten.makroHelp} suffix={draft.currency} error={invalid === "makro" ? TOUR.konten.invalid : undefined}>
          <Input id="ob-makro" numeric value={draft.makro} invalid={invalid === "makro"} onChange={(e) => onChange({ ...draft, makro: e.target.value })} />
        </Field>
        <Field label={TOUR.konten.scalp} htmlFor="ob-scalp" help={TOUR.konten.scalpHelp} suffix={draft.currency} error={invalid === "scalp" ? TOUR.konten.invalid : undefined}>
          <Input id="ob-scalp" numeric value={draft.scalp} invalid={invalid === "scalp"} onChange={(e) => onChange({ ...draft, scalp: e.target.value })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-white/[0.02] px-4 py-3">
        <span className="grid gap-1">
          <span id="ob-currency-label" className="label">
            {TOUR.konten.currency}
          </span>
          <Segmented aria-labelledby="ob-currency-label" options={[{ v: "USDT", label: "USDT" }, { v: "USD", label: "USD" }, { v: "EUR", label: "EUR" }]} value={draft.currency} onChange={(v) => onChange({ ...draft, currency: v })} size="sm" />
        </span>
        <span className="grid justify-items-end gap-0.5">
          <span className="label">{TOUR.konten.total}</span>
          <span className="dot-num text-[26px] leading-none text-fg">
            <MotionNumber value={total} decimals={0} suffix={` ${draft.currency}`} tone="none" />
          </span>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------- 3 Setups */

export function StepSetups({ setups, onAdd }: { setups: readonly { id: string; name: string; color?: string; checklist?: readonly unknown[] }[]; onAdd: () => void }) {
  return (
    <div className="grid gap-5">
      <StepHead title={TOUR.setups.title} lead={TOUR.setups.lead} />
      <div className="grid gap-2">
        <span className="label">{TOUR.setups.count(setups.length)}</span>
        <ul className="flex flex-wrap gap-2">
          {setups.slice(0, 12).map((s) => (
            <li key={s.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-line-2 bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-fg">
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color || "var(--color-mute)" }} aria-hidden="true" />
              <span className="truncate">{s.name}</span>
              {s.checklist && s.checklist.length > 0 && <span className="font-mono text-[11px] text-faint">{s.checklist.length}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onAdd} className="touch-hit rounded-xl border border-line-2 bg-white/[0.03] px-4 py-2 text-[13px] font-semibold text-fg transition-colors hover:border-white/30">
          + {TOUR.setups.add}
        </button>
        <span className="text-[12px] text-faint">{TOUR.setups.addHint}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------- 4 Börse */

export function StepBoerse({ onOpenAccount }: { onOpenAccount: () => void }) {
  const cloud = isCloudAvailable() && (PAGES as readonly string[]).includes("konto");
  return (
    <div className="grid gap-5">
      <StepHead title={TOUR.boerse.title} lead={cloud ? TOUR.boerse.cloudLead : TOUR.boerse.offLead} />
      {cloud ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onOpenAccount} className="touch-hit rounded-xl border border-line-2 bg-white/[0.03] px-4 py-2 text-[13px] font-semibold text-fg transition-colors hover:border-white/30">
            {TOUR.boerse.open}
          </button>
        </div>
      ) : (
        <div className="flex gap-3 rounded-2xl border border-line bg-white/[0.02] px-4 py-3 text-[13px] leading-relaxed text-mute" data-testid="tour-exchange-off">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          <span>{TOUR.boerse.offHint}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------ 5 Ziel */

export function StepZiel({ value, onChange }: { value: GoalTemplateId | null; onChange: (v: GoalTemplateId | null) => void }) {
  const options: (GoalTemplateId | null)[] = [...GOAL_TEMPLATES.map((g) => g.id), null];
  const selected = options.indexOf(value);
  return (
    <div className="grid gap-5">
      <StepHead title={TOUR.ziel.title} lead={TOUR.ziel.lead} />
      <div role="radiogroup" aria-label={TOUR.ziel.title} className="grid gap-2.5 sm:grid-cols-2">
        {options.map((id, i) => {
          const tpl = GOAL_TEMPLATES.find((g) => g.id === id);
          const on = value === id;
          return (
            <button
              key={id ?? "none"}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={selected === i ? 0 : -1}
              onKeyDown={(e) => {
                const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const n = (i + d + options.length) % options.length;
                onChange(options[n] ?? null);
                (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
              }}
              onClick={() => onChange(id)}
              className={cn(
                "relative grid gap-1 rounded-2xl border px-4 py-3 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-steel/60",
                on ? "border-fg/70 bg-white/[0.05]" : "border-line-2 hover:border-white/30",
                id === null && "sm:col-span-2",
              )}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
                <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-fg" : "border-line-2")} aria-hidden="true">
                  {on && <span className="size-2 rounded-full bg-fg" />}
                </span>
                {tpl ? tpl.title : TOUR.ziel.none}
              </span>
              {tpl && <span className="pl-6 text-[12px] text-faint">{tpl.text}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------- shared */

export function StepHead({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-[clamp(20px,3.2vw,26px)] font-semibold tracking-tight text-fg">{title}</h3>
      <Typewriter text={lead} as="p" className="max-w-[60ch] text-[14px] leading-relaxed text-mute" msPerChar={14} cursor={false} />
      {children}
    </div>
  );
}
