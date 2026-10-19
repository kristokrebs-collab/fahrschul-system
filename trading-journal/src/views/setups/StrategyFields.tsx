/**
 * The strategy sections of the setup editor (P07, additive below the classic fields): entry and exit criteria, strategy
 * tags, and – folded – the risk model, markets / timeframes, automatic recognition and the best-practice examples
 * (picked from this setup's own closed trades, screenshots of P06 as thumbnails). Controlled: the editor holds the
 * `StrategyExtras` (its own baseline for the dirty guard) and saves them with `withStrategy`.
 *
 * Motion: rows rise in / collapse out (`AnimatePresence`, `spring.enter`, exit `tween.exit`), chips pop (`spring.pop`),
 * the advanced block opens through `Collapse`; reduced motion: instant.
 */
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { DEFAULT_WATCHLIST, type Grade, type SetupKind } from "@/domain/boxes";
import type { SessionKey } from "@/domain/insights/time";
import { marketKey, PLAN_EXITS, STOP_RULE_LABEL, type CriteriaItem, type StopRule, type StrategyExtras } from "@/domain/strategy";
import type { EnrichedTrade } from "@/domain/types";
import { newChecklistItemId } from "@/lib/ids";
import { cn } from "@/lib/cn";
import { date as fmtDate, r as fmtR } from "@/lib/format";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Collapse, Expander } from "@/primitives/Expander";
import { Icon } from "@/primitives/icons";
import { Input } from "@/primitives/Input";
import { ShotImage } from "@/journal/screenshots/ShotThumb";

export const STRATEGY_FIELD_STRINGS = {
  title: "Strategie",
  sub: "Optional. Macht die Grundlage messbar und automatisch erkennbar.",
  entry: "Entry-Kriterien",
  entryHelp: "Wann steigst du ein? Ein Satz pro Kriterium.",
  exit: "Exit-Kriterien",
  exitHelp: "Wie steigst du aus? Daraus misst das Playbook die Exit-Treue.",
  addEntry: "+ Entry-Kriterium",
  addExit: "+ Exit-Kriterium",
  remove: "Kriterium entfernen",
  tags: "Strategie-Tags",
  tagsPlaceholder: "Tag eingeben, Enter",
  more: "Risiko, Märkte und Auto-Erkennung",
  risk: "Risiko-Modell",
  riskPct: "Risiko %",
  maxLev: "Max. Hebel",
  minRR: "Min. CRV",
  stop: "Stop nach",
  markets: "Märkte",
  marketsPlaceholder: "z. B. BTCUSDT, Enter",
  tf: "Timeframes",
  auto: "Auto-Erkennung",
  autoHelp: "Danach ordnet die Klassifizierung Trades dieser Grundlage zu.",
  boxKinds: "Box-Setup beim Einstieg",
  minGrade: "Mindest-Box-Note",
  minStrength: "Einstiegs-Check mindestens",
  sessions: "Sessions",
  sides: "Richtung",
  examples: "Best-Practice-Beispiele",
  examplesHelp: "Deine besten Trades mit dieser Grundlage als Vorbild.",
  examplesNone: "Beispiele wählst du, sobald es abgeschlossene Trades mit dieser Grundlage gibt.",
  none: "egal",
} as const;

const KINDS: readonly { v: SetupKind; label: string }[] = [
  { v: "range", label: "Range" },
  { v: "breakout", label: "Ausbruch" },
  { v: "retest", label: "Retest" },
  { v: "fakeout", label: "Fehlausbruch" },
];
const GRADES: readonly Grade[] = ["A+", "A", "B"];
const SESSIONS: readonly { v: SessionKey; label: string }[] = [
  { v: "asia", label: "Asien" },
  { v: "london", label: "London" },
  { v: "ny", label: "New York" },
  { v: "late", label: "Spät" },
  { v: "weekend", label: "Wochenende" },
];
const TFS: readonly string[] = ["15m", "30m", "1h", "4h", "1D", "1W"];
const STOPS = Object.keys(STOP_RULE_LABEL) as StopRule[];
export const EXAMPLE_PICK_MAX = 12;

export interface StrategyFieldsProps {
  value: StrategyExtras;
  onChange: (patch: Partial<StrategyExtras>) => void;
  /** closed trades of this setup (examples), best first is done here */
  trades: readonly EnrichedTrade[];
  /** tags used by the other setups (suggestions) */
  knownTags?: readonly string[];
}

