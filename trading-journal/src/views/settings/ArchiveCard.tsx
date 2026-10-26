/**
 * „Datenarchiv“ (F26) – the switch, the choices and the overview of the local archive. It sits in the settings because it
 * is a setting about this device's storage and privacy (on / off, size, deletion) – not a daily view and not the start
 * page. A lazy chunk of its own: the settings page fetches it when it renders the card.
 *
 * Honest by construction: the card says what is stored, that nothing leaves the device, that it is no part of backup /
 * cloud sync, that nothing is collected while the app is closed (that is a visible gap, never filled), and shows the
 * gaps it finds with their reason. Off by default. Written at once (no „Speichern“): the switch and the choices belong
 * to this device and are applied like the Lage-Ampel card.
 */
import { AnimatePresence, motion } from "motion/react";
import { memo, useMemo, useState } from "react";
import { ARCHIVE_MAX_SYMBOLS, EVERY_MIN_CHOICES, FAIL_LABEL, MAX_MB_CHOICES, effectiveSymbols, gapText, observedSymbols, seriesDef, type Gap } from "@/domain/archive";
import { boxesCfgOf } from "@/domain/boxes";
import { cn } from "@/lib/cn";
import { ddmmHHmm } from "@/market/format";
import { setArchiveCfg, useArchiveCfg, useArchiveStatus, bumpArchiveRev, type ArchiveStatus } from "@/market/archive/store";
import { tvSymbolToBinance } from "@/market/symbol";
import { HoldConfirm, confirmSwapMotion, useConfirmFocus } from "@/motion/HoldConfirm";
import { Switch } from "@/motion/Switch";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { ARCHIVE_STRINGS as S, SIZE_LABEL, bytesText, durationText, gapSummary, groupBySymbol, rangeText, rowLabel, totalsOf, type RowView } from "./archiveModel";
import { exportAllFile, exportRowFile } from "./archiveExport";
import { useArchiveData } from "./useArchiveData";

const BIG_POINTS = 150_000;
type Iv = "5" | "10" | "15";
type Mb = "10" | "25" | "50" | "100";
const n = (v: number): string => v.toLocaleString("de-DE");

/** The status line under the switch. */
export function statusText(cfg: { on: boolean; everyMin: number }, st: ArchiveStatus): string {
  if (!cfg.on) return S.statusOff;
  if (st.state === "starting" || st.state === "off") return S.starting;
  if (st.state === "ticking") return S.ticking;
  if (st.state === "quota") return S.quota;
  if ((st.state === "empty" || st.state === "unavailable" || st.state === "error") && st.detail) return st.detail;
  const bits = ["Läuft"];
  if (st.lastTickAt) bits.push(`letzter Abruf ${ddmmHHmm(st.lastTickAt)}`);
  if (st.nextTickAt) bits.push(`nächster ${ddmmHHmm(st.nextTickAt)}`);
  if (st.route) bits.push(st.route === "proxy" ? S.viaProxy : S.direct);
  return bits.join(" · ");
}

/** What went wrong in the last tick, per symbol („BTCUSDT: Netzwerk- oder CORS-Fehler“), or `null`. */
export function failureText(res: ArchiveStatus["lastRes"]): string | null {
  if (!res) return null;
  const bad = Object.entries(res).filter(([, v]) => v !== "ok");
  if (!bad.length) return null;
  return bad
    .map(([sym, v]) => {
      const reason = v.startsWith("partial:") ? v.slice(8) : v;
      return `${sym}: ${v.startsWith("partial:") ? "teilweise – " : ""}${FAIL_LABEL[reason] ?? (reason === "quota" ? "Speicher voll" : reason)}`;
    })
    .join(" · ");
}

