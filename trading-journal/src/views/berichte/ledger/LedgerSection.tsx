/**
 * Transaktionsbuch (F70, section of the Berichte page): the journal's money events as a ledger – date/time, account, market,
 * kind (Eröffnen / Schließen / Gebühr / Funding), quantity, price, fee, realised result per closing matched first-in-first-out –
 * with a year summary, the visible Abgleich (gaps, possible duplicates, missing fees / funding / times, difference to the
 * journal), the zone to read it in, CSV and print export. A Hilfsrechnung: no tax is computed and no holding period is claimed,
 * and the head of every export says so. One lazy chunk – the first load never imports it.
 */
import { useMemo, useState } from "react";
import { deviceTimeZone, formatDay, formatStamp, ZONE_CHOICES } from "@/domain/events/zone";
import { dec, buildLedger, FLAG_LABEL, KIND_LABEL, ledgerFilename, ledgerToCsv, LEDGER_NOTE, LEDGER_SCOPE_NOTE, matchesToCsv, rowsOfYear, type FlagId, type Ledger, type LedgerRow, type Scope, type YearSummary } from "@/domain/ledger";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { cn } from "@/lib/cn";
import { n2 } from "@/lib/format";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { download } from "@/store/download";
import { pushToast, type AccFilter } from "@/store/uiStore";
import { NO_ADVICE_TEXT } from "@/ui/AnalysisNote";
import { LedgerPrint } from "./LedgerPrint";
import { useLedgerPrefs, useLedgerZone } from "./prefs";
import { LEDGER as L } from "./strings";

const PAGE = 50;
const MIME = "text/csv;charset=utf-8";

const tone = (v: number | null | undefined): string => (v == null || v === 0 ? "text-fg" : v > 0 ? "text-win" : "text-loss");

function Cell({ label, value, className, valueClass }: { label: string; value: string; className?: string; valueClass?: string }) {
  return (
    <span className={cn("grid min-w-0 content-start gap-0.5", !value && "max-md:hidden", className)}>
      <span className="text-[10.5px] uppercase tracking-[0.1em] text-faint md:hidden">{label}</span>
      <span className={cn("num min-w-0 break-words text-[12.5px] text-fg md:text-right", valueClass)}>{value}</span>
    </span>
  );
}

const COLS = "md:grid-cols-[8.75rem_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)]";