export function StrategyFields({ value, onChange, trades, knownTags = [] }: StrategyFieldsProps) {
  const id = useId();
  const hasAdvanced =
    value.riskModel.riskPct != null || value.riskModel.maxLeverage != null || value.riskModel.minRR != null || value.riskModel.stop != null || value.markets.length > 0 || value.tf.length > 0 || value.auto.boxKinds.length > 0 || value.auto.minGrade != null || value.auto.minStrength != null || value.auto.sessions.length > 0 || value.auto.sides.length > 0;
  const [open, setOpen] = useState(hasAdvanced);
  const auto = value.auto;
  const rm = value.riskModel;
  const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="grid gap-4 border-t border-line pt-4" data-testid="setup-strategy-fields">
      <div className="grid gap-0.5">
        <span className="label !text-fg">{STRATEGY_FIELD_STRINGS.title}</span>
        <span className="text-[12px] text-faint">{STRATEGY_FIELD_STRINGS.sub}</span>
      </div>

      <Group label={STRATEGY_FIELD_STRINGS.entry} help={STRATEGY_FIELD_STRINGS.entryHelp}>
        <CriteriaList items={value.entryCriteria} onChange={(entryCriteria) => onChange({ entryCriteria })} prefix="Entry" addLabel={STRATEGY_FIELD_STRINGS.addEntry} />
      </Group>

      <Group label={STRATEGY_FIELD_STRINGS.exit} help={STRATEGY_FIELD_STRINGS.exitHelp}>
        <CriteriaList items={value.exitCriteria} onChange={(exitCriteria) => onChange({ exitCriteria })} prefix="Exit" addLabel={STRATEGY_FIELD_STRINGS.addExit} quick={PLAN_EXITS} />
      </Group>

      <Group label={STRATEGY_FIELD_STRINGS.tags}>
        <ChipInput values={value.tags} onChange={(tags) => onChange({ tags })} placeholder={STRATEGY_FIELD_STRINGS.tagsPlaceholder} ariaLabel={STRATEGY_FIELD_STRINGS.tags} suggestions={knownTags} />
      </Group>

      <div className="rounded-2xl border border-line bg-ink-950/40">
        <div className="flex min-h-11 items-center justify-between gap-3 pl-4 pr-2">
          <span className="text-[12.5px] font-medium text-fg/90">{STRATEGY_FIELD_STRINGS.more}</span>
          <Expander open={open} onToggle={() => setOpen((o) => !o)} label={STRATEGY_FIELD_STRINGS.more} controls={`sf-more-${id}`} className="touch-hit" />
        </div>
        <Collapse open={open} id={`sf-more-${id}`}>
          <div className="grid gap-4 px-4 pb-4 pt-1">
            <Group label={STRATEGY_FIELD_STRINGS.risk}>
              <div className="grid grid-cols-3 gap-2">
                <NumInput label={STRATEGY_FIELD_STRINGS.riskPct} value={rm.riskPct} onCommit={(riskPct) => onChange({ riskModel: { ...rm, riskPct } })} />
                <NumInput label={STRATEGY_FIELD_STRINGS.maxLev} value={rm.maxLeverage} onCommit={(maxLeverage) => onChange({ riskModel: { ...rm, maxLeverage } })} />
                <NumInput label={STRATEGY_FIELD_STRINGS.minRR} value={rm.minRR} onCommit={(minRR) => onChange({ riskModel: { ...rm, minRR } })} />
              </div>
              <Pills label={STRATEGY_FIELD_STRINGS.stop}>
                {STOPS.map((s) => (
                  <Pill key={s} on={rm.stop === s} onClick={() => onChange({ riskModel: { ...rm, stop: rm.stop === s ? null : s } })}>
                    {STOP_RULE_LABEL[s]}
                  </Pill>
                ))}
              </Pills>
            </Group>
            <Group label={STRATEGY_FIELD_STRINGS.markets}>
              <ChipInput values={value.markets} onChange={(markets) => onChange({ markets: markets.map(marketKey).filter((m, i, a) => m && a.indexOf(m) === i) })} placeholder={STRATEGY_FIELD_STRINGS.marketsPlaceholder} ariaLabel={STRATEGY_FIELD_STRINGS.markets} suggestions={DEFAULT_WATCHLIST} upper />
            </Group>
            <Pills label={STRATEGY_FIELD_STRINGS.tf}>
              {TFS.map((tf) => (
                <Pill key={tf} on={value.tf.includes(tf)} onClick={() => onChange({ tf: toggle(value.tf, tf) })}>
                  {tf}
                </Pill>
              ))}
            </Pills>
            <Group label={STRATEGY_FIELD_STRINGS.auto} help={STRATEGY_FIELD_STRINGS.autoHelp}>
              <Pills label={STRATEGY_FIELD_STRINGS.boxKinds}>
                {KINDS.map((k) => (
                  <Pill key={k.v} on={auto.boxKinds.includes(k.v)} onClick={() => onChange({ auto: { ...auto, boxKinds: toggle(auto.boxKinds, k.v) } })}>
                    {k.label}
                  </Pill>
                ))}
              </Pills>
              <Pills label={STRATEGY_FIELD_STRINGS.minGrade}>
                {GRADES.map((g) => (
                  <Pill key={g} on={auto.minGrade === g} onClick={() => onChange({ auto: { ...auto, minGrade: auto.minGrade === g ? null : g } })}>
                    {g}
                  </Pill>
                ))}
              </Pills>
              <Pills label={STRATEGY_FIELD_STRINGS.minStrength}>
                {[2, 3, 4].map((v) => (
                  <Pill key={v} on={auto.minStrength === v} onClick={() => onChange({ auto: { ...auto, minStrength: auto.minStrength === v ? null : v } })}>
                    Stärke {v}
                  </Pill>
                ))}
              </Pills>
              <Pills label={STRATEGY_FIELD_STRINGS.sessions}>
                {SESSIONS.map((s) => (
                  <Pill key={s.v} on={auto.sessions.includes(s.v)} onClick={() => onChange({ auto: { ...auto, sessions: toggle(auto.sessions, s.v) } })}>
                    {s.label}
                  </Pill>
                ))}
              </Pills>
              <Pills label={STRATEGY_FIELD_STRINGS.sides}>
                {(["long", "short"] as const).map((s) => (
                  <Pill key={s} on={auto.sides.includes(s)} onClick={() => onChange({ auto: { ...auto, sides: toggle(auto.sides, s) } })}>
                    {s === "long" ? "Long" : "Short"}
                  </Pill>
                ))}
              </Pills>
            </Group>
          </div>
        </Collapse>
      </div>

      <Group label={STRATEGY_FIELD_STRINGS.examples} help={trades.length ? STRATEGY_FIELD_STRINGS.examplesHelp : STRATEGY_FIELD_STRINGS.examplesNone}>
        {trades.length > 0 && <ExamplePicker trades={trades} picked={value.examples} onChange={(examples) => onChange({ examples })} />}
      </Group>
    </div>
  );
}

