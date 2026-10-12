/**
 * `Risiko-Einstellungen` (P05): writes at once (like the Lage / Box settings – no save button; the settings page's draft
 * does not hold these keys, so its save keeps them). The daily loss, the loss per trade and the trades per day are the
 * SAME values as the settings page's "Disziplin-Grenzen" (`settings.discipline`) – edited here, not duplicated. All
 * other values live in `settings.risk` (sanitised by `riskSettingsOf`). A number commits on blur / Enter; an invalid
 * one shakes its field and keeps the stored value. The maintenance tiers are an editable table (approximation).
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { DEFAULT_TIERS, riskLimits, riskSettingsOf, sanitizeTiers, TIERS_MAX, withRiskSettings, type MaintTier, type RiskSettings } from "@/domain/risk";
import { cn } from "@/lib/cn";
import { n0 } from "@/lib/format";
import { Switch } from "@/motion/Switch";
import { dwell, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { parseInput, toInput } from "./riskStore";
import { RISIKO } from "./strings";
import { RiskCard } from "./ui";

const S = RISIKO.settings;

type DisciplinePatch = Partial<{ maxLossDayPct: number; maxLossTradePct: number; maxTrades: { makro: number; scalp: number } }>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Writes `settings.risk` / `settings.discipline` at once; "same" when nothing changes. */
export async function writeRisk(patch: Partial<RiskSettings>, discipline?: DisciplinePatch): Promise<"ok" | "same" | "fail"> {
  const { settings, saveSettings } = useJournal.getState();
  const raw = settings as typeof settings & { risk?: unknown; discipline?: unknown };
  const risk = withRiskSettings(raw.risk, patch);
  const prevDisc = isObj(raw.discipline) ? raw.discipline : {};
  let disc: unknown = raw.discipline;
  if (discipline) {
    const next = { ...prevDisc, ...discipline };
    if (JSON.stringify(next) !== JSON.stringify(prevDisc)) disc = next;
  }
  if (risk === raw.risk && disc === raw.discipline) return "same";
  try {
    await saveSettings({ ...settings, risk, discipline: disc } as typeof settings);
    return "ok";
  } catch {
    return "fail";
  }
}

interface NumSpec {
  id: string;
  label: string;
  suffix: string;
  /** stored value → shown number */
  get: (l: ReturnType<typeof riskLimits>) => number;
  /** shown number → the patch (null = invalid) */
  put: (v: number) => { risk?: Partial<RiskSettings>; discipline?: DisciplinePatch } | null;
  help?: string;
  digits?: number;
}

const pctSpec = (id: string, label: string, key: keyof RiskSettings, lo: number, hi: number, help?: string): NumSpec => ({
  id,
  label,
  suffix: "%",
  help,
  digits: 2,
  get: (l) => (l[key] as number) * 100,
  put: (v) => (v / 100 >= lo && v / 100 <= hi ? { risk: { [key]: v / 100 } as Partial<RiskSettings> } : null),
});

const GROUPS: { title: string; fields: NumSpec[] }[] = [
  {
    title: "Grenzen",
    fields: [
      { id: "rs-day", label: "Tagesverlust", suffix: "%", digits: 2, help: "= Disziplin-Grenze", get: (l) => l.maxLossDayPct * 100, put: (v) => (v >= 0.01 && v <= 100 ? { discipline: { maxLossDayPct: v / 100 } } : null) },
      { id: "rs-trade", label: "Verlust pro Trade", suffix: "%", digits: 2, help: "= Disziplin-Grenze", get: (l) => l.maxLossTradePct * 100, put: (v) => (v >= 0.01 && v <= 100 ? { discipline: { maxLossTradePct: v / 100 } } : null) },
      pctSpec("rs-week", "Wochenverlust", "maxLossWeekPct", 0.001, 1),
      pctSpec("rs-dd", "Drawdown ab Hoch", "maxDrawdownPct", 0.01, 1),
      pctSpec("rs-open", "Offenes Risiko", "maxOpenRiskPct", 0.001, 1),
      pctSpec("rs-warn", "Warnen ab", "warnAt", 0.5, 0.95, "der Grenze"),
    ],
  },
  {
    title: "Pause",
    fields: [
      { id: "rs-closs", label: "Verluste in Folge", suffix: "×", digits: 0, help: "starten die Pause · 0 = aus", get: (l) => l.cooldownLosses, put: (v) => (Number.isInteger(v) && v >= 0 && v <= 10 ? { risk: { cooldownLosses: v } } : null) },
      { id: "rs-cmin", label: "Pausenlänge", suffix: "min", digits: 0, get: (l) => l.cooldownMin, put: (v) => (Number.isInteger(v) && v >= 0 && v <= 1440 ? { risk: { cooldownMin: v } } : null) },
      {
        id: "rs-trades",
        label: "Trades/Tag Scalp",
        suffix: "",
        digits: 0,
        help: "= Disziplin-Grenze",
        get: (l) => l.maxTrades.scalp,
        put: (v) => (Number.isInteger(v) && v >= 1 && v <= 1000 ? { discipline: { maxTrades: { makro: riskLimits(useJournal.getState().settings).maxTrades.makro, scalp: v } } } : null),
      },
      {
        id: "rs-trades-m",
        label: "Trades/Tag Makro",
        suffix: "",
        digits: 0,
        help: "= Disziplin-Grenze",
        get: (l) => l.maxTrades.makro,
        put: (v) => (Number.isInteger(v) && v >= 1 && v <= 1000 ? { discipline: { maxTrades: { scalp: riskLimits(useJournal.getState().settings).maxTrades.scalp, makro: v } } } : null),
      },
    ],
  },
  {
    title: "Rechner",
    fields: [
      pctSpec("rs-risk", "Risiko pro Trade", "riskPerTradePct", 0.0005, 0.2),
      pctSpec("rs-fee", "Gebühr pro Seite", "feePct", 0, 0.01, "Taker"),
      pctSpec("rs-slip", "Slippage", "slippagePct", 0, 0.05, "am Stop"),
      { id: "rs-atr", label: "ATR-Faktor", suffix: "× ATR", digits: 2, get: (l) => l.atrMult, put: (v) => (v >= 0.25 && v <= 10 ? { risk: { atrMult: v } } : null) },
    ],
  },
];

