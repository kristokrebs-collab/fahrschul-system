/**
 * `Watchlist-Scanner` (P02): the A+ / A Box-zu-Box setups of the watchlist (Binance USDT perps), best score first;
 * "Jetzt scannen" on demand, otherwise after every 4h close. While a scan runs the radar turns (`RadarSweep`, the one
 * declared loop – only while scanning) and the progress counts; rows cascade in (`RevealGroup`). An honest status when
 * Binance is not reachable (route via the EU proxy, or the file build without one).
 */
import { motion, useTransform } from "motion/react";
import { BOX_TF_MS, KIND_TEXT, PHASE_LABEL } from "@/domain/boxes";
import { cn } from "@/lib/cn";
import { ddmmHHmm, hhmm, hhmmss } from "@/market/format";
import { scanNow, useScan, type ScanRow } from "@/market/boxes/scanner";
import { useNowMv } from "@/motion/clock";
import { RadarSweep } from "@/motion/fx/RadarSweep";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { MARKT } from "./strings";
import { GradeMatrix, TfChip, price, rrText } from "./ui";

const S = MARKT.scanner;

function NextIn({ at }: { at: number }) {
  const now = useNowMv();
  const text = useTransform(now, (n) => (at - n > 0 ? hhmmss(at - n) : "gleich"));
  return <motion.span className="num font-mono">{text}</motion.span>;
}

/**
 * When the row's numbers were computed (review F6): the scanner grades at the close of the newest CLOSED candle, the
 * „Beste Setups“ card at the live price – the same setup can show another entry / CRV there; this says why.
 */
export function scanCloseLabel(r: Pick<ScanRow, "at" | "tf">, timeZone?: string): string {
  return `${S.atClose} ${ddmmHHmm(r.at + BOX_TF_MS[r.tf], timeZone)}`;
}

function Row({ r }: { r: ScanRow }) {
  const s = r.setup;
  const up = s.side === "long";
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-line bg-ink-950/30 px-3 py-2.5" data-testid="scan-row" data-symbol={r.symbol} data-grade={s.grade}>
      <GradeMatrix grade={s.grade} size={3} className="row-span-2" />
      <span className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="num font-mono text-[13px] font-semibold text-fg">{r.symbol}</span>
          <TfChip tf={r.tf} />
          <span className={cn("text-[11px] font-semibold", up ? "text-win" : "text-loss")}>{up ? "Long" : "Short"}</span>
        </span>
        <span className="line-clamp-2 text-[11.5px] leading-snug text-mute">{s.kind === "fakeout" ? PHASE_LABEL[r.phase] : `${KIND_TEXT[s.kind]} · ${PHASE_LABEL[r.phase]}`}</span>
      </span>
      {/* the entry is the figure of the row: a number line of its own (it was cut off at 390 px – P2-15), CRV below */}
      <span className="grid justify-items-end gap-0.5 text-[11px] text-faint">
        <span className="whitespace-nowrap">
          Einstieg <span className="num font-mono text-[12.5px] text-fg" data-testid="scan-entry">{price(s.entry)}</span>
        </span>
        <span className="whitespace-nowrap">
          CRV <span className="num font-mono text-[13px] text-fg">{rrText(s.rr)}</span>
        </span>
      </span>
      {/* when the values were computed: a line under text and figures, across both columns */}
      <span className="col-span-2 col-start-2 -mt-2 truncate text-[11px] text-faint" data-testid="scan-close">
        {scanCloseLabel(r)}
      </span>
    </div>
  );
}

export function ScannerCard() {
  const scan = useScan();
  const scanning = scan.state === "scanning";
  const off = scan.state === "off";
  const action = (
    <span className="flex items-center gap-2">
      <RadarSweep active={scanning} size={28} label={scanning ? S.scanning : undefined} />
      <Button size="sm" variant="ghost" disabled={scanning || off} onClick={() => void scanNow()} data-testid="scan-now">
        {S.scan}
      </Button>
    </span>
  );
  const note = (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span>{S.note}</span>
      {scan.lastScanAt ? (
        <span>
          {S.last} {hhmm(scan.lastScanAt)}
        </span>
      ) : null}
      {scan.viaProxy ? <span>{S.proxy}</span> : null}
    </span>
  );
  return (
    <Card title={S.title} note={note} action={action} className="h-full" data-testid="markt-scanner">
      <div className="grid gap-3" data-state={scan.state}>
        {scanning && (
          <div className="flex items-center gap-3 text-[12px] text-mute" data-testid="scan-progress">
            <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
              <motion.span className="absolute inset-0 origin-left rounded-full bg-fg" initial={false} animate={{ scaleX: scan.progress.total ? scan.progress.done / scan.progress.total : 0 }} />
            </span>
            <span className="num font-mono">
              {scan.progress.done}/{scan.progress.total}
            </span>
          </div>
        )}
        {scan.rows.length ? (
          <RevealGroup className="grid gap-2">
            {scan.rows.map((r) => (
              <RevealItem key={r.id}>
                <Row r={r} />
              </RevealItem>
            ))}
          </RevealGroup>
        ) : (
          <p className="text-[13px] text-mute" data-testid="scan-empty">
            {off ? scan.detail : scanning ? S.scanning : (scan.detail ?? S.empty)}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-[11px] text-faint">
          <span>{S.budget}</span>
          {scan.nextScanAt && !off ? (
            <span>
              {S.next} <NextIn at={scan.nextScanAt} />
            </span>
          ) : null}
        </div>
        {scan.failed.length > 0 && <p className="text-[11px] text-warn">{scan.failed.join(", ")}</p>}
      </div>
    </Card>
  );
}
