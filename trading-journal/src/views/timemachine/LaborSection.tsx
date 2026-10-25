/**
 * Labor · Zeitmaschine: the plan typed by hand (market, direction, entry, stop, target, timeframe) and played through. The
 * section loads the market's real candles with the Labor's own loader (cache first, closed candles only, nothing new goes to a
 * server of ours) and hands them to the card (`TimeMachineCard`), which computes in a worker. Costs are the ones of the
 * Versuchsaufbau. Editing a price afterwards re-runs the card on the same candles; changing market, timeframe or period asks
 * for new candles first. The form is remembered in this browser as a convenience.
 */
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { normalizeWatchSymbol } from "@/domain/boxes";
import { HIST_MS, type HistInterval } from "@/domain/backtest/types";
import { checkPlan, costText, TM_INTERVAL_TEXT, type TmPlan } from "@/domain/timemachine";
import { Autocomplete } from "@/motion/pulse/Autocomplete";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { boxesCfgOf } from "@/domain/boxes";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { loadErrorKind, loadLabData } from "@/views/labor/historySource";
import { LABOR } from "@/views/labor/strings";
import { useLabor } from "@/views/labor/laborStore";
import { ChipPick, FieldRow, SEG_TOUCH } from "@/views/labor/ui";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { costsOfLab, dataKey, DEFAULT_FORM, FORM_INTERVALS, FORM_PERIODS, missingPrices, optionsOfForm, readPrices, sanitizeForm, type FormPeriod, type FormState } from "./formModel";
import { TM } from "./strings";
import type { TimeMachineCandle } from "./types";

const TimeMachineCard = lazy(() => import("./TimeMachineCard"));

const KEY = storageKey("timemachine");
const SOURCE = "Binance USDⓈ-M";

/** What this browser remembered; without it the market of the Versuchsaufbau, so the section starts where the lab is. */
function initialForm(labSymbol: string): FormState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return sanitizeForm(JSON.parse(raw));
  } catch {
    /* unreadable: start fresh */
  }
  return { ...DEFAULT_FORM, symbol: /^[A-Z0-9]{2,24}$/.test(labSymbol) ? labSymbol : DEFAULT_FORM.symbol };
}
function writeForm(f: FormState): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(f));
  } catch {
    /* private mode / quota: works without remembering */
  }
}

interface Loaded {
  key: string;
  candles: TimeMachineCandle[];
  fetchedAt: number;
  pages: number;
}

type Load = { status: "idle" } | { status: "loading"; done: number; total: number } | { status: "error"; message: string } | { status: "ok"; data: Loaded };

const PERIODS = (Object.keys(FORM_PERIODS) as FormPeriod[]).map((v) => ({ v, label: LABOR.periods[v] }));
const INTERVALS = FORM_INTERVALS.map((v) => ({ v, label: v === "1d" ? "1T" : v }));
const SIDES = [
  { v: "long" as const, label: "Long" },
  { v: "short" as const, label: "Short" },
];

