/**
 * `Ähnliche Situationen` (F19): the last closed candle of a timeframe is described by a few numbers; the card shows where in
 * the loaded period the candles looked most alike (not overlapping), what really happened after each, how often it went up or
 * down, and – always – the cases that went the other way. Everything is computed here in the browser from the market layer's
 * real candles (`useSituationInput`, `findSimilar`); nothing is sent anywhere. Under 20 hits there is no verdict, only „zu
 * wenig Daten“ and the hits themselves.
 *
 * Lazy: loaded by `MarktView` on its own chunk (the hit sheet with the replay chart is another one, fetched on the first
 * click). No motion of its own besides the shared primitives; mobile: one column, touch targets ≥ 44 px on coarse pointers.
 */
import { lazy, memo, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { KEY_TIMEFRAMES, tfLabel, type KeyTf } from "@/domain/keylevels";
import { baselineText, fewText, featureBlockedReason, FEATURE_IDS, FEATURES, findSimilar, firstTouchText, headline, horizonText, HORIZONS, moveText, MULTIPLE_TESTING, NOT_A_FORECAST, OVERLAP_NOTE, pctText, rangeText, similarityText, type FeatureId, type SimilarHit, type SimilarResult, type SimUnit } from "@/domain/similar";
import { closedCandles } from "@/domain/trendlines";
import { cn } from "@/lib/cn";
import { dateTime } from "@/lib/format";
import { useSituationInput } from "@/market/similar/useSituationInput";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { Segmented } from "@/primitives/Segmented";
import { readPrefs, writePrefs, type SimilarPrefs } from "./similarPrefs";
import { useSimilarOpen } from "./similarOpen";
import { SIM } from "./similarStrings";

const SimilarHitSheet = lazy(() => import("./SimilarHitSheet"));

const FIRST_HITS = 8;
const FIRST_COUNTERS = 4;

const tone = (v: number): string => (v > 0 ? "text-win" : v < 0 ? "text-loss" : "text-fg");

function Row({ k, children, testId }: { k: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-line/70 py-1.5 text-[12.5px]" data-testid={testId}>
      <dt className="text-mute">{k}</dt>
      <dd className="num min-w-0 text-right font-mono font-medium">{children}</dd>
    </div>
  );
}

function ShareBar({ r }: { r: NonNullable<SimilarResult["summary"]> }) {
  const w = (s: number): string => `${(s * 100).toFixed(2)}%`;
  return (
    <div className="grid gap-1.5">
      <div role="img" aria-label={`${SIM.shareBar}: ${pctText(r.up.share)} ${SIM.up}, ${pctText(r.down.share)} ${SIM.down}${r.flat.k ? `, ${pctText(r.flat.share)} ${SIM.flat}` : ""}`} className="flex h-2 w-full overflow-hidden rounded-full bg-ink-800" data-testid="similar-bar">
        <span className="bg-win" style={{ width: w(r.up.share) }} />
        <span className="bg-faint" style={{ width: w(r.flat.share) }} />
        <span className="bg-loss" style={{ width: w(r.down.share) }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 text-[11.5px] text-mute">
        <span>
          <span className="text-win">{pctText(r.up.share)}</span> {SIM.up} <span className="text-faint">({r.up.k}, {rangeText(r.up)})</span>
        </span>
        <span>
          <span className="text-loss">{pctText(r.down.share)}</span> {SIM.down} <span className="text-faint">({r.down.k}, {rangeText(r.down)})</span>
        </span>
      </div>
    </div>
  );
}

function HitRow({ h, unit, counter, onOpen }: { h: SimilarHit; unit: SimUnit; counter: boolean; onOpen: (h: SimilarHit) => void }) {
  const o = h.outcome;
  const when = dateTime(new Date(h.time));
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(h)}
        aria-label={SIM.sample.open(when)}
        data-testid="similar-hit"
        data-index={h.index}
        data-dir={o.dir}
        data-counter={counter ? "" : undefined}
        className="grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 rounded-lg border border-transparent px-2 py-1.5 text-left text-[12.5px] transition-colors duration-200 hover:border-line-2 hover:bg-white/[0.03] focus-visible:border-line-2 pointer-coarse:min-h-11 sm:grid-cols-[minmax(0,1.3fr)_4rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.2fr)]"
      >
        <span className="min-w-0 truncate text-fg">
          {when}
          {counter && (
            <Badge tone="warn" className="ml-2 align-middle">
              {SIM.sample.counter}
            </Badge>
          )}
        </span>
        <span className="num text-right font-mono text-faint sm:text-left" title={SIM.sample.distance}>
          {h.distance.toFixed(2).replace(".", ",")}
        </span>
        <span className={cn("num font-mono font-medium", tone(o.change))}>{moveText(o.change, unit)}</span>
        <span className="num font-mono text-mute">
          {moveText(o.up, unit)} / {moveText(-o.down, unit)}
        </span>
        <span className="col-span-2 text-[11.5px] text-faint sm:col-span-1">{firstTouchText(o, unit)}</span>
      </button>
    </li>
  );
}

