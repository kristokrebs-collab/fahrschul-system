/**
 * „Squeeze-Beobachtung“ (F07) on the Markt page, next to the box status: extreme funding, a strongly rising open interest
 * and a one-sided account split – read from the data archive (F26) for one symbol, shown with the numbers, the thresholds
 * and a ✓ / – / „keine Daten“ per reading, put beside the box phase (before a breakout, after it, after a failed one), with
 * a sample statement of how often the same lean held earlier in the archive and what the price did afterwards (counter-
 * examples counted, sample word). The thresholds are adjustable and written at once to `settings.squeeze`; the alert is a
 * separate switch, off until the user turns it on.
 *
 * An observation, not a signal: no entry, no stop, no prediction – and „Keine professionelle Finanzberatung.“ on the card.
 * Without the archive there is nothing to read; the card says so and points to where it is switched on.
 */
import { memo, useMemo, useState } from "react";
import type { BoxesView } from "@/market/boxes/store";
import { openSettingsOn } from "@/views/settings/MoreSettingsCard";
import { BOX_TF_LABEL, PHASE_LABEL } from "@/domain/boxes";
import {
  DEFAULT_SQUEEZE_CFG,
  HORIZONS,
  MIN_MET_CHOICES,
  OI_HOURS_CHOICES,
  SQUEEZE_LIMITS,
  coverageHours,
  evaluateNow,
  findEpisodes,
  situationOf,
  squeezeCfgOf,
  summarize,
  withSqueeze,
  type BoxCtx,
  type Signal,
  type SqueezeCfg,
} from "@/domain/squeeze";
import { cn } from "@/lib/cn";
import { parseNumber, toInputString } from "@/lib/parse";
import { useArchiveCfg, useArchiveStatus } from "@/market/archive/store";
import { Switch } from "@/motion/Switch";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { NO_ADVICE_TEXT } from "@/ui/AnalysisNote";
import { SourceStand } from "@/ui/SourceStand";
import { SQUEEZE_STRINGS as S, boxLine, episodesLine, headline, sampleLine } from "./squeezeModel";
import { useSqueezeData } from "./useSqueezeData";

type Hours = "1" | "4" | "24";
type Min = "1" | "2" | "3";
const rawSqueeze = (s: unknown): unknown => (s && typeof s === "object" ? (s as { squeeze?: unknown }).squeeze : undefined);

/** Writes `settings.squeeze` at once (three-way merged by the store like every settings save). */
export async function writeSqueeze(patch: Partial<SqueezeCfg>): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const prev = rawSqueeze(settings);
  const squeeze = withSqueeze(prev, patch);
  if (squeeze === prev) return true;
  try {
    await saveSettings({ ...settings, squeeze } as typeof settings);
    return true;
  } catch {
    return false;
  }
}

const MARK: Record<string, string> = { true: "erfüllt", false: "nicht erfüllt", null: "keine Daten" };

function SignalRow({ s }: { s: Signal }) {
  const state = s.met === null ? "null" : String(s.met);
  return (
    <li className="grid gap-0.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-testid={`squeeze-signal-${s.key}`} data-met={state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[13px] font-medium text-fg">{s.label}</span>
        <span className={cn("text-[12px] font-semibold", s.met ? "text-warn" : "text-mute")}>
          <span aria-hidden="true">{s.met ? "✓ " : s.met === false ? "– " : "? "}</span>
          {MARK[state]}
        </span>
      </div>
      <p className="num text-[13px] text-fg">{s.text}</p>
      <p className="text-[11.5px] text-mute">Schwelle: {s.threshold}</p>
      {s.note && <p className="text-[11.5px] text-mute">{s.note}</p>}
    </li>
  );
}

function NumberField({ id, label, value, unit, limits, onCommit }: { id: string; label: string; value: number; unit: string; limits: readonly [number, number]; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? toInputString(value);
  const commit = () => {
    if (draft === null) return;
    const n = parseNumber(draft);
    setDraft(null);
    if (n !== null) onCommit(Math.min(limits[1], Math.max(limits[0], n)));
  };
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          numeric
          wrapperClassName="w-28"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          aria-describedby={`${id}-range`}
        />
        <span className="text-[12px] text-mute">{unit}</span>
      </div>
      <span id={`${id}-range`} className="text-[11px] text-mute">
        {toInputString(limits[0])} bis {toInputString(limits[1])}
      </span>
    </div>
  );
}