export default function TimeMachineSection() {
  const labCfg = useLabor((s) => s.cfg);
  const boxesRaw = useJournal((s) => (s.settings as unknown as { boxes?: unknown }).boxes);
  const watch = useMemo(() => boxesCfgOf(boxesRaw).watchlist, [boxesRaw]);
  const [form, setForm] = useState<FormState>(() => initialForm(labCfg.symbol));
  const [symDraft, setSymDraft] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const ctl = useRef<AbortController | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => writeForm(form), [form]);
  useEffect(() => () => ctl.current?.abort(), []);

  const prices = readPrices(form);
  const missing = missingPrices(form);
  const plan: TmPlan | null = prices.entry != null && prices.stop != null && prices.target != null ? { side: form.side, entry: prices.entry, stop: prices.stop, target: prices.target } : null;
  const planProblem = plan ? (checkPlan(plan)?.why ?? null) : null;
  const costs = useMemo(() => costsOfLab(labCfg), [labCfg]);
  const options = useMemo(() => optionsOfForm(form), [form]);
  const key = dataKey(form);
  const loaded = load.status === "ok" ? load.data : null;
  const fresh = loaded?.key === key;
  const busy = load.status === "loading";

  const commitSymbol = (raw: string) => {
    const s = normalizeWatchSymbol(raw);
    if (s) {
      set("symbol", s);
      setSymDraft(null);
    }
  };

  const start = async () => {
    if (planProblem || missing) return;
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setLoad({ status: "loading", done: 0, total: 0 });
    const now = Date.now();
    try {
      const res = await loadLabData({
        symbol: form.symbol,
        intervals: [form.interval as HistInterval],
        from: now - FORM_PERIODS[form.period] * 86_400_000,
        to: now,
        funding: false,
        signal: mine.signal,
        onProgress: (done, total) => {
          if (ctl.current === mine) setLoad({ status: "loading", done, total });
        },
      });
      if (ctl.current !== mine) return;
      const bars = res.data[form.interval as HistInterval] ?? [];
      const candles: TimeMachineCandle[] = bars.map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, ...(b.v != null ? { volume: b.v } : {}), closed: true }));
      if (candles.length < 200) {
        setLoad({ status: "error", message: candles.length ? `Nur ${candles.length} Kerzen – für diesen Zeitrahmen und Zeitraum liefert die Börse zu wenig (mindestens 200 sind nötig).` : LABOR.errors.noData });
        return;
      }
      setLoad({ status: "ok", data: { key, candles, fetchedAt: now, pages: res.pages } });
    } catch (e) {
      if (ctl.current !== mine || (e instanceof Error && e.name === "AbortError")) return;
      const kind = loadErrorKind(e);
      setLoad({ status: "error", message: kind === "blocked" ? (IS_FILE_BUILD || isFileProtocol() ? LABOR.errors.blockedFile : LABOR.errors.blocked) : kind === "rate" ? LABOR.errors.rate : kind === "symbol" ? LABOR.errors.symbol : "Die Kerzen konnten nicht geladen werden." });
    } finally {
      if (ctl.current === mine) ctl.current = null;
    }
  };

  const last = loaded?.candles[loaded.candles.length - 1];
  const ivMs = HIST_MS[form.interval as HistInterval];
  const shownProblem = missing && (form.entry || form.stop || form.target) ? missing : planProblem;

  return (
    <div className="grid gap-5" data-testid="tm-section" data-status={load.status}>
      <Card title={TM.title} note="Plan eintragen – die Zeitmaschine rechnet ihn mit echten Kerzen durch." data-testid="tm-form">
        <div className="grid gap-5">
          <p className="text-[12.5px] leading-snug text-mute">{TM.lead}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label={LABOR.symbol} htmlFor={`tm-sym-${uid}`} hint={symDraft != null && normalizeWatchSymbol(symDraft) == null ? <span className="text-(--color-danger-text)">{LABOR.symbolInvalid}</span> : LABOR.symbolHint}>
              <Autocomplete
                id={`tm-sym-${uid}`}
                value={symDraft ?? form.symbol}
                onChange={(v) => setSymDraft(v.toUpperCase())}
                onSelect={(item) => commitSymbol(item.value)}
                onBlur={() => symDraft != null && commitSymbol(symDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && symDraft != null) commitSymbol(symDraft);
                }}
                suggestions={watch}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                inputClassName="font-mono uppercase"
                data-testid="tm-symbol"
              />
            </FieldRow>
            <FieldRow label="Richtung">
              <Segmented<"long" | "short"> aria-label="Richtung" size="sm" options={SIDES} value={form.side} onChange={(v) => set("side", v)} className={SEG_TOUCH} />
            </FieldRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["entry", "Einstieg", "z. B. 64.250"],
                ["stop", "Stop", form.side === "long" ? "unter dem Einstieg" : "über dem Einstieg"],
                ["target", "Ziel", form.side === "long" ? "über dem Einstieg" : "unter dem Einstieg"],
              ] as const
            ).map(([k, label, ph]) => (
              <FieldRow key={k} label={label} htmlFor={`tm-${k}-${uid}`}>
                <Input id={`tm-${k}-${uid}`} numeric value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} aria-label={label} autoComplete="off" data-testid={`tm-${k}`} invalid={form[k].trim() !== "" && prices[k] == null} />
              </FieldRow>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Zeitrahmen der Kerzen">
              <ChipPick id={`tm-iv-${uid}`} label="Zeitrahmen" value={form.interval} options={INTERVALS} onChange={(v) => set("interval", v)} />
            </FieldRow>
            <FieldRow label={LABOR.period} hint="So viel Verlauf dient als Vorbild und als Suchraum.">
              <ChipPick id={`tm-pd-${uid}`} label={LABOR.period} value={form.period} options={PERIODS} onChange={(v) => set("period", v)} />
            </FieldRow>
          </div>
          <div className="flex items-center gap-3">
            <Expander open={more} onToggle={() => setMore((m) => !m)} label="Weitere Einstellungen der Zeitmaschine" controls={`tm-more-${uid}`} />
            <span className="text-[12.5px] text-mute">Weitere Einstellungen (Zeitstopp, Läufe, Seed, Verwaltung …)</span>
          </div>
          <Collapse open={more} id={`tm-more-${uid}`}>
            <MoreOptions form={form} set={set} uid={uid} />
          </Collapse>
          <p className="text-[11.5px] leading-snug text-mute" data-testid="tm-costs">
            Kosten wie im Versuchsaufbau (Strategie &amp; Kosten): {costText(costs)}
          </p>
          {shownProblem && (
            <p className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3.5 py-2.5 text-[12.5px] text-warn" role="status" data-testid="tm-form-problem">
              {shownProblem}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {busy ? (
              <Button size="md" onClick={() => ctl.current?.abort()} data-testid="tm-load-cancel">
                {TM.cancel}
              </Button>
            ) : (
              <Button size="md" variant="primary" onClick={() => void start()} disabled={!plan || planProblem != null} data-testid="tm-load-start">
                {fresh ? "Kerzen neu laden" : "Kerzen laden und durchspielen"}
              </Button>
            )}
            {busy && (
              <span className="num text-[12.5px] text-mute" role="status" data-testid="tm-load-status">
                Lade Kerzen … {load.status === "loading" && load.total > 0 ? `${load.done} von ${load.total} Seiten` : ""}
              </span>
            )}
          </div>
          {load.status === "error" && (
            <p className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3.5 py-2.5 text-[12.5px] text-loss" role="alert" data-testid="tm-load-error">
              {load.message}
            </p>
          )}
          {!loaded && load.status === "idle" && <p className="text-[12.5px] text-mute">Noch nichts gerechnet. Trag Einstieg, Stop und Ziel ein; die Zeitmaschine lädt dann die Kerzen des Marktes und rechnet. Es wird nichts bestellt und nichts gespeichert außer deiner Eingabe in diesem Browser.</p>}
        </div>
      </Card>
      {loaded && !fresh && (
        <p className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3.5 py-2.5 text-[12.5px] text-warn" role="status" data-testid="tm-data-changed">
          Markt, Zeitrahmen oder Zeitraum haben sich geändert – lade die Kerzen neu, dann rechnet die Zeitmaschine mit ihnen.
        </p>
      )}
      {loaded && fresh && plan && (
        <Suspense fallback={<Skeleton height={220} />}>
          <TimeMachineCard
            symbol={form.symbol}
            side={form.side}
            entry={plan.entry}
            stop={plan.stop}
            target={plan.target}
            candles={loaded.candles}
            interval={form.interval}
            costs={costs}
            seed={options.seed}
            options={options}
            source={SOURCE}
            fetchedAt={loaded.fetchedAt}
            note={last ? `Letzter Schluss ${last.close.toLocaleString("de-DE", { maximumFractionDigits: 8 })} (Kerze von ${TM_INTERVAL_TEXT[form.interval]}, bis ${new Date(last.time + ivMs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}). Die Sitzungen beginnen mit der nächsten Kerze.` : undefined}
            startMs={last ? last.time + ivMs : null}
          />
        </Suspense>
      )}
    </div>
  );
}

function MoreOptions({ form, set, uid }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void; uid: string }) {
  const field = (k: "horizon" | "seed" | "lookback" | "validBars" | "breakEvenR" | "trailAtr" | "trailFromR", label: string, ph: string, hint?: string) => (
    <FieldRow label={label} htmlFor={`tm-${k}-${uid}`} hint={hint}>
      <Input id={`tm-${k}-${uid}`} numeric value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} aria-label={label} autoComplete="off" data-testid={`tm-${k}`} />
    </FieldRow>
  );
  return (
    <div className="grid gap-4 pb-1 pt-1" data-testid="tm-more">
      <div className="grid gap-4 sm:grid-cols-3">
        {field("horizon", "Zeitstopp (Kerzen)", String(optionsOfForm(form).horizon), "Länge einer Sitzung; leer = Standard des Zeitrahmens.")}
        <FieldRow label="Sitzungen">
          <Segmented<FormState["runs"]> aria-label="Sitzungen" size="sm" options={[{ v: "2000", label: "2 000" }, { v: "10000", label: "10 000" }, { v: "20000", label: "20 000" }]} value={form.runs} onChange={(v) => set("runs", v)} className={SEG_TOUCH} />
        </FieldRow>
        {field("seed", "Seed", "19", "Gleicher Seed, gleiche Zahlen.")}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldRow label="Ziehen">
          <Segmented<FormState["method"]> aria-label="Ziehen" size="sm" options={[{ v: "block", label: "Blöcke" }, { v: "single", label: "Einzeln" }]} value={form.method} onChange={(v) => set("method", v)} className={SEG_TOUCH} />
        </FieldRow>
        <FieldRow label="Schwankung">
          <Segmented<FormState["vol"]> aria-label="Schwankung" size="sm" options={[{ v: "now", label: "Wie heute" }, { v: "history", label: "Wie früher" }]} value={form.vol} onChange={(v) => set("vol", v)} className={SEG_TOUCH} />
        </FieldRow>
        <FieldRow label="Trend der Historie">
          <Segmented<FormState["drift"]> aria-label="Trend" size="sm" options={[{ v: "keep", label: "Behalten" }, { v: "zero", label: "Entfernen" }]} value={form.drift} onChange={(v) => set("drift", v)} className={SEG_TOUCH} />
        </FieldRow>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldRow label="Frühere Vorfälle suchen nach">
          <ChipPick id={`tm-tr-${uid}`} label="Suche nach" value={form.trigger} options={[{ v: "close", label: "Gleiche Abstände" }, { v: "range", label: "Lage in der Range" }, { v: "level", label: "Dieses Niveau" }]} onChange={(v) => set("trigger", v)} />
        </FieldRow>
        {form.trigger === "range" && field("lookback", "Range (Kerzen)", "20")}
        {form.trigger !== "level" && field("validBars", "Auftrag gültig (Kerzen)", "4", "Für Limit- und Stop-Einstiege.")}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <ChipPick id={`tm-be-${uid}`} label="Break-even" value={form.breakEven ? "on" : "off"} options={[{ v: "off", label: "Kein Break-even" }, { v: "on", label: "Break-even" }]} onChange={(v) => set("breakEven", v === "on")} />
          {form.breakEven && field("breakEvenR", "Stop auf den Einstieg ab (R)", "1")}
        </div>
        <div className="grid gap-2">
          <ChipPick id={`tm-trail-${uid}`} label="Trailing" value={form.trail ? "on" : "off"} options={[{ v: "off", label: "Kein Trailing" }, { v: "on", label: "Trailing-Stop" }]} onChange={(v) => set("trail", v === "on")} />
          {form.trail && (
            <div className="grid gap-4 sm:grid-cols-2">
              {field("trailAtr", "Abstand (× ATR)", "2")}
              {field("trailFromR", "Ab (R)", "1")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
