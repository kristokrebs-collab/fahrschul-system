/**
 * Export of the shown report (P04): Markdown (notes, a mentor), CSV (Excel / Numbers – the app's CSV dialect), JSON
 * (machine readable, trades as ids) and PDF (the print view: `ReportPrint` + `print.css` + `window.print()`, always
 * light). The focus of the page limits the sections. PDF is a plan feature (`reportsPdf`): without it the button says
 * so and opens the upgrade sheet – never a dead button. An empty period has nothing to export and says that.
 */
import { SeeAlso } from "@/app/FeatureLinks";
import { useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { openUpgrade } from "@/billing/store";
import { reportFilename, reportToCsv, reportToJson, reportToMarkdown, type Report, type ReportFocus } from "@/domain/reports";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { download } from "@/store/download";
import { pushToast } from "@/store/uiStore";
import { ReportPrint } from "./ReportPrint";

type Fmt = "md" | "csv" | "json";
const MIME: Readonly<Record<Fmt, string>> = { md: "text/markdown;charset=utf-8", csv: "text/csv;charset=utf-8", json: "application/json" };
const LABEL: Readonly<Record<Fmt, string>> = { md: "Markdown", csv: "CSV", json: "JSON" };

export function ExportCard({ report, focus, className }: { report: Report; focus: ReportFocus; className?: string }) {
  const pdf = useEntitlement("reportsPdf");
  const [printing, setPrinting] = useState(false);
  const save = async (fmt: Fmt) => {
    const data = fmt === "md" ? reportToMarkdown(report, focus) : fmt === "csv" ? reportToCsv(report, focus) : reportToJson(report, focus);
    const name = reportFilename(report, fmt, focus);
    if (await download(name, data, MIME[fmt])) pushToast({ kind: "success", title: `${LABEL[fmt]} gespeichert`, detail: name });
  };
  const empty = report.empty;
  return (
    <Card title="Export" note={empty ? "Keine Trades in diesem Zeitraum – nichts zu exportieren." : "Wie auf dem Bildschirm, mit deinem Fokus."} className={className} data-testid="report-export">
      <div className="grid grid-cols-2 gap-2">
        {(["md", "csv", "json"] as const).map((f) => (
          <Button key={f} size="sm" onClick={() => void save(f)} disabled={empty} className="pointer-coarse:min-h-11" data-testid={`report-export-${f}`}>
            {LABEL[f]}
          </Button>
        ))}
        {pdf ? (
          <Button size="sm" variant="primary" onClick={() => setPrinting(true)} disabled={empty || printing} className="pointer-coarse:min-h-11" data-testid="report-export-pdf">
            PDF / Drucken
          </Button>
        ) : (
          <Button size="sm" onClick={() => openUpgrade("reportsPdf")} className="pointer-coarse:min-h-11" data-testid="report-export-pdf-locked" aria-label="PDF-Export – im Premium-Plan">
            PDF · Premium
          </Button>
        )}
      </div>
      {pdf && !empty && <p className="mt-2 text-[11px] leading-snug text-faint">PDF: im Druckdialog „Als PDF sichern“ wählen.</p>}
      {printing && <ReportPrint report={report} focus={focus} onDone={() => setPrinting(false)} />}
      <SeeAlso at="berichte.export" inCard className="mt-3" />
    </Card>
  );
}