export const SimilarCard = memo(function SimilarCard() {
  const [prefs, setPrefs] = useState<SimilarPrefs>(readPrefs);
  const [showFeatures, setShowFeatures] = useState(false);
  const [open, setOpen] = useState<SimilarHit | null>(null);
  // the sheet's chunk is fetched on the first click and then stays mounted (close animation)
  const [sheetUsed, setSheetUsed] = useState(false);
  const openHit = (h: SimilarHit): void => {
    setSheetUsed(true);
    setOpen(h);
  };
  const [allCounters, setAllCounters] = useState(false);
  const [allHits, setAllHits] = useState(false);
  const input = useSituationInput(prefs.tf);
  const wrap = useRef<HTMLDivElement>(null);
  const reduced = useReducedFx();
  const ids = { counters: useId(), sample: useId(), features: useId() };

  const update = (patch: Partial<SimilarPrefs>): void => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writePrefs(next);
  };

  // „Ähnliche Situationen öffnen“ (assistant): scroll to the card and move focus here
  const seq = useSimilarOpen((s) => s.seq);
  useEffect(() => {
    if (!useSimilarOpen.getState().pending) return;
    useSimilarOpen.getState().consume();
    wrap.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    wrap.current?.focus({ preventScroll: true });
  }, [seq, reduced]);

  const cfg = useMemo(() => ({ features: prefs.features, horizon: prefs.horizon, unit: prefs.unit, minGap: prefs.horizon }), [prefs.features, prefs.horizon, prefs.unit]);
  // `input.key` changes when a candle was appended or closed – the candles themselves are read from the provider
  const computed = useMemo(() => {
    if (!input.candles) return null;
    return { result: findSimilar(input.candles, prefs.tf, input.now, cfg), closed: closedCandles(input.candles, prefs.tf, input.now) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.key, input.candles, prefs.tf, cfg]);
  const result = computed?.result ?? null;
  const summary = result?.summary ?? null;
  const counterIdx = useMemo(() => new Set(summary?.counters.map((c) => c.index) ?? []), [summary]);

  const blockedFeatures = FEATURE_IDS.filter((f) => featureBlockedReason(f, prefs.tf));
  const toggleFeature = (id: FeatureId): void => update({ features: FEATURE_IDS.filter((f) => (f === id ? !prefs.features.includes(f) : prefs.features.includes(f))) });
  const unit = prefs.unit;
  const few = result ? fewText(result) : null;
  const majorityWord = summary?.expectation === "down" ? SIM.down : SIM.up;

  return (
    <div ref={wrap} tabIndex={-1} className="min-w-0 outline-none" data-testid="markt-similar-wrap">
      <Card title={SIM.title} note={SIM.note} data-testid="markt-similar" data-status={result?.status ?? input.state}>
        <div className="grid gap-5">
          <div className="grid gap-3">
            <div className="grid gap-2">
              <span id={`${ids.features}-tf`} className="label">
                {SIM.tf}
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${ids.features}-tf`} data-testid="similar-tfs">
                {KEY_TIMEFRAMES.map((tf: KeyTf) => (
                  <button
                    key={tf}
                    type="button"
                    aria-pressed={prefs.tf === tf}
                    onClick={() => update({ tf })}
                    data-tf={tf}
                    className={cn(
                      "num min-h-8 rounded-full border px-3 font-mono text-[12px] transition-colors duration-200 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                      prefs.tf === tf ? "border-transparent bg-fg font-medium text-ink-900" : "border-line-2 text-mute hover:border-white/30 hover:text-fg",
                    )}
                  >
                    {tfLabel(tf)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="grid gap-2">
                <span className="label">{SIM.horizon}</span>
                <Segmented size="sm" aria-label={SIM.horizon} value={String(prefs.horizon)} onChange={(v) => update({ horizon: Number(v) })} options={HORIZONS.map((h) => ({ v: String(h), label: String(h) }))} />
              </div>
              <div className="grid gap-2">
                <span className="label" title={SIM.unitHelp}>
                  {SIM.unit}
                </span>
                <Segmented
                  size="sm"
                  aria-label={SIM.unit}
                  value={unit}
                  onChange={(v) => update({ unit: v })}
                  options={[
                    { v: "r", label: SIM.unitR },
                    { v: "pct", label: SIM.unitPct },
                  ]}
                />
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowFeatures((s) => !s)} aria-expanded={showFeatures} aria-controls={ids.features} data-testid="similar-features-toggle">
                {showFeatures ? SIM.featuresClose : SIM.featuresOpen} · {SIM.featuresCount(prefs.features.length)}
              </Button>
            </div>
            <Collapse open={showFeatures} id={ids.features}>
              <div className="grid gap-2 pt-1" data-testid="similar-features">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={SIM.features}>
                  {FEATURE_IDS.map((id) => {
                    const why = featureBlockedReason(id, prefs.tf);
                    const on = prefs.features.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        disabled={!!why}
                        title={why ?? FEATURES[id].hint}
                        onClick={() => toggleFeature(id)}
                        data-feature={id}
                        className={cn(
                          "min-h-8 rounded-full border px-3 text-[12px] transition-colors duration-200 pointer-coarse:min-h-11",
                          on && !why ? "border-transparent bg-fg font-medium text-ink-900" : "border-line-2 text-mute hover:border-white/30 hover:text-fg",
                          why && "cursor-not-allowed opacity-40 hover:border-line-2 hover:text-mute",
                        )}
                      >
                        {FEATURES[id].label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-faint">{SIM.featuresHelp}</p>
                {blockedFeatures.length > 0 && (
                  <ul className="grid gap-0.5 text-[11px] text-faint" aria-label={SIM.blocked}>
                    {blockedFeatures.map((f) => (
                      <li key={f}>
                        <span className="text-mute">{FEATURES[f].label}</span> – {featureBlockedReason(f, prefs.tf)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Collapse>
          </div>

          {!result ? (
            <p className="text-[12.5px] text-mute" data-testid="similar-waiting">
              {input.state === "idle" ? SIM.idle : (input.avail.reason ?? SIM.loading)}
            </p>
          ) : (
            <div className="grid gap-5">
              <p className="text-[11.5px] text-faint" data-testid="similar-meta">
                {SIM.bars(result.bars)}
                {result.asOf != null && ` · ${SIM.asOf} ${dateTime(new Date(result.asOf))}`}
                {result.candidates > 0 && ` · ${SIM.candidates(result.candidates)}`}
              </p>

              {result.dropped.length > 0 && (
                <ul className="grid gap-0.5 text-[11.5px] text-faint" aria-label={SIM.droppedTitle} data-testid="similar-dropped">
                  {result.dropped.map((d) => (
                    <li key={d.id}>
                      <span className="text-mute">{FEATURES[d.id].label}</span> – {d.reason}
                    </li>
                  ))}
                </ul>
              )}

              {few && (
                <p className="rounded-xl border border-line bg-ink-950/40 p-3 text-[13px] leading-snug text-mute" data-testid="similar-few">
                  {few}
                </p>
              )}

              {summary && (
                <section className="grid gap-4" aria-label={SIM.headlineTitle} data-testid="similar-summary">
                  <p className="text-[clamp(15px,3.8vw,18px)] font-semibold leading-snug text-fg [text-wrap:balance]" data-testid="similar-headline">
                    {headline(summary, result.cfg.horizon)}
                  </p>
                  <ShareBar r={summary} />
                  <dl className="grid gap-x-6 sm:grid-cols-2">
                    <Row k={SIM.stats.median} testId="similar-median">
                      <span className={tone(summary.change.median)}>{moveText(summary.change.median, unit)}</span>
                    </Row>
                    <Row k={SIM.stats.spread}>
                      {moveText(summary.change.q25, unit)} … {moveText(summary.change.q75, unit)}
                    </Row>
                    <Row k={SIM.stats.sd}>{summary.change.sd == null ? "–" : moveText(summary.change.sd, unit, false)}</Row>
                    <Row k={SIM.stats.maxUp}>
                      <span className="text-win">{moveText(summary.medianUp, unit)}</span>
                    </Row>
                    <Row k={SIM.stats.maxDown}>
                      <span className="text-loss">{moveText(-summary.medianDown, unit)}</span>
                    </Row>
                    {summary.medianSetback != null && <Row k={SIM.stats.setback}>{moveText(-summary.medianSetback * (summary.expectation === "down" ? -1 : 1), unit)}</Row>}
                    <Row k={SIM.stats.first}>
                      {pctText(summary.touch.up)} {SIM.stats.firstUp} · {pctText(summary.touch.down)} {SIM.stats.firstDown} · {pctText(summary.touch.none)} {SIM.stats.firstNone}
                      {summary.touch.both > 0 && ` · ${pctText(summary.touch.both)} ${SIM.stats.firstBoth}`}
                    </Row>
                  </dl>
                  {(summary.touch.medianBarsUp != null || summary.touch.medianBarsDown != null) && (
                    <p className="text-[11.5px] text-faint">
                      {SIM.stats.firstBars(summary.touch.medianBarsUp != null ? horizonText(summary.touch.medianBarsUp) : null, summary.touch.medianBarsDown != null ? horizonText(summary.touch.medianBarsDown) : null)}
                    </p>
                  )}
                  {result.baseline && (
                    <div className="grid gap-1 rounded-xl border border-line bg-ink-950/30 p-3" data-testid="similar-baseline">
                      <span className="label !text-[9.5px]">{SIM.baselineTitle}</span>
                      <p className="text-[12.5px] leading-snug text-mute">{baselineText(summary, result)}</p>
                      <p className="text-[11px] text-faint">{OVERLAP_NOTE}</p>
                    </div>
                  )}
                </section>
              )}

              {summary && (
                <section className="grid gap-2" aria-labelledby={ids.counters} data-testid="similar-counters">
                  <h3 id={ids.counters} className="label flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-warn" aria-hidden="true" />
                    {SIM.counters.title}
                  </h3>
                  {summary.expectation == null ? (
                    <p className="text-[12.5px] text-mute">{SIM.counters.tie}</p>
                  ) : summary.counters.length === 0 ? (
                    <p className="text-[12.5px] text-mute">{SIM.counters.none}</p>
                  ) : (
                    <>
                      <p className="text-[12.5px] text-mute">{SIM.counters.lead(summary.counters.length, majorityWord)}</p>
                      <ul className="grid gap-0.5">
                        {(allCounters ? summary.counters : summary.counters.slice(0, FIRST_COUNTERS)).map((h) => (
                          <HitRow key={h.index} h={h} unit={unit} counter onOpen={openHit} />
                        ))}
                      </ul>
                      {summary.counters.length > FIRST_COUNTERS && (
                        <Button size="sm" variant="ghost" onClick={() => setAllCounters((a) => !a)} className="justify-self-start" data-testid="similar-counters-more">
                          {allCounters ? SIM.counters.fewer : SIM.counters.all(summary.counters.length)}
                        </Button>
                      )}
                    </>
                  )}
                </section>
              )}

              {result.hits.length > 0 && (
                <section className="grid gap-2" aria-labelledby={ids.sample} data-testid="similar-sample">
                  <h3 id={ids.sample} className="label flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
                    {SIM.sample.title} · {SIM.hitsOf(result.hits.length)}
                  </h3>
                  <p className="text-[11.5px] text-faint">{SIM.sample.lead}</p>
                  <div className="hidden grid-cols-[minmax(0,1.3fr)_4rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.2fr)] gap-x-3 px-2 text-[10.5px] uppercase tracking-[0.08em] text-faint sm:grid" aria-hidden="true">
                    <span>{SIM.sample.date}</span>
                    <span>{SIM.sample.distance}</span>
                    <span>{SIM.sample.change}</span>
                    <span>{SIM.sample.range}</span>
                    <span>{SIM.sample.first}</span>
                  </div>
                  <ul className="grid gap-0.5">
                    {(allHits ? result.hits : result.hits.slice(0, FIRST_HITS)).map((h) => (
                      <HitRow key={h.index} h={h} unit={unit} counter={counterIdx.has(h.index)} onOpen={openHit} />
                    ))}
                  </ul>
                  {result.hits.length > FIRST_HITS && (
                    <Button size="sm" variant="ghost" onClick={() => setAllHits((a) => !a)} className="justify-self-start" data-testid="similar-hits-more">
                      {allHits ? SIM.sample.fewer : SIM.sample.all(result.hits.length)}
                    </Button>
                  )}
                </section>
              )}

              {result.features.length > 0 && (
                <p className="text-[11.5px] leading-snug text-faint" data-testid="similar-how">
                  <span className="text-mute">{SIM.how}: </span>
                  {similarityText(result)}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-1.5 rounded-xl border border-line p-3 text-[11.5px] leading-snug text-mute" data-testid="similar-caveats">
            <span className="label !text-[9.5px]">{SIM.caveatTitle}</span>
            <p>{NOT_A_FORECAST}</p>
            <p>{MULTIPLE_TESTING}</p>
          </div>
        </div>
      </Card>
      {sheetUsed && (
        <Suspense fallback={null}>
          <SimilarHitSheet hit={open} onClose={() => setOpen(null)} closed={computed?.closed ?? []} horizon={result?.cfg.horizon ?? prefs.horizon} unit={unit} features={result?.features ?? []} query={result?.query ?? null} />
        </Suspense>
      )}
    </div>
  );
});