function Group({ label, help, children }: { label: string; help?: string; children?: ReactNode }) {
  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      <div className="grid gap-0.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{label}</span>
        {help && <span className="text-[11.5px] text-faint">{help}</span>}
      </div>
      {children}
    </div>
  );
}

function Pills({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] text-faint">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  const reduced = useReducedFx();
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      whileTap={reduced ? undefined : { scale: 0.94 }}
      transition={spring.press}
      className={cn("min-h-9 rounded-full border px-3 text-[12px] font-medium transition-colors duration-200 pointer-coarse:min-h-11", on ? "border-transparent bg-fg text-ink-900" : "border-line-2 text-mute hover:border-white/30 hover:text-fg")}
    >
      {children}
    </motion.button>
  );
}

function CriteriaList({ items, onChange, prefix, addLabel, quick }: { items: readonly CriteriaItem[]; onChange: (items: CriteriaItem[]) => void; prefix: string; addLabel: string; quick?: readonly string[] }) {
  const reduced = useReducedFx();
  const add = (text = "") => onChange([...items, { id: newChecklistItemId(), text }]);
  const unused = (quick ?? []).filter((q) => !items.some((c) => c.text.trim() === q));
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        <AnimatePresence initial={false}>
          {items.map((c, i) => (
            <motion.li key={c.id} className="flex gap-2" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: tween.exit }} transition={spring.enter}>
              <Input value={c.text} aria-label={`${prefix} ${i + 1}`} onChange={(e) => onChange(items.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))} autoComplete="off" />
              <button type="button" aria-label={`${STRATEGY_FIELD_STRINGS.remove}: ${prefix} ${i + 1}`} onClick={() => onChange(items.filter((x) => x.id !== c.id))} className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-2 text-mute hover:text-loss pointer-coarse:size-11 [&>svg]:size-4">
                <Icon name="x" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => add()}>
          {addLabel}
        </Button>
        {unused.map((q) => (
          <button key={q} type="button" onClick={() => add(q)} className="min-h-8 rounded-full border border-dashed border-line-2 px-2.5 text-[11.5px] text-mute transition-colors hover:border-white/30 hover:text-fg pointer-coarse:min-h-11">
            + {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChipInput({ values, onChange, placeholder, ariaLabel, suggestions = [], upper = false }: { values: readonly string[]; onChange: (v: string[]) => void; placeholder: string; ariaLabel: string; suggestions?: readonly string[]; upper?: boolean }) {
  const [draft, setDraft] = useState("");
  const reduced = useReducedFx();
  const commit = (raw = draft) => {
    const parts = raw
      .split(",")
      .map((s) => (upper ? s.trim().toUpperCase() : s.trim()))
      .filter(Boolean);
    if (!parts.length) return;
    onChange([...values, ...parts.filter((p) => !values.includes(p))].slice(0, 40));
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
  };
  const open = useMemo(() => suggestions.filter((s) => !values.includes(s)).slice(0, 6), [suggestions, values]);
  return (
    <div className="grid gap-2">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={ariaLabel}>
          <AnimatePresence initial={false}>
            {values.map((v) => (
              <motion.li key={v} initial={reduced ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0, transition: tween.exit }} transition={spring.pop}>
                <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-white/20 bg-white/[0.05] pl-3 pr-1 text-[12px] text-fg">
                  {v}
                  <button type="button" aria-label={`${v} entfernen`} onClick={() => onChange(values.filter((x) => x !== v))} className="touch-hit grid size-6 place-items-center rounded-full text-mute hover:text-fg [&>svg]:size-3">
                    <Icon name="x" />
                  </button>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => commit()} placeholder={placeholder} aria-label={ariaLabel} autoComplete="off" className={upper ? "font-mono uppercase" : undefined} />
      {open.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {open.map((s) => (
            <button key={s} type="button" onClick={() => commit(s)} className="min-h-8 rounded-full border border-dashed border-line-2 px-2.5 text-[11.5px] text-mute transition-colors hover:border-white/30 hover:text-fg pointer-coarse:min-h-11">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NumInput({ label, value, onCommit }: { label: string; value: number | null; onCommit: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const t = draft.trim();
    const v = Number(t.replace(",", "."));
    onCommit(!t ? null : Number.isFinite(v) && v > 0 ? v : value);
    setDraft(null);
  };
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-faint">{label}</span>
      <Input numeric value={draft ?? (value == null ? "" : String(value).replace(".", ","))} placeholder={STRATEGY_FIELD_STRINGS.none} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="text-[13px]" />
    </label>
  );
}

function ExamplePicker({ trades, picked, onChange }: { trades: readonly EnrichedTrade[]; picked: readonly string[]; onChange: (ids: string[]) => void }) {
  const best = useMemo(
    () =>
      [...trades]
        .sort((a, b) => Number(picked.includes(b.id)) - Number(picked.includes(a.id)) || Number((b.screenshots?.length ?? 0) > 0) - Number((a.screenshots?.length ?? 0) > 0) || (b.r ?? b.pnl ?? -Infinity) - (a.r ?? a.pnl ?? -Infinity))
        .slice(0, EXAMPLE_PICK_MAX),
    [trades, picked],
  );
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={STRATEGY_FIELD_STRINGS.examples}>
      {best.map((t) => {
        const on = picked.includes(t.id);
        const shot = t.screenshots?.[0];
        return (
          <li key={t.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? picked.filter((x) => x !== t.id) : [...picked, t.id])}
              className={cn("grid w-full overflow-hidden rounded-xl border text-left transition-colors duration-200", on ? "border-fg bg-white/[0.05]" : "border-line hover:border-white/25")}
            >
              <span className="block aspect-[16/9] w-full bg-ink-950">{shot ? <ShotImage shot={shot} /> : <span className="grid size-full place-items-center font-mono text-[11px] text-faint">{t.pair}</span>}</span>
              <span className="grid gap-0.5 px-2.5 py-2">
                <span className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span className={cn("font-mono", t.side === "short" ? "text-loss" : "text-win")}>{t.side === "short" ? "▼" : "▲"}</span>
                  <span className={cn("num font-mono font-semibold", (t.r ?? t.pnl ?? 0) >= 0 ? "text-win" : "text-loss")}>{t.r != null ? fmtR(t.r) : ""}</span>
                </span>
                <span className="truncate text-[10.5px] text-faint">{fmtDate(new Date(t.date))}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