function RowItem({ row, zone, cur }: { row: LedgerRow; zone: string; cur: string }) {
  const warn = row.flags.some((f) => f.level === "warn");
  const kind = `${KIND_LABEL[row.kind]}${row.action ? ` · ${row.action}` : ""}${row.kind === "open" || row.kind === "close" ? ` · ${row.side === "short" ? "Short" : "Long"}` : ""}`;
  const result = row.realized != null ? n2(row.realized) : row.kind === "close" && row.unmatchedQty > 0 ? L.openResult : "";
  return (
    <li className={cn("grid gap-x-3 gap-y-1.5 rounded-xl border bg-ink-950/40 px-3 py-2.5 max-md:grid-cols-2", COLS, warn ? "border-warn/30" : "border-line")} data-testid="ledger-row" data-kind={row.kind} data-id={row.id} data-flags={row.flags.map((f) => f.id).join(" ") || undefined}>
      <span className="num font-mono text-[12px] text-fg max-md:col-span-2">{formatStamp(row.at, zone)}</span>
      <span className="min-w-0 text-[12.5px] leading-snug text-fg max-md:col-span-2">
        {ACCOUNT_LABELS[row.account]} · {row.market}
        {row.exchange && <span className="text-faint"> · {row.exchange}</span>}
      </span>
      <span className="min-w-0 text-[12.5px] leading-snug text-fg max-md:col-span-2">{kind}</span>
      <Cell label={L.cols.qty} value={dec(row.qty, 0)} />
      <Cell label={L.cols.price} value={dec(row.price)} />
      <Cell label={L.cols.fee} value={dec(row.fee)} />
      <Cell label={L.cols.funding} value={dec(row.funding)} />
      <Cell label={`${L.cols.result} (${cur})`} value={result} valueClass={tone(row.realized)} className="max-md:col-span-2" />
      {row.flags.length > 0 && (
        <ul className="grid gap-1 md:col-span-full max-md:col-span-2" data-testid="ledger-flags">
          {row.flags.map((f) => (
            <li key={f.id + f.text} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-[11.5px] leading-snug text-mute" data-flag={f.id}>
              <Badge tone={f.level === "warn" ? "warn" : "mute"}>{FLAG_LABEL[f.id]}</Badge>
              <span className="min-w-0 flex-1">{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      {row.kind === "close" && row.matches.length > 0 && (
        <details className="text-[11.5px] text-mute md:col-span-full max-md:col-span-2" data-testid="ledger-matches">
          <summary className="cursor-pointer select-none py-0.5 text-faint hover:text-mute pointer-coarse:min-h-11 pointer-coarse:py-3.5">
            {L.matches} ({row.matches.length})
          </summary>
          <ul className="grid gap-1 pt-1">
            {row.matches.map((m, i) => (
              <li key={i} className="num leading-snug">
                {L.matchLine(dec(m.qty, 0), formatDay(m.openAt, zone), dec(m.openPrice), dec(m.closePrice), n2(m.realized))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function YearBlock({ y, cur }: { y: YearSummary; cur: string }) {
  const item = (label: string, v: string, cls?: string) => (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[10.5px] uppercase tracking-[0.1em] text-faint">{label}</dt>
      <dd className={cn("num text-[13px]", cls ?? "text-fg")}>{v}</dd>
    </div>
  );
  return (
    <section aria-label={`${L.summary} ${y.year}`} className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3" data-testid="ledger-year" data-year={y.year}>
      <h3 className="flex flex-wrap items-baseline gap-x-3 text-[14px] font-semibold text-fg">
        {y.year}
        <span className="text-[12px] font-normal text-faint">
          {y.closes} {L.closes} · {cur}
        </span>
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {item(L.gains, n2(y.gains), "text-win")}
        {item(L.losses, n2(y.losses), y.losses < 0 ? "text-loss" : "text-fg")}
        {item(L.gross, n2(y.gross), tone(y.gross))}
        {item(L.fees, n2(y.fees))}
        {item(L.funding, n2(y.funding))}
        {item(L.net, n2(y.net), tone(y.net))}
      </dl>
      {(y.flagged > 0 || y.duplicateGross !== 0 || y.unmatchedQty > 0) && (
        <p className="text-[11.5px] leading-snug text-mute" data-testid="ledger-year-flags">
          {y.flagged > 0 && (
            <>
              {y.flagged} {L.flagged}.{" "}
            </>
          )}
          {y.duplicateGross !== 0 && <>{L.duplicateIn(`${n2(y.duplicateGross)} ${cur}`)}. </>}
          {y.unmatchedQty > 0 && <>{L.unmatched(dec(y.unmatchedQty, 0))}.</>}
        </p>
      )}
    </section>
  );
}

export default function LedgerSection({ acc }: { acc: AccFilter }) {
  const trades = useJournal((s) => s.trades);
  const currency = useJournal((s) => s.settings.currency);
  const zone = useLedgerZone();
  const scope = useLedgerPrefs((s) => s.scope);
  const setScope = useLedgerPrefs((s) => s.setScope);
  const setTz = useLedgerPrefs((s) => s.setTz);
  const device = deviceTimeZone();
  const [pick, setPick] = useState<number | null | undefined>(undefined);
  const [flag, setFlag] = useState<FlagId | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [printAt, setPrintAt] = useState<number | null>(null);

  const scoped = useMemo(() => (acc === "all" ? trades : trades.filter((t) => (t.account ?? "scalp") === acc)), [trades, acc]);
  const ledger: Ledger = useMemo(() => buildLedger(scoped, { currency }, { sourceZone: device, displayZone: zone, scope }), [scoped, currency, device, zone, scope]);

  const lastYear = ledger.years.length ? ledger.years[ledger.years.length - 1]!.year : null;
  const year: number | null = pick === null ? null : pick !== undefined && ledger.years.some((y) => y.year === pick) ? pick : lastYear;
  const yearRows = useMemo(() => rowsOfYear(ledger, year, zone), [ledger, year, zone]);
  const counts = useMemo(() => {
    const c: Partial<Record<FlagId, number>> = {};
    for (const r of yearRows) for (const f of new Set(r.flags.map((x) => x.id))) c[f] = (c[f] ?? 0) + 1;
    return c;
  }, [yearRows]);
  const flagIds = (Object.keys(counts) as FlagId[]).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
  const activeFlag = flag && counts[flag] ? flag : null;
  const rows = activeFlag ? yearRows.filter((r) => r.flags.some((f) => f.id === activeFlag)) : yearRows;
  const visible = rows.slice(0, shown);
  const summaries = ledger.years.filter((y) => year == null || y.year === year);
  const yearOptions = [{ value: "all", label: L.allYears }, ...ledger.years.map((y) => ({ value: String(y.year), label: String(y.year) }))];
  const zoneOptions = useMemo(() => {
    const ids = new Set<string>([device, ...ZONE_CHOICES.map((z) => z.id)]);
    return [...ids].map((id) => ({ value: id, label: id === device ? `${L.zoneDevice} (${id})` : (ZONE_CHOICES.find((z) => z.id === id)?.label ?? id) }));
  }, [device]);

  const save = async (kind: "buch" | "zuordnung"): Promise<void> => {
    const now = Date.now();
    const data = kind === "buch" ? ledgerToCsv(ledger, year, now) : matchesToCsv(ledger, year, now);
    const name = ledgerFilename(kind, year);
    if (await download(name, data, MIME)) pushToast({ kind: "success", title: L.saved, detail: name });
  };

  return (
    <Card title={L.title} note={L.note} data-testid="ledger-card" data-rows={ledger.rows.length}>
      <div className="grid gap-5">
        <p className="text-[12.5px] leading-relaxed text-mute">{L.lead}</p>

        {ledger.rows.length === 0 && ledger.unresolved.length === 0 ? (
          <p className="rounded-xl border border-line-2 bg-white/[0.03] px-3 py-2.5 text-[12.5px] leading-snug text-mute" data-testid="ledger-empty">
            {L.empty}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="grid min-w-0 gap-1.5">
                <span id="ledger-year-l" className="label">
                  {L.year}
                </span>
                <MorphSelect aria-labelledby="ledger-year-l" value={year == null ? "all" : String(year)} onChange={(v) => { setPick(v === "all" ? null : Number(v)); setShown(PAGE); setFlag(null); }} options={yearOptions} size="md" className="min-w-[8rem]" data-testid="ledger-year-select" />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <span id="ledger-zone-l" className="label">
                  {L.zone}
                </span>
                <MorphSelect aria-labelledby="ledger-zone-l" value={zone} onChange={(v) => setTz(v === device ? null : v)} options={zoneOptions} size="md" className="min-w-[13rem]" data-testid="ledger-zone" />
              </div>
              <div className="grid gap-1.5">
                <span id="ledger-scope-l" className="label">
                  {L.scope}
                </span>
                <Segmented<Scope> aria-labelledby="ledger-scope-l" size="md" value={scope} onChange={setScope} options={[{ v: "position", label: L.scopePosition }, { v: "market", label: L.scopeMarket }]} />
              </div>
            </div>
            <p className="text-[11.5px] leading-snug text-faint" data-testid="ledger-scope-help">
              {L.scopeHelp[scope]} {L.zoneNote(device)}
            </p>

            <section aria-label={L.summary} className="grid gap-2" data-testid="ledger-summary">
              <h3 className="label">{L.summary}</h3>
              <div className="grid gap-2.5">{summaries.map((y) => <YearBlock key={y.year} y={y} cur={currency} />)}</div>
              <p className="text-[11.5px] leading-snug text-faint">{L.summaryNote}</p>
            </section>

            <section aria-label={L.checks} className="grid gap-2" data-testid="ledger-checks">
              <h3 className="label">{L.checks}</h3>
              {flagIds.length === 0 ? (
                <p className="text-[12.5px] text-mute" data-testid="ledger-checks-ok">
                  {L.checksOk}
                </p>
              ) : (
                <div role="group" aria-label={L.checksFilter} className="flex flex-wrap gap-1.5">
                  <button type="button" aria-pressed={activeFlag == null} onClick={() => { setFlag(null); setShown(PAGE); }} className={cn("touch-hit min-h-9 rounded-full border px-3 text-[12px] pointer-coarse:min-h-11", activeFlag == null ? "border-line-2 bg-ink-750 text-fg" : "border-line-2 text-mute hover:text-fg")}>
                    {L.checksAll}
                  </button>
                  {flagIds.map((id) => (
                    <button key={id} type="button" aria-pressed={activeFlag === id} onClick={() => { setFlag(activeFlag === id ? null : id); setShown(PAGE); }} data-testid={`ledger-flag-${id}`} className={cn("touch-hit min-h-9 rounded-full border px-3 text-[12px] pointer-coarse:min-h-11", activeFlag === id ? "border-line-2 bg-ink-750 text-fg" : "border-line-2 text-mute hover:text-fg")}>
                      {FLAG_LABEL[id]} · {counts[id]}
                    </button>
                  ))}
                </div>
              )}
              {ledger.unresolved.length > 0 && (
                <div className="grid gap-1.5 rounded-xl border border-warn/30 bg-ink-950/40 p-3" data-testid="ledger-unresolved">
                  <h4 className="text-[12.5px] font-semibold text-fg">
                    {L.unresolved} ({ledger.unresolved.length})
                  </h4>
                  <p className="text-[11.5px] leading-snug text-mute">{L.unresolvedNote}</p>
                  <ul className="grid gap-1">
                    {ledger.unresolved.map((u) => (
                      <li key={u.tradeId} className="text-[12px] leading-snug text-fg" data-testid="ledger-unresolved-row">
                        {u.at != null ? `${formatStamp(u.at, zone)} · ` : ""}
                        {u.market}: <span className="text-mute">{u.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ledger.openLots.length > 0 && (
                <details className="text-[12px] text-mute" data-testid="ledger-open">
                  <summary className="cursor-pointer select-none py-1 text-faint hover:text-mute pointer-coarse:min-h-11 pointer-coarse:py-3.5">
                    {L.openLots} ({ledger.openLots.length})
                  </summary>
                  <ul className="grid gap-1 pt-1">
                    {ledger.openLots.map((o, i) => (
                      <li key={i} className="num leading-snug">
                        {L.openLotLine(o.side === "short" ? "Short" : "Long", dec(o.qty, 0), o.market, dec(o.price), formatStamp(o.at, zone))}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            <section aria-label={L.rows} className="grid gap-2" data-testid="ledger-rows">
              <h3 className="label">
                {L.rows} · {rows.length}
              </h3>
              {rows.length === 0 ? (
                <p className="text-[12.5px] text-mute">{L.emptyYear}</p>
              ) : (
                <>
                  <div className={cn("hidden gap-x-3 px-3 text-[10.5px] uppercase tracking-[0.1em] text-faint md:grid", COLS)} aria-hidden="true">
                    <span>{L.cols.time}</span>
                    <span>{L.cols.market}</span>
                    <span>{L.cols.kind}</span>
                    <span className="text-right">{L.cols.qty}</span>
                    <span className="text-right">{L.cols.price}</span>
                    <span className="text-right">{L.cols.fee}</span>
                    <span className="text-right">{L.cols.funding}</span>
                    <span className="text-right">{L.cols.result}</span>
                  </div>
                  <ul className="grid gap-2">
                    {visible.map((r) => (
                      <RowItem key={r.id} row={r} zone={zone} cur={currency} />
                    ))}
                  </ul>
                  {rows.length > visible.length && (
                    <Button size="sm" className="w-fit pointer-coarse:min-h-11" onClick={() => setShown(shown + PAGE)} data-testid="ledger-more">
                      {L.showMore(Math.min(PAGE, rows.length - visible.length))}
                    </Button>
                  )}
                </>
              )}
            </section>

            <section aria-label={L.export} className="grid gap-2" data-testid="ledger-export">
              <h3 className="label">{L.export}</h3>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => void save("buch")} disabled={ledger.rows.length === 0} data-testid="ledger-csv">
                  {L.csvBook}
                </Button>
                <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => void save("zuordnung")} disabled={ledger.rows.length === 0} data-testid="ledger-csv-match">
                  {L.csvMatch}
                </Button>
                <Button size="sm" variant="primary" className="pointer-coarse:min-h-11" onClick={() => setPrintAt(Date.now())} disabled={ledger.rows.length === 0 || printAt != null} data-testid="ledger-print-btn">
                  {L.print}
                </Button>
              </div>
              <p className="text-[11.5px] leading-snug text-faint">
                {L.printHint} {LEDGER_NOTE}.
              </p>
            </section>
          </>
        )}

        <p className="text-[11.5px] leading-snug text-mute" data-testid="ledger-scope-note">
          {LEDGER_SCOPE_NOTE}
        </p>
        <p className="text-[12px] leading-relaxed text-mute">
          {LEDGER_NOTE}. {NO_ADVICE_TEXT}
        </p>
      </div>
      {printAt != null && <LedgerPrint ledger={ledger} year={year} now={printAt} onDone={() => setPrintAt(null)} />}
    </Card>
  );
}
