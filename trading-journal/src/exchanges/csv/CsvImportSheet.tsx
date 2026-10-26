import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { deriveTrade } from "@/domain/derive";
import type { Trade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { celebrateFrom } from "@/motion/Celebrate";
import { NumberCascade } from "@/motion/fx/NumberCascade";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { TextRoll } from "@/motion/TextRoll";
import { TextScramble } from "@/motion/TextScramble";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { closeCsvImport, useExchange } from "../store";
import { Money, shortWhen } from "../ui/parts";
import {
  buildTrades,
  FORMATS,
  guessMapping,
  importCsvTrades,
  planCsvMerge,
  loadCsv,
  MAP_FIELDS,
  MAP_LABEL,
  MAP_REQUIRED,
  parseWithMapping,
  type ColumnMapping,
  type LoadedCsv,
  type MapField,
} from "./index";
import { SCOPE_TEXT } from "./scope";

export const CSV_STRINGS = {
  title: "CSV importieren",
  lead: "Export deiner Börse oder Plattform hineinziehen. Das Format wird erkannt, sonst ordnest du die Spalten selbst zu.",
  drop: "CSV hier ablegen",
  choose: "Datei wählen",
  formats: "Erkennt diese Exporte",
  /** F42: what the importers read and what they leave out (`./scope`) */
  scopeSupported: SCOPE_TEXT.csvSupported,
  scopeNot: SCOPE_TEXT.csvNot,
  /** review F11: there is no wallet / on-chain connector – the honest way in is the CSV + the mapping assistant */
  otherSources: "Wallets, DEX und andere Plattformen: Trade-Historie als CSV exportieren und hier hineinziehen – du ordnest die Spalten einmal zu (Datum, Paar, Richtung, Preise, Menge).",
  detected: "Erkannt",
  unknown: "Format nicht erkannt – ordne die Spalten zu.",
  mapping: "Spalten zuordnen",
  none: "—",
  zone: "Zeiten in der Datei",
  zoneUtc: "UTC",
  zoneLocal: "Ortszeit",
  account: "Konto im Journal",
  pair: "Paar",
  preview: "Vorschau",
  trades: "Trades",
  wins: "Gewinner",
  net: "Netto",
  skipped: (n: number) => `${n} Zeilen übersprungen (ohne Richtung, Preis oder Zeit).`,
  top: "Die größten Trades",
  missing: (f: string) => `Bitte „${f}“ zuordnen.`,
  run: "Importieren",
  running: "Importiert …",
  done: (n: number) => (n === 1 ? "1 Trade importiert" : `${n} Trades importiert`),
  updatedOnly: (n: number) => (n === 1 ? "1 Trade aktualisiert" : `${n} Trades aktualisiert`),
  /** the preview against the journal (review F7: a re-import used to promise "Importieren (2)" and import 0) */
  plan: (fresh: number, known: number, changed: number) =>
    [fresh ? `${fresh} neu` : "", known ? `${known} bereits im Journal` : "", changed ? `davon ${changed} mit neuen Börsendaten` : ""].filter(Boolean).join(" · "),
  nothingNew: "Alles schon im Journal",
  nothingNewText: "Diese Trades sind schon importiert – es gibt nichts Neues. Notizen und Setups bleiben, wie sie sind.",
  doneDetail: (u: number, s: number) =>
    [u ? `${u} aktualisiert` : "", s ? `${s} unverändert` : ""].filter(Boolean).join(" · ") || "Notizen und Setups bleiben unberührt.",
  failed: "Import fehlgeschlagen",
  readError: "Datei konnte nicht gelesen werden.",
  tooBig: "Die Datei ist größer als 20 MB – exportiere einen kürzeren Zeitraum.",
  empty: "Keine Trades in der Datei gefunden.",
} as const;

/** A CSV is parsed in the main thread – larger exports are refused instead of freezing the tab. */
export const CSV_MAX_BYTES = 20 * 1024 * 1024;

const ACCOUNTS = [
  { v: "scalp" as const, label: "Scalp" },
  { v: "makro" as const, label: "Makro" },
];
const ZONES = [
  { v: "utc" as const, label: CSV_STRINGS.zoneUtc },
  { v: "local" as const, label: CSV_STRINGS.zoneLocal },
];

const pnlOf = (t: Trade): number | null => deriveTrade(t).pnl;

export interface CsvImportSheetProps {
  /** Injected reader for tests (defaults to `File.text()`). */
  readFile?: (file: File) => Promise<string>;
}

/**
 * "CSV importieren" (P11): drop or choose an export → the format is detected (Bitunix, Binance, Bybit, OKX, Kraken,
 * Coinbase, MT4/5, IBKR Flex, TradingView) and named (TextScramble), otherwise the mapping assistant opens with one
 * MorphSelect per field, pre-filled from the header. The preview counts up (NumberCascade) and lists the biggest
 * trades (StaggerItem cascade); "Importieren" merges into the journal (re-imports never touch notes or setups) and
 * celebrates a winning import. Works in every build – nothing leaves the device.
 */
export function CsvImportSheet({ readFile }: CsvImportSheetProps = {}) {
  const open = useExchange((s) => s.csvOpen);
  const settingsPair = useJournal((s) => s.settings.pair);
  const reduced = useReducedFx();
  const inputRef = useRef<HTMLInputElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const [fileName, setFileName] = useState("");
  const [loaded, setLoaded] = useState<LoadedCsv | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [zone, setZone] = useState<"utc" | "local">("utc");
  const [account, setAccount] = useState<"makro" | "scalp">("scalp");
  const [pair, setPair] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFileName("");
      setLoaded(null);
      setReadError(null);
      setMapping(null);
      setZone("utc");
      setPair(settingsPair || "BTC/USDT");
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setReadError(null);
    if (file.size > CSV_MAX_BYTES) {
      setLoaded(null);
      setReadError(CSV_STRINGS.tooBig);
      return;
    }
    try {
      const text = await (readFile ? readFile(file) : file.text());
      const l = loadCsv(text);
      setLoaded(l);
      setMapping(l.format ? null : guessMapping(l.table.header));
    } catch {
      setLoaded(null);
      setReadError(CSV_STRINGS.readError);
    }
  }

  const parsed = useMemo(() => {
    if (!loaded) return null;
    if (loaded.format) return loaded.format.parse(loaded.table);
    if (!mapping) return null;
    return parseWithMapping(loaded.table, mapping, { assume: zone, fallbackPair: pair || "BTC/USDT" });
  }, [loaded, mapping, zone, pair]);

  const formatId = loaded?.format?.id ?? "generic";
  const trades = useMemo(
    () => (parsed ? buildTrades(parsed, { formatId, venue: loaded?.format?.venue, account, fallbackPair: (pair || "BTC/USDT").toUpperCase() }) : []),
    [parsed, formatId, loaded, account, pair],
  );
  const stats = useMemo(() => {
    const pnls = trades.map(pnlOf).filter((v): v is number => v !== null);
    return { n: trades.length, wins: pnls.filter((v) => v > 0).length, net: Math.round(pnls.reduce((a, b) => a + b, 0) * 100) / 100 };
  }, [trades]);
  const top = useMemo(() => [...trades].sort((a, b) => Math.abs(pnlOf(b) ?? 0) - Math.abs(pnlOf(a) ?? 0)).slice(0, 6), [trades]);
  // what the import would really do: new records, records with new exchange data, records already in the journal
  const journalTrades = useJournal((s) => s.trades);
  const merge = useMemo(() => {
    const p = planCsvMerge(journalTrades, trades, new Date(0).toISOString());
    return { fresh: p.added.length, changed: p.updated.length, known: p.updated.length + p.unchanged, writes: p.added.length + p.updated.length };
  }, [journalTrades, trades]);
  const missingField = !loaded?.format && mapping ? MAP_REQUIRED.find((f) => mapping[f] < 0) : undefined;
  const needsPair = !!loaded && (loaded.format?.id === "tradingview" || (!loaded.format && mapping !== null && mapping.pair < 0));
  const canRun = merge.writes > 0 && !busy && !missingField;

  async function run() {
    if (!canRun) return;
    setBusy(true);
    const res = await importCsvTrades(trades);
    setBusy(false);
    if (!res.ok) {
      pushToast({ kind: "error", title: CSV_STRINGS.failed, detail: res.error });
      return;
    }
    pushToast({
      kind: "success",
      title: res.added > 0 || res.updated === 0 ? CSV_STRINGS.done(res.added) : CSV_STRINGS.updatedOnly(res.updated),
      detail: CSV_STRINGS.doneDetail(res.added > 0 ? res.updated : 0, res.unchanged),
    });
    if (res.added > 0 && stats.net > 0 && runRef.current) celebrateFrom(runRef.current, { kind: "win", tone: "win" });
    closeCsvImport();
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void onFile(e.dataTransfer.files?.[0]);
  };

  const columnOptions = useMemo(
    () => [{ value: "-1", label: CSV_STRINGS.none }, ...(loaded?.table.header ?? []).map((h, i) => ({ value: String(i), label: h || `Spalte ${i + 1}` }))],
    [loaded],
  );

  return (
    <Sheet
      open={open}
      onClose={closeCsvImport}
      size="lg"
      title={CSV_STRINGS.title}
      dismissGuard={false}
      footer={
        <>
          <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{missingField ? CSV_STRINGS.missing(MAP_LABEL[missingField]) : ""}</span>
          <Button onClick={closeCsvImport} disabled={busy}>
            Abbrechen
          </Button>
          <Button ref={runRef} variant="primary" disabled={!canRun} onClick={() => void run()} aria-busy={busy || undefined} data-testid="csv-run">
            <TextRoll
              mode="roll"
              text={busy ? CSV_STRINGS.running : merge.writes ? `${CSV_STRINGS.run} (${merge.writes})` : trades.length ? CSV_STRINGS.nothingNew : CSV_STRINGS.run}
            />
          </Button>
        </>
      }
    >
      <div className="grid gap-5" data-testid="csv-sheet">
        <StaggerItem>
          <p className="text-[13px] text-mute">{CSV_STRINGS.lead}</p>
        </StaggerItem>

        <StaggerItem>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "relative grid place-items-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors",
              dragging ? "border-white/50 bg-white/[0.05]" : "border-line-2 bg-ink-950/40",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,text/plain,.txt"
              className="sr-only"
              aria-label={CSV_STRINGS.choose}
              onChange={(e) => void onFile(e.target.files?.[0])}
              data-testid="csv-file"
            />
            <svg
              viewBox="0 0 24 24"
              className="size-6 text-mute"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 16V4M7 9l5-5 5 5" />
              <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
            </svg>
            <span className="text-[13px] text-mute">{CSV_STRINGS.drop}</span>
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              {CSV_STRINGS.choose}
            </Button>
            {fileName && <span className="max-w-full truncate font-mono text-[11.5px] text-faint">{fileName}</span>}
          </div>
        </StaggerItem>

        {!loaded && (
          <StaggerItem className="grid gap-2">
            <span className="label">{CSV_STRINGS.formats}</span>
            <ul className="flex flex-wrap gap-1.5">
              {FORMATS.map((f) => (
                <li key={f.id} title={f.hint} className="rounded-full border border-line bg-ink-950/40 px-2.5 py-1 text-[11.5px] text-mute">
                  {f.label.split(" – ")[0]}
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] leading-snug text-faint" data-testid="csv-other-sources">
              {CSV_STRINGS.otherSources}
            </p>
            <div className="grid gap-1 text-[11.5px] leading-snug text-mute" data-testid="csv-scope">
              <p>{CSV_STRINGS.scopeSupported}</p>
              <p>{CSV_STRINGS.scopeNot}</p>
            </div>
          </StaggerItem>
        )}

        {readError && (
          <p role="alert" className="rounded-xl border border-loss/30 bg-loss/[0.07] px-3 py-2 text-[13px] text-loss">
            {readError}
          </p>
        )}

        <AnimatePresence mode="popLayout" initial={false}>
          {loaded && (
            <motion.div
              key={fileName}
              className="grid gap-4"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={{ y: spring.enter, opacity: tween.fade }}
            >
              {loaded.format ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-win/30 bg-win/[0.05] px-3 py-2.5" data-testid="csv-detected">
                  <Badge tone="win" dot>
                    {CSV_STRINGS.detected}
                  </Badge>
                  <TextScramble text={loaded.format.label} className="text-[13px] font-medium" />
                </div>
              ) : (
                <div className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3" data-testid="csv-mapping">
                  <p className="text-[12.5px] text-warn">{CSV_STRINGS.unknown}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {MAP_FIELDS.map((f: MapField) => (
                      <label key={f} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-2 text-[12.5px]">
                        <span className={cn("truncate", MAP_REQUIRED.includes(f) ? "text-fg" : "text-mute")}>
                          {MAP_LABEL[f]}
                          {MAP_REQUIRED.includes(f) && <span className="text-signal"> *</span>}
                        </span>
                        <MorphSelect
                          size="sm"
                          aria-label={MAP_LABEL[f]}
                          value={String(mapping?.[f] ?? -1)}
                          onChange={(v) => setMapping((m) => (m ? { ...m, [f]: Number(v) } : m))}
                          options={columnOptions}
                          className="w-full min-w-0"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-1.5">
                    <span className="label">{CSV_STRINGS.zone}</span>
                    <Segmented size="sm" className="justify-self-start" aria-label={CSV_STRINGS.zone} value={zone} onChange={setZone} options={ZONES} />
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid content-start gap-1.5">
                  <span id="csv-account" className="label">
                    {CSV_STRINGS.account}
                  </span>
                  <Segmented className="justify-self-start" aria-labelledby="csv-account" value={account} onChange={setAccount} options={ACCOUNTS} />
                </div>
                {needsPair && (
                  <label className="grid content-start gap-1.5">
                    <span className="label">{CSV_STRINGS.pair}</span>
                    <Input value={pair} onChange={(e) => setPair(e.target.value)} className="font-mono" />
                  </label>
                )}
              </div>

              {parsed && (
                <div className="grid gap-3" data-testid="csv-preview">
                  <span className="label">{CSV_STRINGS.preview}</span>
                  {trades.length === 0 ? (
                    <p className="text-[13px] text-mute">{CSV_STRINGS.empty}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
                          <NumberCascade value={stats.n} className="dot-num text-[28px] leading-none" />
                          <span className="mt-1 block text-[11px] text-faint">{CSV_STRINGS.trades}</span>
                        </div>
                        <div className="rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
                          <NumberCascade value={stats.wins} className="dot-num text-[28px] leading-none text-win" />
                          <span className="mt-1 block text-[11px] text-faint">{CSV_STRINGS.wins}</span>
                        </div>
                        <div className="min-w-0 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
                          <Money value={stats.net} className="block truncate text-[19px] leading-[28px]" />
                          <span className="mt-1 block text-[11px] text-faint">{CSV_STRINGS.net}</span>
                        </div>
                      </div>
                      {merge.known > 0 && (
                        <p className={cn("text-[12px]", merge.writes ? "text-mute" : "text-fg")} data-testid="csv-known" data-writes={merge.writes}>
                          {merge.writes ? CSV_STRINGS.plan(merge.fresh, merge.known, merge.changed) : CSV_STRINGS.nothingNewText}
                        </p>
                      )}
                      <span className="text-[11.5px] text-faint">{CSV_STRINGS.top}</span>
                      <ul className="grid gap-1.5">
                        {top.map((t, i) => (
                          <motion.li
                            key={t.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2"
                            initial={reduced ? false : { opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
                            transition={{ y: { ...spring.enter, delay: i * stagger.reveal }, opacity: { ...tween.fade, delay: i * stagger.reveal } }}
                            data-testid="csv-row"
                          >
                            <span className="flex min-w-0 items-center gap-2 text-[13px]">
                              <span className={cn("size-1.5 shrink-0 rounded-full", t.side === "long" ? "bg-win" : "bg-loss")} aria-hidden="true" />
                              <span className="truncate font-medium">{t.pair}</span>
                              <span className="truncate text-[11px] text-faint">{shortWhen(t.date)}</span>
                              {t.status === "open" && <Badge tone="mute">offen</Badge>}
                            </span>
                            <Money value={pnlOf(t)} className="text-[13px]" />
                          </motion.li>
                        ))}
                      </ul>
                    </>
                  )}
                  {parsed.skipped > 0 && <p className="text-[11.5px] text-faint">{CSV_STRINGS.skipped(parsed.skipped)}</p>}
                  {parsed.warnings.map((w) => (
                    <p key={w} className="text-[11.5px] text-warn">
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