function NumField({ spec, value, onCommit }: { spec: NumSpec; value: number; onCommit: (spec: NumSpec, v: number) => Promise<boolean> }) {
  const shown = toInput(value, spec.digits ?? 2);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState<number | null>(null);
  const commit = async () => {
    if (text.trim() === shown) return;
    const v = parseInput(text);
    const ok = Number.isFinite(v) && (await onCommit(spec, v));
    if (!ok) {
      setBad(Date.now());
      setText(shown);
    } else setBad(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void commit();
  };
  return (
    <Field label={spec.label} htmlFor={spec.id} suffix={spec.suffix || undefined} help={spec.help} invalidKey={bad}>
      <Input id={spec.id} numeric value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void commit()} onKeyDown={onKey} data-testid={spec.id} />
    </Field>
  );
}

function TierEditor({ tiers, onCommit }: { tiers: readonly MaintTier[]; onCommit: (t: MaintTier[]) => Promise<boolean> }) {
  const reduced = useReducedFx();
  const fmt = (t: readonly MaintTier[]) => t.map((x) => ({ upTo: Number.isFinite(x.upTo) ? n0(x.upTo) : "", mmr: toInput(x.mmr * 100, 3) }));
  const [rows, setRows] = useState(() => fmt(tiers));
  const [bad, setBad] = useState<number | null>(null);
  // the stored table changed (own commit or elsewhere): re-seed the rows without remounting the inputs (focus stays)
  const key = JSON.stringify(tiers.map((t) => [t.upTo, t.mmr]));
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setRows(fmt(tiers));
  }
  const parse = (rs: typeof rows): MaintTier[] | null => {
    const out: MaintTier[] = [];
    for (let i = 0; i < rs.length; i++) {
      const mmr = parseInput(rs[i]!.mmr) / 100;
      const upTo = i === rs.length - 1 ? Infinity : parseInput(rs[i]!.upTo);
      if (!(mmr > 0 && mmr <= 0.5) || !(upTo > 0)) return null;
      out.push({ upTo, mmr });
    }
    const clean = sanitizeTiers(out.map((t) => ({ upTo: Number.isFinite(t.upTo) ? t.upTo : null, mmr: t.mmr })));
    return JSON.stringify(clean.map((t) => [t.upTo, t.mmr])) === JSON.stringify(out.map((t) => [t.upTo, t.mmr])) ? clean : null;
  };
  const commit = async (rs = rows) => {
    const t = parse(rs);
    if (!t) {
      setBad(Date.now());
      return;
    }
    setBad(null);
    if (!(await onCommit(t))) setBad(Date.now());
  };
  const set = (i: number, k: "upTo" | "mmr", v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Field label={S.tiers} help={S.tiersHelp} invalidKey={bad}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_2.25rem] gap-1.5 px-1 text-[10.5px] text-faint sm:hidden" aria-hidden="true">
        <span>{S.tierUpTo} (Positionsgröße)</span>
        <span>Maint. %</span>
      </div>
      <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3" data-testid="risk-tiers">
        <AnimatePresence initial={false}>
          {rows.map((r, i) => {
            const last = i === rows.length - 1;
            return (
              <motion.li
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_2.25rem] items-center gap-1.5"
                initial={reduced ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
                exit={{ opacity: 0, transition: tween.exit }}
                transition={spring.enter}
              >
                {last ? (
                  <span className="px-3 text-[12px] text-faint">{S.tierRest}</span>
                ) : (
                  <Input numeric aria-label={`${S.tierUpTo} (Stufe ${i + 1})`} value={r.upTo} onChange={(e) => set(i, "upTo", e.target.value)} onBlur={() => void commit()} />
                )}
                <div className="relative">
                  <Input numeric aria-label={`Maintenance % (Stufe ${i + 1})`} value={r.mmr} onChange={(e) => set(i, "mmr", e.target.value)} onBlur={() => void commit()} className="pr-7" />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center font-mono text-[11px] text-faint" aria-hidden="true">
                    %
                  </span>
                </div>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    className="touch-hit grid size-9 place-items-center rounded-full text-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
                    aria-label={`Stufe ${i + 1} entfernen`}
                    onClick={() => {
                      const next = rows.filter((_, j) => j !== i);
                      setRows(next);
                      void commit(next);
                    }}
                  >
                    ×
                  </button>
                ) : (
                  <span />
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={rows.length >= TIERS_MAX}
          onClick={() => {
            const prevCap = rows.length > 1 ? parseInput(rows[rows.length - 2]!.upTo) : 0;
            const lastMmr = parseInput(rows[rows.length - 1]!.mmr);
            const next = [...rows.slice(0, -1), { upTo: n0((prevCap > 0 ? prevCap : 50_000) * 10), mmr: rows[rows.length - 1]!.mmr }, { upTo: "", mmr: toInput((lastMmr > 0 ? lastMmr : 0.5) * 2, 3) }];
            setRows(next);
            void commit(next);
          }}
        >
          {S.tierAdd}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const next = fmt(DEFAULT_TIERS);
            setRows(next);
            void onCommit([...DEFAULT_TIERS]);
          }}
        >
          {S.tierReset}
        </Button>
      </div>
    </Field>
  );
}