function SwitchRow({ id, label, help, checked, onChange, disabled }: { id: string; label: string; help: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 transition-opacity duration-200", disabled && "opacity-50")}>
      <span className="grid min-w-0 gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-[13px] text-fg">
          {label}
        </label>
        <span id={`${id}-help`} className="text-[11.5px] leading-snug text-mute">
          {help}
        </span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-help`} disabled={disabled} className="touch-hit mt-0.5 shrink-0" />
    </div>
  );
}

/** Delete with two paths: hold = at once, tap = ask first (`Wirklich löschen? Ja / Nein`). */
function DeleteButton({ label, text = S.del, onDelete, disabled }: { label: string; text?: string; onDelete: () => void | Promise<void>; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  const reduced = useReducedFx();
  const { trigger, no } = useConfirmFocus(asking);
  const run = () => {
    setAsking(false);
    void onDelete();
  };
  return (
    <AnimatePresence mode="wait" initial={false}>
      {asking ? (
        <motion.span key="ask" {...confirmSwapMotion(reduced)} className="flex flex-wrap items-center gap-2 text-[12px] text-(--color-danger-text)" role="alert">
          {S.delAsk}
          <Button size="sm" variant="danger" className="pointer-coarse:min-h-11" onClick={run}>
            {S.yes}
          </Button>
          <Button ref={no} size="sm" className="pointer-coarse:min-h-11" onClick={() => setAsking(false)}>
            {S.no}
          </Button>
        </motion.span>
      ) : (
        <motion.span key="hold" {...confirmSwapMotion(reduced)} className="inline-flex">
          <HoldConfirm ref={trigger} variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={disabled} onAsk={() => setAsking(true)} onConfirm={run} aria-label={label}>
            {text}
          </HoldConfirm>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function GapList({ gaps }: { gaps: readonly Gap[] }) {
  const shown = [...gaps].reverse().slice(0, 30);
  return (
    <ul className="mt-2 grid gap-1 text-[11.5px] text-mute" data-testid="archive-gap-list">
      {shown.map((g) => (
        <li key={g.from} className="num">
          {ddmmHHmm(g.from)} – {ddmmHHmm(g.to)} · {durationText(g.to - g.from)} · {gapText(g)}
        </li>
      ))}
      {gaps.length > shown.length && <li className="text-faint">… und {gaps.length - shown.length} ältere</li>}
    </ul>
  );
}

function RowItem({ row, onCsv, onJson, onDelete }: { row: RowView; onCsv: () => void; onJson: () => void; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const { info, gaps } = row;
  const def = seriesDef(info.series);
  const hasGaps = !!gaps && gaps.length > 0;
  return (
    <li className="grid gap-1.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5" data-testid="archive-row" data-series={info.series} data-symbol={info.symbol}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-[13px] font-medium text-fg">{rowLabel(info.series)}</span>
        <span className="num text-[12px] text-mute">
          {n(info.count)} {info.count === 1 ? "Eintrag" : "Einträge"} · ca. {bytesText(info.count * def.bytes)}
        </span>
      </div>
      <p className="num text-[12px] text-mute">{rangeText(info.first, info.last)}</p>
      <p className={cn("text-[12px]", hasGaps ? "text-warn" : "text-mute")} data-testid="archive-gap-summary">
        {gapSummary(gaps)}
        {hasGaps && (
          <button type="button" className="ml-2 underline underline-offset-2 hover:text-fg pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? S.gapsHide : S.gapsShow}
          </button>
        )}
      </p>
      {open && hasGaps && <GapList gaps={gaps} />}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button size="sm" className="pointer-coarse:min-h-11" onClick={onCsv} aria-label={`${rowLabel(info.series)} ${info.symbol} als CSV`}>
          {S.csv}
        </Button>
        <Button size="sm" className="pointer-coarse:min-h-11" onClick={onJson} aria-label={`${rowLabel(info.series)} ${info.symbol} als JSON`}>
          {S.json}
        </Button>
        <DeleteButton label={`${rowLabel(info.series)} ${info.symbol} löschen`} onDelete={onDelete} />
      </div>
    </li>
  );
}

export const ArchiveCard = memo(function ArchiveCard({ className }: { className?: string }) {
  const cfg = useArchiveCfg();
  const status = useArchiveStatus();
  const data = useArchiveData(status.rev);
  const pushToast = useUi((s) => s.pushToast);
  const liveRaw = useJournal((s) => s.settings.market.symbol);
  const watch = useJournal((s) => (s.settings as { boxes?: unknown }).boxes);
  const observed = useMemo(() => observedSymbols(tvSymbolToBinance(liveRaw), boxesCfgOf(watch).watchlist), [liveRaw, watch]);
  const chosen = effectiveSymbols(cfg, observed);
  const groups = useMemo(() => groupBySymbol(data.rows), [data.rows]);
  const totals = useMemo(() => totalsOf(data.rows), [data.rows]);
  const unavailable = data.phase === "unavailable" || status.state === "unavailable";

  const toggleSymbol = (s: string) => {
    const has = chosen.includes(s);
    if (!has && chosen.length >= ARCHIVE_MAX_SYMBOLS) return;
    setArchiveCfg({ picked: has ? chosen.filter((x) => x !== s) : [...chosen, s] });
  };

  const fail = () => pushToast({ kind: "error", title: S.exportFailed });
  const exportRow = async (row: RowView, kind: "csv" | "json") => {
    const db = data.db();
    try {
      if (!db) throw new Error("no db");
      await exportRowFile(db, row, kind);
    } catch {
      fail();
    }
  };
  const exportAll = async () => {
    const db = data.db();
    try {
      if (!db) throw new Error("no db");
      await exportAllFile(db, data.rows);
    } catch {
      fail();
    }
  };
  const deleteRow = async (row: RowView) => {
    await data.db()?.deleteRow(row.info.series, row.info.symbol);
    bumpArchiveRev();
  };
  const deleteAll = async () => {
    await data.db()?.deleteAll();
    bumpArchiveRev();
  };

  const failures = cfg.on ? failureText(status.lastRes) : null;

  return (
    <Card title={S.title} note={S.note} className={className} data-testid="settings-archive-card">
      <div className="grid gap-4">
        <div className="grid gap-1.5 text-[12px] leading-relaxed text-mute">
          <p data-testid="archive-what">{S.what}</p>
          <p data-testid="archive-local">{S.local}</p>
          <p data-testid="archive-limit">{S.limit}</p>
        </div>

        <SwitchRow id="archive-on" label={S.switch} help={cfg.on ? S.switchOn(cfg.everyMin) : S.switchOff} checked={cfg.on} onChange={(on) => setArchiveCfg({ on })} disabled={unavailable && !cfg.on} />
        <p className="num -mt-2 text-[12px] text-mute" role="status" data-testid="archive-status" data-state={cfg.on ? status.state : "off"}>
          {statusText(cfg, status)}
        </p>
        {failures && (
          <p className="-mt-2 text-[12px] text-warn" data-testid="archive-failures">
            Letzter Abruf: {failures}
          </p>
        )}
        {unavailable && <p className="text-[12px] text-warn" data-testid="archive-unavailable">{S.unavailable}</p>}

        {cfg.on && (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="archive-options">
            <div className="grid content-start gap-3">
              <div className="grid gap-1.5">
                <span id="archive-iv-label" className="label">
                  {S.interval}
                </span>
                <Segmented<Iv>
                  aria-labelledby="archive-iv-label"
                  size="sm"
                  className="justify-self-start"
                  value={`${cfg.everyMin}` as Iv}
                  onChange={(v) => setArchiveCfg({ everyMin: Number(v) as (typeof EVERY_MIN_CHOICES)[number] })}
                  options={EVERY_MIN_CHOICES.map((m) => ({ v: `${m}` as Iv, label: `${m} Min` }))}
                />
              </div>
              <div className="grid gap-1.5">
                <span id="archive-mb-label" className="label">
                  {S.maxMb}
                </span>
                <Segmented<Mb>
                  aria-labelledby="archive-mb-label"
                  size="sm"
                  className="justify-self-start"
                  value={`${cfg.maxMb}` as Mb}
                  onChange={(v) => setArchiveCfg({ maxMb: Number(v) as (typeof MAX_MB_CHOICES)[number] })}
                  options={MAX_MB_CHOICES.map((m) => ({ v: `${m}` as Mb, label: SIZE_LABEL(m) }))}
                />
                <p className="text-[11.5px] leading-snug text-mute">{S.maxMbHelp}</p>
              </div>
              <SwitchRow id="archive-states" label={S.states} help={S.statesHelp} checked={cfg.states} onChange={(states) => setArchiveCfg({ states })} />
            </div>
            <div className="grid content-start gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="label">
                  {S.symbols} · {chosen.length}/{ARCHIVE_MAX_SYMBOLS}
                </span>
                <Button size="sm" className="pointer-coarse:min-h-11" disabled={cfg.picked === null} onClick={() => setArchiveCfg({ picked: null })}>
                  {S.symbolsAuto}
                </Button>
              </div>
              <ul className="flex flex-wrap gap-2" aria-label={S.symbols}>
                {[...new Set([...observed, ...chosen])].map((s) => {
                  const on = chosen.includes(s);
                  const full = !on && chosen.length >= ARCHIVE_MAX_SYMBOLS;
                  return (
                    <li key={s}>
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={full}
                        title={full ? S.symbolsFull : undefined}
                        onClick={() => toggleSymbol(s)}
                        data-testid={`archive-symbol-${s}`}
                        className={cn(
                          "num rounded-full border px-3 py-1 text-[12px] transition-colors duration-200 pointer-coarse:min-h-11",
                          on ? "border-fg/50 bg-white/[0.08] text-fg" : "border-line text-mute hover:border-white/25 hover:text-fg",
                          full && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {s}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11.5px] leading-snug text-mute">{S.symbolsHelp}</p>
            </div>
          </div>
        )}

        <section className="grid gap-2" aria-labelledby="archive-overview-h" data-testid="archive-overview">
          <h3 id="archive-overview-h" className="label">
            {S.overview}
          </h3>
          {data.phase === "loading" && <p className="text-[12px] text-mute">{S.loading}</p>}
          {data.phase === "ready" && !data.rows.length && (
            <p className="text-[12px] text-mute" data-testid="archive-empty">
              {S.empty}
            </p>
          )}
          {data.rows.length > 0 && (
            <>
              <p className="num text-[12.5px] text-fg" data-testid="archive-totals">
                {n(totals.count)} Einträge · ca. {bytesText(totals.bytes)} (geschätzt aus der Zahl der Einträge) · {totals.first !== null && totals.last !== null ? rangeText(totals.first, totals.last) : ""}
                {data.storage && <span className="text-mute"> · Browser gesamt: {bytesText(data.storage.usage)} von {bytesText(data.storage.quota)}</span>}
              </p>
              {groups.map((g) => (
                <div key={g.symbol} className="grid gap-2" data-testid="archive-group" data-symbol={g.symbol}>
                  <h4 className="num mt-1 text-[13px] font-semibold text-fg">{g.symbol}</h4>
                  <ul className="grid gap-2">
                    {g.rows.map((r) => (
                      <RowItem key={`${r.info.series}:${r.info.symbol}`} row={r} onCsv={() => void exportRow(r, "csv")} onJson={() => void exportRow(r, "json")} onDelete={() => deleteRow(r)} />
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-[11.5px] leading-snug text-mute">{S.csvHelp}</p>
              {totals.count > BIG_POINTS && <p className="text-[11.5px] text-warn">{S.exportBig}</p>}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => void exportAll()} data-testid="archive-export-all">
                  {S.exportAll}
                </Button>
                <DeleteButton label={S.delAll} text={S.delAll} onDelete={deleteAll} />
              </div>
            </>
          )}
        </section>
        <p className="text-[12px] text-mute">{S.disclaimer}</p>
      </div>
    </Card>
  );
});

export default ArchiveCard;
