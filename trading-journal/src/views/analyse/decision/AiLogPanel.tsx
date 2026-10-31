/**
 * Das KI-Protokoll (F24) as a calm list: per helper how often it was asked, with which models, how many answers the app took over
 * and when it was asked last. Read from `settings.aiLog` (`@/domain/provenance`); nothing but helper, model, time and a yes / no
 * is stored, so nothing but that is shown. „Protokoll leeren“ is the trader's own click.
 */
import { useMemo, useState } from "react";
import { aiLogOfSettings, summarizeAiLog } from "@/domain/provenance";
import { dateTime as fmtDateTime } from "@/lib/format";
import { Button } from "@/primitives/Button";
import { useJournal } from "@/store/journalStore";
import { emptyAiLog } from "./actions";
import { DECISION_UI } from "./strings";

export function AiLogPanel() {
  const raw = useJournal((s) => s.settings.aiLog);
  const rows = useMemo(() => summarizeAiLog(aiLogOfSettings({ aiLog: raw }).entries), [raw]);
  const [status, setStatus] = useState("");
  const clear = async (): Promise<void> => setStatus((await emptyAiLog()) ? DECISION_UI.logCleared : DECISION_UI.logClearFailed);
  return (
    <div className="grid gap-3" data-testid="decision-ailog">
      <div className="grid gap-1">
        <h3 className="label !text-fg">{DECISION_UI.logTitle}</h3>
        <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-mute">{DECISION_UI.logLead}</p>
      </div>
      {rows.length === 0 ? (
        <p className="max-w-[68ch] text-[13px] leading-relaxed text-mute" data-testid="decision-ailog-empty">
          {DECISION_UI.logEmpty}
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.helper} className="grid gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="decision-ailog-row" data-helper={r.helper} data-calls={r.calls}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="min-w-0 text-[13px] font-semibold text-fg">{r.label}</h4>
                <span className="num font-mono text-[12px] text-mute">
                  {DECISION_UI.logCalls(r.calls)} · {DECISION_UI.logAdopted(r.adopted, r.adopted + r.notAdopted, r.open)}
                </span>
              </div>
              <p className="text-[12px] text-mute">
                {DECISION_UI.logModels}: {r.models.length ? r.models.map((m) => `${m.model}${m.version ? ` (Version ${m.version})` : ""} ×${m.n}`).join(", ") : DECISION_UI.logNoModel}
                {r.last != null ? ` · ${DECISION_UI.logLast} ${fmtDateTime(new Date(r.last))}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="max-w-[68ch] text-[12px] leading-relaxed text-mute">{DECISION_UI.logNote}</p>
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => void clear()} data-testid="decision-ailog-clear">
            {DECISION_UI.logClear}
          </Button>
          <span className="min-h-[18px] text-[12px] text-mute" role="status" aria-live="polite">
            {status}
          </span>
        </div>
      )}
    </div>
  );
}