export function RiskSettingsCard() {
  const reduced = useReducedFx();
  const settings = useJournal((s) => s.settings);
  const pushToast = useUi((s) => s.pushToast);
  const limits = riskLimits(settings);
  const stored = riskSettingsOf((settings as { risk?: unknown }).risk);
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(0), dwell.done * 1000);
    return () => clearTimeout(t);
  }, [saved]);

  const done = (r: "ok" | "same" | "fail"): boolean => {
    if (r === "fail") {
      pushToast({ kind: "error", title: S.failed });
      return false;
    }
    if (r === "ok") setSaved(Date.now());
    return true;
  };
  const commitNum = async (spec: NumSpec, v: number): Promise<boolean> => {
    const p = spec.put(v);
    if (!p) return false;
    return done(await writeRisk(p.risk ?? {}, p.discipline));
  };

  return (
    <RiskCard
      title={S.title}
      note={S.note}
      data-testid="risk-settings"
      action={
        <AnimatePresence>
          {saved ? (
            <motion.span
              key={saved}
              className="text-[11.5px] text-win"
              initial={reduced ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={spring.enter}
              data-testid="risk-settings-saved"
            >
              ✓ {S.saved}
            </motion.span>
          ) : null}
        </AnimatePresence>
      }
    >
      <div className="grid gap-5">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
          <span className="grid min-w-0 gap-0.5">
            <label htmlFor="rs-guard" className="cursor-pointer text-[13px] text-fg">
              {S.guard}
            </label>
            <span id="rs-guard-help" className="text-[11px] text-faint">
              {S.guardHelp}
            </span>
          </span>
          <Switch id="rs-guard" checked={stored.guard} onCheckedChange={(guard) => void writeRisk({ guard }).then(done)} aria-describedby="rs-guard-help" className="touch-hit mt-0.5 shrink-0" tone="signal" />
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="grid gap-2.5">
            <span className="label">{g.title}</span>
            <div className={cn("grid grid-cols-2 gap-3", g.fields.length > 4 ? "lg:grid-cols-6" : "lg:grid-cols-4")}>
              {g.fields.map((f) => (
                // keyed by the stored value: a change from elsewhere (another tab, the settings page) re-seeds the field
                <NumField key={`${f.id}:${f.get(limits)}`} spec={f} value={f.get(limits)} onCommit={commitNum} />
              ))}
            </div>
          </div>
        ))}
        <div className="grid gap-3">
          <TierEditor tiers={stored.tiers} onCommit={async (tiers) => done(await writeRisk({ tiers }))} />
        </div>
      </div>
    </RiskCard>
  );
}
