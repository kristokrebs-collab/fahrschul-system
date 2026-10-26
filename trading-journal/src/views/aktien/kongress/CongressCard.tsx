/**
 * Kongress-Tracker: the stock trades members of the US House report under the STOCK Act, read from the House Clerk's public
 * Periodic Transaction Reports. The card reads the Clerk's index for a window of days, then the reports in it (newest first,
 * a few at a time, cached on this device) and shows one line per transaction: who, owner, asset, ticker, buy or sell, option
 * strike and expiry, trade date, the amount RANGE as printed, the delay in days, and the link to the original PDF.
 *
 * Honest by construction: what cannot be read cleanly is a "Nicht lesbar" line with the PDF link; a source that cannot be
 * reached says why (and shows the last good copy marked as such); the caveats – up to 45 days late, ranges, member is not intent,
 * no signal, "Keine professionelle Finanzberatung." – are always on screen. No order is ever sent; the Senate is a manual route.
 * Lazy: `lazy(() => import("@/views/aktien/kongress/CongressCard"))`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildLines, filterLines, freshDocIds, isWindowId, memberMatches, NO_FILTER, nextSeen, seenOf, selectFilings, summarize, watchSet, WINDOWS, membersOf, type LineFilter, type SeenRecord, type SideFilter, type WindowId } from "@/domain/congress";
import { cn } from "@/lib/cn";
import { ddmmHHmm } from "@/market/format";
import { canObserveInView, observeInView } from "@/motion/inView";
import { CONGRESS_SOURCE_LABEL, CONGRESS_SOURCE_URL, SENATE_SEARCH_URL, type CongressIndexPayload, type CongressReport } from "@/market/congress/wire";
import { dataOf, type CongressResult } from "@/market/congress/result";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { SourceStand } from "@/ui/SourceStand";
import { SEG_TOUCH } from "@/views/insights/ui";
import { useAktien } from "../aktienStore";
import type { AktienSlotProps } from "../types";
import { CheckChip, CardNote } from "../ui";
import { KONGRESS, FAIL_SHORT } from "./strings";
import { READ_STEP, useCongress } from "./store";
import { TradeCard } from "./TradeCard";

const PREFS_KEY = storageKey("aktien-kongress");
const SEEN_KEY = storageKey("aktien-kongress-seen");
const PAGE = 40;

type Idx = CongressResult<CongressIndexPayload>;
const isUnavailable = (r: Idx): r is Extract<Idx, { status: "unavailable" }> => r.status === "unavailable";
const isUsable = (r: Idx): r is Exclude<Idx, { status: "unavailable" }> => r.status !== "unavailable";

const pad = (n: number): string => String(n).padStart(2, "0");
/** today on this device as `YYYY-MM-DD` (the Clerk lists US days; a day's difference at the edge of a window does not matter) */
const localDay = (d: Date = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Caveats() {
  return (
    <section aria-label={KONGRESS.caveatsTitle} className="grid gap-2 rounded-xl border border-line-2 bg-ink-950/50 px-3.5 py-3" data-testid="kongress-caveats">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{KONGRESS.caveatsTitle}</h3>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {KONGRESS.caveats.map((c) => (
          <li key={c.id} className="text-[12.5px] leading-relaxed text-mute" data-caveat={c.id}>
            <span className="font-medium text-fg">{c.head}</span> {c.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CongressCard({ watchlist, symbol }: AktienSlotProps) {
  const reduced = useReducedFx();
  const select = useAktien((s) => s.select);
  const [today] = useState(() => localDay());
  const [windowId, setWindowIdState] = useState<WindowId>(() => {
    const w = readJson<{ window?: unknown } | null>(PREFS_KEY, null)?.window;
    return isWindowId(w) ? w : "30";
  });
  const [filter, setFilter] = useState<LineFilter>(NO_FILTER);
  const [cap, setCap] = useState(READ_STEP);
  const [shown, setShown] = useState(PAGE);
  const scopedMember = useDebounced(filter.member.trim().length >= 3 ? filter.member.trim() : "", 450);

  const filings = useCongress((s) => s.filings);
  const reports = useCongress((s) => s.reports);
  const reading = useCongress((s) => s.reading);
  const indexes = useCongress((s) => s.indexes);
  const loadingIndex = useCongress((s) => s.loadingIndex);
  const request = useCongress((s) => s.request);

  const setWindowId = (w: WindowId): void => {
    setWindowIdState(w);
    setCap(READ_STEP);
    setShown(PAGE);
    writeJson(PREFS_KEY, { window: w });
  };
  const patch = (p: Partial<LineFilter>): void => {
    setFilter((f) => ({ ...f, ...p }));
    setShown(PAGE);
  };

  // nothing is asked for before the section is on screen once (the page opens without a request to the Clerk's relay); without
  // an IntersectionObserver (jsdom, very old engines) it loads at once
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => !canObserveInView());
  useEffect(() => {
    const el = root.current;
    if (visible || !el) return;
    return observeInView(el, (inView) => {
      if (inView) setVisible(true);
    });
  }, [visible]);

  // one load per change of window, member scope or cap; the store drops a late answer of an older one
  useEffect(() => {
    if (visible) void useCongress.getState().load({ today, window: windowId, member: scopedMember, cap });
  }, [visible, today, windowId, scopedMember, cap]);
  useEffect(() => () => useCongress.getState().abort(), []);
  const reload = (): void => void useCongress.getState().load({ today, window: windowId, member: scopedMember, cap, fresh: true });

  // "neu seit deinem letzten Besuch": the document numbers the index listed at the last visit (kept on this device only)
  const [prevSeen, setPrevSeen] = useState<SeenRecord | null>(() => seenOf(readJson<unknown>(SEEN_KEY, null)));
  const allIds = useMemo(() => filings.map((f) => f.docId), [filings]);
  // what the page-leave handler needs, as of the last render (refs are written in an effect, never during render)
  const latest = useRef({ ids: allIds, prev: prevSeen });
  useEffect(() => {
    latest.current = { ids: allIds, prev: prevSeen };
  });
  useEffect(() => {
    const save = (): void => {
      const { ids, prev } = latest.current;
      if (ids.length) writeJson(SEEN_KEY, nextSeen(ids, Date.now(), prev));
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);
  const markSeen = (): void => {
    const rec = nextSeen(allIds, Date.now(), prevSeen);
    writeJson(SEEN_KEY, rec);
    setPrevSeen(rec);
  };

  const watch = useMemo(() => watchSet(watchlist), [watchlist]);
  const scope = useMemo(() => selectFilings(filings, { window: windowId, today, member: scopedMember, cap: Number.MAX_SAFE_INTEGER }).filings, [filings, windowId, today, scopedMember]);
  const fresh = useMemo(() => freshDocIds(scope.map((f) => f.docId), prevSeen), [scope, prevSeen]);
  const reportMap = useMemo(() => {
    const m: Record<string, CongressReport | undefined> = {};
    for (const f of scope) m[f.docId] = dataOf(reports[f.docId]) ?? undefined;
    return m;
  }, [scope, reports]);
  const lines = useMemo(() => buildLines({ filings: scope, reports: reportMap, watch, fresh }), [scope, reportMap, watch, fresh]);
  const filtered = useMemo(() => filterLines(lines, filter), [lines, filter]);
  const read = scope.filter((f) => reportMap[f.docId]).length;
  const summary = useMemo(() => summarize(lines, scope.length, read), [lines, scope.length, read]);
  const members = useMemo(() => membersOf(filings.filter((f) => f.filed !== null)), [filings]);

  const failed = useMemo(() => {
    const by = new Map<string, number>();
    for (const f of scope) {
      const r = reports[f.docId];
      if (r?.status === "unavailable") by.set(r.reason, (by.get(r.reason) ?? 0) + 1);
    }
    return by;
  }, [scope, reports]);
  const failedCount = [...failed.values()].reduce((a, b) => a + b, 0);
  const staleReports = scope.filter((f) => reports[f.docId]?.status === "stale").length;
  const emptyReports = scope.filter((f) => reportMap[f.docId]?.status === "ok" && reportMap[f.docId]!.rows.length === 0).length;

  // the index: which year answered, and how
  const results = Object.entries(indexes)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, r]) => r);
  const fails = results.filter(isUnavailable);
  const stamp = results.find(isUsable) ?? null;
  const indexStale = results.find((r) => r.status === "stale");
  const indexProblem = fails.find((r) => r.reason !== "no-index");
  const shownFail = indexProblem ?? fails[0];
  const noIndex = results.length > 0 && fails.length === results.length;

  const busy = loadingIndex || (reading !== null && reading.done < reading.total);
  const firstLoad = !request || (loadingIndex && filings.length === 0);
  const state = noIndex ? "error" : firstLoad ? "loading" : busy ? "reading" : "ready";
  const filterOn = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);
  const memberSuggestions = useMemo(() => members.filter((m) => memberMatches({ name: m.name, district: m.district }, filter.member)).slice(0, 12), [members, filter.member]);

  const openAnalysis = (): void => {
    document.querySelector('[data-section="aktien-analyse"]')?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <Card
      title={KONGRESS.title}
      className="h-full"
      data-testid="aktien-kongress"
      action={
        <Button size="sm" variant="ghost" onClick={reload} disabled={busy} data-testid="kongress-refresh">
          {busy ? "Lädt …" : KONGRESS.refresh}
        </Button>
      }
    >
      <div ref={root} className="grid min-w-0 gap-4" data-state={state}>
        <p className="max-w-[78ch] text-[13px] leading-relaxed text-mute">{KONGRESS.lead}</p>
        <Caveats />

        <div className="grid gap-3" data-testid="kongress-filters">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={KONGRESS.filters.member} htmlFor="kongress-member" help={KONGRESS.filters.memberHint}>
              <Input id="kongress-member" type="search" list="kongress-members" value={filter.member} autoComplete="off" spellCheck={false} placeholder={KONGRESS.filters.memberPlaceholder} data-testid="kongress-member" onChange={(e) => patch({ member: e.target.value })} />
              <datalist id="kongress-members">
                {memberSuggestions.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.district}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label={KONGRESS.filters.query} htmlFor="kongress-query">
              <Input id="kongress-query" value={filter.query} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={40} placeholder={KONGRESS.filters.queryPlaceholder} data-testid="kongress-query" onChange={(e) => patch({ query: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
            <div className="grid gap-1">
              <span className="label" id="kongress-side-l">
                {KONGRESS.filters.side}
              </span>
              <Segmented<SideFilter>
                aria-labelledby="kongress-side-l"
                size="sm"
                options={[
                  { v: "all", label: "Alle" },
                  { v: "buy", label: "Kauf" },
                  { v: "sell", label: "Verkauf" },
                ]}
                value={filter.side}
                onChange={(side) => patch({ side })}
                className={SEG_TOUCH}
              />
            </div>
            <div className="grid gap-1">
              <span className="label" id="kongress-window-l">
                {KONGRESS.filters.window}
              </span>
              <Segmented<WindowId> aria-labelledby="kongress-window-l" size="sm" options={WINDOWS.map((w) => ({ v: w.id, label: w.label }))} value={windowId} onChange={setWindowId} className={SEG_TOUCH} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CheckChip checked={filter.watchOnly} onChange={(v) => patch({ watchOnly: v })} testId="kongress-chip-watch">
              {KONGRESS.filters.watch}
            </CheckChip>
            <CheckChip checked={filter.newOnly} onChange={(v) => patch({ newOnly: v })} testId="kongress-chip-new">
              {KONGRESS.filters.fresh}
            </CheckChip>
            <CheckChip checked={filter.tickerOnly} onChange={(v) => patch({ tickerOnly: v })} testId="kongress-chip-ticker">
              {KONGRESS.filters.ticker}
            </CheckChip>
            {filterOn && (
              <Button size="sm" variant="ghost" onClick={() => patch({ ...NO_FILTER })} data-testid="kongress-filter-reset">
                {KONGRESS.filters.reset}
              </Button>
            )}
          </div>
        </div>

        {symbol && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mute" data-testid="kongress-selected">
            <span>
              Auf der Seite gewählt: <span className="num font-mono text-fg">{symbol}</span>
            </span>
            <button type="button" onClick={openAnalysis} className="underline decoration-line-2 underline-offset-4 outline-none hover:decoration-fg focus-visible:decoration-fg pointer-coarse:min-h-11" data-testid="kongress-to-analysis">
              Zur Analyse
            </button>
          </p>
        )}

        {/* the state of the sources, always in words */}
        <div className="grid gap-2" role="status" aria-live="polite" data-testid="kongress-status">
          {firstLoad && !noIndex && (
            <div className="grid gap-2" data-testid="kongress-loading">
              <p className="text-[13px] text-mute">{KONGRESS.loading}</p>
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {noIndex && shownFail && (
            <div className="grid gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px] leading-snug" role="alert" data-testid="kongress-error" data-reason={shownFail.reason}>
              <p className="font-medium text-fg">{KONGRESS.indexFailedTitle}</p>
              <p className="text-mute">{shownFail.message}</p>
              <p className="text-[12px] text-faint">Quelle: {CONGRESS_SOURCE_LABEL} – eine Behördenseite ohne Zusage zur Erreichbarkeit. Es werden keine Meldungen erfunden.</p>
              <div>
                <Button size="sm" variant="ghost" onClick={reload} data-testid="kongress-retry">
                  {KONGRESS.retry}
                </Button>
              </div>
            </div>
          )}
          {indexStale?.status === "stale" && (
            <p className="text-[12.5px] leading-relaxed text-warn" data-testid="kongress-stale">
              {indexStale.message} Stand der Kopie: Abruf {ddmmHHmm(indexStale.fetchedAt)}.
            </p>
          )}
          {!noIndex && indexProblem && (
            <p className="text-[12.5px] leading-relaxed text-warn" data-testid="kongress-index-partial">
              Ein Index konnte nicht gelesen werden: {indexProblem.message}
            </p>
          )}
          {reading && reading.total > 0 && (
            <div className="grid gap-1" data-testid="kongress-progress">
              <p className="num text-[12px] text-mute">
                Meldungen gelesen: {Math.min(reading.done, reading.total)} von {reading.total}
                {reading.capped ? ` (die neuesten ${reading.total} von ${reading.matching} im Zeitraum)` : ""}
              </p>
              <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Meldungen gelesen" aria-valuemin={0} aria-valuemax={reading.total} aria-valuenow={Math.min(reading.done, reading.total)}>
                <div className="h-full origin-left rounded-full bg-fg/70 transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${reading.total ? Math.min(1, reading.done / reading.total) : 0})` }} />
              </div>
            </div>
          )}
          {failedCount > 0 && (
            <div className="text-[12.5px] leading-relaxed text-warn" data-testid="kongress-failed">
              {failedCount} {failedCount === 1 ? "Meldung" : "Meldungen"} konnte{failedCount === 1 ? "" : "n"} nicht gelesen werden:{" "}
              {[...failed.entries()].map(([reason, n]) => `${FAIL_SHORT[reason] ?? reason} (${n})`).join(", ")}.{" "}
              <button type="button" onClick={reload} className="underline underline-offset-4 outline-none hover:text-fg focus-visible:text-fg pointer-coarse:min-h-11" data-testid="kongress-retry-reports">
                {KONGRESS.retry}
              </button>
            </div>
          )}
          {staleReports > 0 && (
            <p className="text-[12.5px] leading-relaxed text-warn" data-testid="kongress-stale-reports">
              {staleReports} {staleReports === 1 ? "Meldung stammt" : "Meldungen stammen"} aus dem Zwischenspeicher dieses Geräts, weil der Abruf nicht klappte.
            </p>
          )}
          {reading && reading.capped && !busy && (
            <div>
              <Button size="sm" variant="ghost" onClick={() => setCap((c) => c + READ_STEP)} data-testid="kongress-read-more">
                {KONGRESS.readMore}
              </Button>
            </div>
          )}
        </div>

        {!noIndex && !firstLoad && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-mute" data-testid="kongress-visit">
              {prevSeen == null ? (
                <span>{KONGRESS.firstVisit}</span>
              ) : (
                <>
                  <span>{fresh.size > 0 ? `${fresh.size} ${fresh.size === 1 ? "Meldung" : "Meldungen"} neu seit deinem letzten Besuch (${ddmmHHmm(prevSeen.at)})` : `Nichts Neues seit deinem letzten Besuch (${ddmmHHmm(prevSeen.at)})`}</span>
                  {fresh.size > 0 && (
                    <button type="button" onClick={markSeen} className="underline decoration-line-2 underline-offset-4 outline-none hover:decoration-fg focus-visible:decoration-fg pointer-coarse:min-h-11" data-testid="kongress-markseen">
                      {KONGRESS.markSeen}
                    </button>
                  )}
                </>
              )}
            </div>

            <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-mute sm:flex sm:flex-wrap" data-testid="kongress-summary">
              <div>
                <dt className="inline text-faint">Zeilen </dt>
                <dd className="inline text-fg" data-testid="kongress-count-rows">
                  {summary.rows}
                </dd>
              </div>
              <div>
                <dt className="inline text-faint">aus Meldungen </dt>
                <dd className="inline text-fg">
                  {summary.read} von {summary.filings}
                </dd>
              </div>
              <div>
                <dt className="inline text-faint">mit Kürzel </dt>
                <dd className="inline text-fg">{summary.withTicker}</dd>
              </div>
              <div>
                <dt className="inline text-faint">auf deiner Watchlist </dt>
                <dd className="inline text-fg" data-testid="kongress-count-watch">
                  {summary.watched}
                </dd>
              </div>
              <div>
                <dt className="inline text-faint">über 45 Tage gemeldet </dt>
                <dd className="inline text-fg">{summary.late}</dd>
              </div>
              {(summary.unreadableRows > 0 || summary.unreadableReports > 0) && (
                <div>
                  <dt className="inline text-faint">nicht lesbar </dt>
                  <dd className="inline text-warn" data-testid="kongress-count-unreadable">
                    {summary.unreadableRows + summary.unreadableReports}
                  </dd>
                </div>
              )}
            </dl>

            {scope.length === 0 && !busy && (
              <p className="text-[13px] text-mute" data-testid="kongress-none">
                {scopedMember ? KONGRESS.noMemberFilings : KONGRESS.noFilings}
              </p>
            )}
            {scope.length > 0 && filtered.lines.length === 0 && read > 0 && (
              <p className="text-[13px] text-mute" data-testid="kongress-nomatch">
                {KONGRESS.noMatch}
              </p>
            )}
            {filtered.hiddenUnreadable > 0 && (
              <p className="text-[12px] text-faint" data-testid="kongress-hidden-unreadable">
                {filtered.hiddenUnreadable} nicht lesbare {filtered.hiddenUnreadable === 1 ? "Zeile ist" : "Zeilen sind"} durch deine Filter ausgeblendet – ohne Filter stehen sie mit Link zum PDF in der Liste.
              </p>
            )}
            {emptyReports > 0 && (
              <p className="text-[12px] text-faint" data-testid="kongress-empty-reports">
                {emptyReports} {emptyReports === 1 ? "Meldung enthält" : "Meldungen enthalten"} keine Geschäftszeilen.
              </p>
            )}

            {filtered.lines.length > 0 && (
              <RevealGroup className="grid gap-2">
                {filtered.lines.slice(0, shown).map((l) => (
                  <RevealItem key={l.key}>
                    <TradeCard line={l} selected={symbol} onSelect={select} />
                  </RevealItem>
                ))}
              </RevealGroup>
            )}
            {filtered.lines.length > shown && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)} data-testid="kongress-more">
                  Weitere {Math.min(PAGE, filtered.lines.length - shown)} anzeigen
                </Button>
              </div>
            )}
          </>
        )}

        <section className="grid gap-1 rounded-xl border border-line bg-ink-950/30 px-3.5 py-3" data-testid="kongress-senate" aria-labelledby="kongress-senate-h">
          <h3 id="kongress-senate-h" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {KONGRESS.senateTitle}
          </h3>
          <p className="max-w-[88ch] text-[12.5px] leading-relaxed text-mute">
            {KONGRESS.senateText}{" "}
            <a href={SENATE_SEARCH_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-fg hover:decoration-fg">
              {KONGRESS.senateLink}
              <span className="sr-only"> (öffnet in einem neuen Tab)</span>
            </a>
          </p>
        </section>

        <div className="grid gap-1.5">
          <SourceStand
            source={stamp ? CONGRESS_SOURCE_LABEL : null}
            parts={stamp ? [{ label: "Index vom", at: stamp.asOf, long: true }, { label: "Abruf", at: stamp.fetchedAt }] : []}
            testId="kongress-stand"
            className={cn("text-[11.5px]", !stamp && "text-faint")}
          />
          <p className="text-[11.5px] leading-relaxed text-faint">
            <a href={CONGRESS_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-fg hover:decoration-fg">
              Offene Finanzoffenlegung des House Clerk
              <span className="sr-only"> (öffnet in einem neuen Tab)</span>
            </a>{" "}
            · {KONGRESS.disclaimer}
          </p>
          <CardNote lead="Das sind Meldungen von Dritten, keine Analyse der App." />
        </div>
      </div>
    </Card>
  );
}
