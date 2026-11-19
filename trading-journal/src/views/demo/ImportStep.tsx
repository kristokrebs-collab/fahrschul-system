/**
 * Step 1 – Import: the invented example CSV → the real parser's preview → the trades as the journal would hold them. Pure
 * reading: `previewDemoCsv` stores, sends and imports nothing (see `@/domain/demo/csv`).
 */
import { useMemo } from "react";
import { clockOf, DEMO_CSV, previewDemoCsv, summarizeDemoCsv } from "@/domain/demo/csv";
import { n2, pct0, price as fmtPrice, signed } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Collapse } from "@/primitives/Expander";
import { closeDemo } from "./demoStore";
import { DemoCard, Fig } from "./DemoCard";
import { patch, useSession } from "./session";
import { DEMO, IMPORT } from "./strings";

async function openRealImport(): Promise<void> {
  closeDemo();
  const { openFeature } = await import("@/app/featureOpen");
  openFeature("csv-import");
}

export function ImportStep() {
  const stage = useSession((s) => s.importStage);
  const rawOpen = useSession((s) => s.rawOpen);
  const preview = useMemo(() => previewDemoCsv(), []);
  const sum = useMemo(() => summarizeDemoCsv(preview.trades), [preview]);
  const rate = sum.winCI ? IMPORT.rateSub(pct0(sum.winCI.lo).replace(" %", ""), pct0(sum.winCI.hi)) : undefined;
  return (
    <DemoCard step="import" title={IMPORT.title} lead={IMPORT.lead}>
      <section className="grid gap-2" aria-label={IMPORT.rawTitle}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="label">{IMPORT.rawTitle}</h3>
          <Button size="sm" onClick={() => patch({ rawOpen: !rawOpen })} aria-expanded={rawOpen} aria-controls="demo-raw" data-testid="demo-raw-toggle">
            {rawOpen ? IMPORT.rawHide : IMPORT.rawToggle}
          </Button>
        </div>
        <Collapse open={rawOpen} id="demo-raw">
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-ink-950/50 p-3 font-mono text-[11px] leading-relaxed text-mute" data-testid="demo-csv-raw" tabIndex={0} aria-label={IMPORT.rawTitle}>
            {DEMO_CSV}
          </pre>
        </Collapse>
      </section>

      {stage === "file" && (
        <div>
          <Button variant="primary" onClick={() => patch({ importStage: "preview" })} data-testid="demo-import-preview">
            {IMPORT.preview}
          </Button>
        </div>
      )}

      {stage !== "file" && (
        <section className="grid gap-3" data-testid="demo-import-preview-body">
          <div className="flex flex-wrap items-center gap-2">
            {preview.format ? (
              <Badge tone="steel" dot className="whitespace-normal text-left">
                {IMPORT.recognised(preview.format.label, Math.round(preview.score * 100))}
              </Badge>
            ) : (
              <Badge tone="warn" className="whitespace-normal text-left">
                {IMPORT.notRecognised}
              </Badge>
            )}
            <span className="text-[12px] text-mute" data-testid="demo-import-rows">
              {IMPORT.rows(preview.rows, preview.skipped)}
            </span>
          </div>
          <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-mute">{IMPORT.previewHint}</p>
          <ul className="grid gap-2" data-testid="demo-import-list">
            {preview.trades.map((t) => (
              <li key={t.key} className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid="demo-import-row">
                <span className="num font-mono text-[12.5px] text-fg">{IMPORT.tradeRow(t.pair, t.side === "long" ? "Long" : "Short", fmtPrice(t.entry), fmtPrice(t.exit))}</span>
                <span className="num font-mono text-[11.5px] text-mute">
                  Menge {n2(t.qty)} · Netto {signed(t.pnl ?? null, 2)} · Gebühren {n2(Math.abs(t.fees ?? 0))} · {clockOf(t.openedAt)} → {clockOf(t.closedAt)} UTC
                </span>
              </li>
            ))}
          </ul>
          {stage === "preview" && (
            <div>
              <Button variant="primary" onClick={() => patch({ importStage: "trades" })} data-testid="demo-import-trades">
                {IMPORT.asTrades}
              </Button>
            </div>
          )}
        </section>
      )}

      {stage === "trades" && (
        <section className="grid gap-3" aria-label={IMPORT.tradesTitle} data-testid="demo-import-trades-body">
          <h3 className="label">{IMPORT.tradesTitle}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fig label={IMPORT.summary.n} value={sum.n} testId="demo-import-n" />
            <Fig label={IMPORT.summary.rate} value={sum.winRate == null ? "–" : pct0(sum.winRate)} sub={rate} />
            <Fig label={IMPORT.summary.net} value={signed(sum.net, 2)} tone={sum.net > 0 ? "win" : sum.net < 0 ? "loss" : undefined} />
            <Fig label={IMPORT.summary.fees} value={n2(sum.fees)} />
          </div>
          <ul className="grid gap-1.5">
            {preview.records.slice(0, 3).map((r) => (
              <li key={r.id} className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2">
                <span className="num break-all font-mono text-[11.5px] text-fg">{r.id}</span>
                <span className="text-[11.5px] text-mute">
                  {IMPORT.origin} · R: unbekannt (kein Stop)
                </span>
              </li>
            ))}
          </ul>
          <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-mute">{IMPORT.idNote}</p>
          {sum.withStop === 0 && <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-mute">{IMPORT.noStop}</p>}
          <p className="text-[12.5px] font-medium text-fg" data-testid="demo-nothing-saved">
            {DEMO.nothingSaved}
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="sm" onClick={() => void openRealImport()} data-testid="demo-real-import">
              {IMPORT.real}
            </Button>
            <span className="text-[11.5px] text-mute">{IMPORT.realHint}</span>
          </div>
        </section>
      )}
    </DemoCard>
  );
}
