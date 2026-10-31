/**
 * Protokoll der Signalwechsel (Demo / Papier): every change of the Ampel is one line in a local protocol, in the format of the lab script's
 * `vault/protokoll.jsonl`. It lives on this device only, can be exported as `.jsonl` and read back, and every line says `gesendet: false`.
 * Nothing is sent to an exchange, a broker or anywhere else.
 *
 * The "Virtuelles Konto" (Labor › Forward-Test, F23) is NOT connected – it runs a frozen rule tree of the lab on Binance candles; the card
 * says so instead of pretending.
 */
import { useId, useRef, useState, type ChangeEvent } from "react";
import { fmtDay, industryName, toJsonl } from "@/domain/industryTrend";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { download } from "@/store/download";
import { useUi } from "@/store/uiStore";
import { readFileText } from "@/views/labor/readFile";
import { CardNote, CheckChip } from "../ui";
import { useBranchen } from "./store";
import { BRANCHEN } from "./strings";

const P = BRANCHEN.protokoll;
const SHOWN = 8;

export function ProtokollCard() {
  const protocol = useBranchen((s) => s.protocol);
  const autoLog = useBranchen((s) => s.prefs.autoLog);
  const lastAdded = useBranchen((s) => s.lastAdded);
  const setPrefs = useBranchen((s) => s.setPrefs);
  const importProtocol = useBranchen((s) => s.importProtocol);
  const clearProtocol = useBranchen((s) => s.clearProtocol);
  const pushToast = useUi((s) => s.pushToast);
  const input = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileId = useId();
  const newest = protocol.slice(-SHOWN).reverse();

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setNote(P.importFail);
      return;
    }
    try {
      const r = importProtocol(await readFileText(f));
      setNote(P.imported(r.added, r.skipped));
    } catch {
      setNote(P.importFail);
    }
  };

  const exportFile = async (): Promise<void> => {
    const ok = await download("protokoll.jsonl", toJsonl(protocol), "application/x-ndjson;charset=utf-8");
    if (ok) pushToast({ kind: "success", title: P.exported });
  };

  return (
    <Card title={P.title} className="h-full" data-testid="branchen-protokoll">
      <div className="grid min-w-0 gap-4">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-mute">{P.lead}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <CheckChip checked={autoLog} onChange={(autoLog) => setPrefs({ autoLog })} testId="branchen-autolog">
            {P.auto}
          </CheckChip>
          <span className="num text-[12.5px] text-mute" data-testid="branchen-log-count">
            {P.count(protocol.length)}
          </span>
          {lastAdded > 0 && (
            <span className="text-[12px] text-faint" role="status" data-testid="branchen-log-added">
              +{lastAdded} neu
            </span>
          )}
        </div>
        <p className="text-[12px] leading-relaxed text-faint">{P.first}</p>

        <section aria-labelledby="branchen-log-h" className="grid gap-2">
          <h3 id="branchen-log-h" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {P.last}
          </h3>
          {newest.length ? (
            <ul className="grid gap-1.5" data-testid="branchen-log-list">
              {newest.map((e) => (
                <li key={`${e.datum}${e.branche}${e.signal}${e.strategie}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12.5px]" data-testid="branchen-log-row" data-signal={e.signal}>
                  <span className="num font-mono text-fg">{fmtDay(e.datum)}</span>
                  <span className="min-w-0 flex-1 basis-40 truncate text-fg">
                    {industryName(e.branche)} <span className="num text-faint">{e.branche}</span>
                  </span>
                  <Badge tone={e.signal === "KAUF" ? "win" : "loss"} dot>
                    {e.signal === "KAUF" ? "Kauf" : "Verkauf"}
                  </Badge>
                  <span className="num text-[11px] text-faint">
                    {P.modus} · {P.sentNot}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-mute" data-testid="branchen-log-empty">
              {autoLog ? P.empty : P.emptyOff}
            </p>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-4">
          <input id={fileId} ref={input} type="file" accept=".jsonl,.json,.txt,application/x-ndjson,text/plain" className="sr-only" tabIndex={-1} aria-label={P.importBtn} onChange={(e) => void onFile(e)} data-testid="branchen-log-file" />
          <Button variant="ghost" size="sm" onClick={() => void exportFile()} disabled={!protocol.length} data-testid="branchen-log-export">
            {P.exportBtn}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => input.current?.click()} data-testid="branchen-log-import">
            {P.importBtn}
          </Button>
          {confirm ? (
            <span className="inline-flex items-center gap-2" role="group" aria-label={P.clearConfirm}>
              <span className="text-[12.5px] text-fg">{P.clearConfirm}</span>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  clearProtocol();
                  setConfirm(false);
                  setNote(null);
                }}
                data-testid="branchen-log-clear-yes"
              >
                {P.clearYes}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                {P.clearNo}
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} disabled={!protocol.length} className={cn(!protocol.length && "opacity-50")} data-testid="branchen-log-clear">
              {P.clear}
            </Button>
          )}
        </div>
        {note && (
          <p className="text-[12.5px] text-mute" role="status" data-testid="branchen-log-note">
            {note}
          </p>
        )}

        <section aria-labelledby="branchen-fwd-h" className="grid gap-1 rounded-xl border border-line bg-ink-950/30 px-3.5 py-3" data-testid="branchen-forward">
          <h3 id="branchen-fwd-h" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {P.forward.title}
          </h3>
          <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-mute">{P.forward.text}</p>
        </section>
        <CardNote lead={BRANCHEN.note} />
      </div>
    </Card>
  );
}