export const SqueezeCard = memo(function SqueezeCard({ view, className }: { view: BoxesView; className?: string }) {
  const raw = useJournal((s) => rawSqueeze(s.settings));
  const cfg = useMemo(() => squeezeCfgOf(raw), [raw]);
  const archiveCfg = useArchiveCfg();
  const status = useArchiveStatus();
  const pushToast = useUi((s) => s.pushToast);
  const [picked, setPicked] = useState<string | null>(null);
  const [tune, setTune] = useState(false);
  const liveSymbol = view.symbol;

  const load = useSqueezeData(picked, liveSymbol, status.rev);
  const symbol = load.symbol;

  const snap = load.snapshot;
  const reading = useMemo(() => (snap ? evaluateNow(snap.data, cfg, load.at, snap.ivMin) : null), [snap, cfg, load.at]);
  const episodes = useMemo(() => (snap ? findEpisodes(snap.data, cfg) : []), [snap, cfg]);
  const hours = useMemo(() => (snap ? coverageHours(snap.data) : 0), [snap]);

  const ctx: BoxCtx[] = useMemo(() => {
    if (view.state !== "ok" || !symbol || view.symbol !== symbol) return [];
    return (["4h", "1d", "1w"] as const).flatMap((tf): BoxCtx[] => {
      const a = view.tfs[tf].analysis;
      if (!a?.box.box) return [];
      return [{ tf, phase: a.box.phase, dir: a.box.phase === "failed" ? a.box.box.brk : a.box.dir }];
    });
  }, [view, symbol]);

  const write = (patch: Partial<SqueezeCfg>) => {
    void writeSqueeze(patch).then((ok) => {
      if (!ok) pushToast({ kind: "error", title: S.saveFailed });
    });
  };

  const side = reading?.state === "watch" ? reading.side : null;
  const situation = side ? situationOf(side, ctx) : null;
  const head = reading ? headline(reading, cfg.minMet) : null;
  const first = snap?.data.premium[0]?.t;
  const empty = load.phase === "ready" && !symbol;

  return (
    <Card title={S.title} note={S.note} className={className} data-testid="markt-squeeze">
      <div className="grid gap-4">
        <p className="text-[12px] leading-relaxed text-mute" data-testid="squeeze-lead">
          {S.lead}
        </p>

        {load.phase === "loading" && <p className="text-[12px] text-mute">{S.loading}</p>}
        {load.phase === "unavailable" && (
          <p className="text-[12px] text-warn" data-testid="squeeze-unavailable">
            {S.unavailable}
          </p>
        )}

        {empty && (
          <div className="grid gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-3" data-testid="squeeze-empty">
            <p className="text-[13px] text-fg">{archiveCfg.on ? S.archiveOn : S.archiveOff}</p>
            {!archiveCfg.on && (
              <div>
                <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => openSettingsOn("settings", "Datenarchiv")}>
                  {S.archiveBtn}
                </Button>
              </div>
            )}
          </div>
        )}

        {load.symbols.length > 1 && (
          <ul className="flex flex-wrap gap-2" aria-label="Symbol">
            {load.symbols.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  aria-pressed={s === symbol}
                  onClick={() => setPicked(s)}
                  className={cn("num rounded-full border px-3 py-1 text-[12px] transition-colors duration-200 pointer-coarse:min-h-11", s === symbol ? "border-fg/50 bg-white/[0.08] text-fg" : "border-line text-mute hover:border-white/25 hover:text-fg")}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}

        {reading && head && symbol && (
          <>
            <p className="flex items-center gap-2 text-[14px] font-medium text-fg" data-testid="squeeze-headline" data-state={reading.state} data-side={reading.side ?? ""}>
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", head.tone === "warn" ? "bg-warn" : "bg-faint")} />
              <span>
                <span className="num">{symbol}</span> · {head.text}
              </span>
            </p>

            <ul className="grid gap-2 lg:grid-cols-3" aria-label="Messwerte">
              {reading.signals.map((s) => (
                <SignalRow key={s.key} s={s} />
              ))}
            </ul>
            {reading.topLong && <p className="text-[11.5px] text-mute">{S.topTrader(reading.topLong.pct)}</p>}

            <div className="grid gap-1.5" data-testid="squeeze-context">
              <span className="label">Box-Kontext</span>
              {ctx.length > 0 ? (
                <>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-mute">
                    {ctx.map((c) => (
                      <li key={c.tf} className="num">
                        {BOX_TF_LABEL[c.tf]}: {c.phase === "none" ? PHASE_LABEL.none : boxLine(c)}
                      </li>
                    ))}
                  </ul>
                  {situation && (
                    <p className="text-[13px] leading-snug text-fg" data-testid="squeeze-situation" data-timing={situation.timing} data-relation={situation.relation ?? ""}>
                      {situation.text}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-mute">{liveSymbol && symbol !== liveSymbol ? S.boxOnlyLive(liveSymbol) : S.boxNone}</p>
              )}
            </div>

            <div className="grid gap-1" data-testid="squeeze-sample">
              <span className="label">Stichprobe im Archiv</span>
              <p className="text-[12px] leading-relaxed text-mute">
                {episodesLine(episodes, hours, side)} {S.coverage(hours)}
              </p>
              {HORIZONS.map((h) => (
                <p key={h} className="text-[12px] leading-relaxed text-mute" data-testid={`squeeze-sample-${h}`}>
                  {sampleLine(summarize(episodes, h, side), side)}
                </p>
              ))}
            </div>

            <SourceStand source={S.source} parts={[{ label: "letzter Eintrag", at: reading.at }, { label: "Archiv seit", at: first, long: true }]} testId="squeeze-stand" />
          </>
        )}

        <div className="grid gap-3">
          <div>
            <Button size="sm" className="pointer-coarse:min-h-11" aria-expanded={tune} onClick={() => setTune((t) => !t)} data-testid="squeeze-tune">
              {tune ? S.thresholdsHide : S.thresholds}
            </Button>
          </div>
          {tune && (
            <div className="grid gap-4 rounded-xl border border-line bg-ink-950/40 p-3 lg:grid-cols-2" data-testid="squeeze-settings">
              <NumberField id="sq-funding" label={S.fundingLabel} value={cfg.fundingPct} unit="%" limits={SQUEEZE_LIMITS.fundingPct} onCommit={(v) => write({ fundingPct: v })} />
              <div className="grid content-start gap-3">
                <NumberField id="sq-oi" label={S.oiLabel} value={cfg.oiRisePct} unit="%" limits={SQUEEZE_LIMITS.oiRisePct} onCommit={(v) => write({ oiRisePct: v })} />
                <div className="grid gap-1.5">
                  <span id="sq-oih-label" className="label">
                    {S.oiWindow}
                  </span>
                  <Segmented<Hours>
                    aria-labelledby="sq-oih-label"
                    size="sm"
                    className="justify-self-start"
                    value={`${cfg.oiHours}` as Hours}
                    onChange={(v) => write({ oiHours: Number(v) as (typeof OI_HOURS_CHOICES)[number] })}
                    options={OI_HOURS_CHOICES.map((h) => ({ v: `${h}` as Hours, label: `${h} h` }))}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <NumberField id="sq-long" label={S.longLabel} value={cfg.longPct} unit="%" limits={SQUEEZE_LIMITS.longPct} onCommit={(v) => write({ longPct: v })} />
                <span className="text-[11px] text-mute">{S.longHelp}</span>
              </div>
              <div className="grid content-start gap-1.5">
                <span id="sq-min-label" className="label">
                  {S.minLabel}
                </span>
                <Segmented<Min>
                  aria-labelledby="sq-min-label"
                  size="sm"
                  className="justify-self-start"
                  value={`${cfg.minMet}` as Min}
                  onChange={(v) => write({ minMet: Number(v) as (typeof MIN_MET_CHOICES)[number] })}
                  options={MIN_MET_CHOICES.map((m) => ({ v: `${m}` as Min, label: `${m} von 3` }))}
                />
              </div>
              <div className="lg:col-span-2">
                <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => write({ ...DEFAULT_SQUEEZE_CFG, alerts: cfg.alerts })}>
                  {S.reset}
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
            <span className="grid min-w-0 gap-0.5">
              <label htmlFor="sq-alerts" className="cursor-pointer text-[13px] text-fg">
                {S.alertLabel}
              </label>
              <span id="sq-alerts-help" className="text-[11.5px] leading-snug text-mute">
                {archiveCfg.on ? S.alertOff : S.alertNeedsArchive}
              </span>
            </span>
            <Switch id="sq-alerts" checked={cfg.alerts} onCheckedChange={(alerts) => write({ alerts })} aria-describedby="sq-alerts-help" className="touch-hit mt-0.5 shrink-0" />
          </div>
        </div>

        <div className="grid gap-1 text-[12px] text-mute">
          <p>{S.startValues}</p>
          <p data-testid="squeeze-no-advice">
            Beobachtung mit Zahlen und Schwellen, keine Prognose und kein Handelssignal. {NO_ADVICE_TEXT}
          </p>
        </div>
      </div>
    </Card>
  );
});

export default SqueezeCard;
