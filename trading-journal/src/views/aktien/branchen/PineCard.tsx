/**
 * Pine-Skript für TradingView: an indicator (Pine v5) of the base rule for the chart of an industry ETF or index – green dots at entries, red at
 * exits, the channels and the stop, and two `alertcondition`s with a JSON message. The text is built by `buildPine` (pure, snapshot-tested).
 *
 * Said out loud, here and in the script: it was NOT compiled in TradingView. The app builds a text and offers it; nothing is sent, and there
 * is no receiver for TradingView alerts (a webhook needs a service of its own and the user's say-so – the card describes the route).
 */
import { useMemo, useRef, useState } from "react";
import { BASE_PARAMS, PAYLOAD_JSON_SCHEMA, buildPine } from "@/domain/industryTrend";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { download } from "@/store/download";
import { useUi } from "@/store/uiStore";
import { CardNote } from "../ui";
import { copyText } from "./clipboard";
import { BRANCHEN } from "./strings";

const P = BRANCHEN.pine;

export function PineCard() {
  const pushToast = useUi((s) => s.pushToast);
  const [shown, setShown] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const out = useMemo(() => buildPine({ ...BASE_PARAMS }), []);
  const schema = useMemo(() => JSON.stringify(PAYLOAD_JSON_SCHEMA, null, 2), []);

  return (
    <Card title={P.title} className="h-full" data-testid="branchen-pine">
      <div className="grid min-w-0 gap-4">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-mute">{P.lead}</p>
        <p className="rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[12.5px] leading-relaxed text-fg" role="note" data-testid="branchen-pine-honest">
          {P.honest}
        </p>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-4">
          <Button variant="ghost" size="sm" aria-expanded={shown} onClick={() => setShown((v) => !v)} data-testid="branchen-pine-toggle">
            {shown ? P.hide : P.generate}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copyText(out.code, area.current).then((ok) => pushToast(ok ? { kind: "success", title: P.copied } : { kind: "error", title: P.copyFail }))}
            data-testid="branchen-pine-copy"
          >
            {P.copy}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void download(out.fileName, out.code, "text/plain;charset=utf-8")} data-testid="branchen-pine-save">
            {P.save}
          </Button>
        </div>

        <Collapse open={shown}>
          <div className="grid gap-2">
            <label htmlFor="branchen-pine-code" className="label">
              {P.code}
            </label>
            <textarea
              id="branchen-pine-code"
              ref={area}
              readOnly
              spellCheck={false}
              value={out.code}
              rows={18}
              wrap="off"
              className="num w-full resize-y rounded-xl border border-line bg-ink-950/70 p-3 font-mono text-[12px] leading-relaxed text-fg outline-none focus:border-white/40"
              data-testid="branchen-pine-code"
            />
          </div>
        </Collapse>

        <section aria-labelledby="branchen-pine-notes-h" className="grid gap-1.5">
          <h3 id="branchen-pine-notes-h" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {P.notesTitle}
          </h3>
          <ul className="grid gap-1.5" data-testid="branchen-pine-notes">
            {out.notes.map((n) => (
              <li key={n} className="text-[12.5px] leading-relaxed text-mute">
                {n}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="branchen-payload-h" className="grid gap-2 rounded-xl border border-line bg-ink-950/30 p-3" data-testid="branchen-payload">
          <h3 id="branchen-payload-h" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {P.payloadTitle}
          </h3>
          <p className="text-[12.5px] leading-relaxed text-mute">{P.payloadLead}</p>
          <pre role="region" aria-label={P.payloadExampleLabel} tabIndex={0} className="num overflow-x-auto rounded-lg border border-line bg-ink-950/70 px-3 py-4 font-mono text-[11.5px] leading-relaxed text-fg" data-testid="branchen-payload-example">
            {out.payloadExample.kauf}
          </pre>
          <details className="group mt-3">
            <summary className="touch-hit cursor-pointer text-[12.5px] text-mute underline decoration-line-2 underline-offset-4 outline-none hover:text-fg focus-visible:text-fg">{P.schemaTitle}</summary>
            <pre role="region" aria-label={P.schemaTitle} tabIndex={0} className="num mt-2 overflow-x-auto rounded-lg border border-line bg-ink-950/70 p-3 font-mono text-[11.5px] leading-relaxed text-fg" data-testid="branchen-schema">
              {schema}
            </pre>
          </details>
        </section>

        <section aria-labelledby="branchen-webhook-h" className="grid gap-1.5" data-testid="branchen-webhook">
          <h3 id="branchen-webhook-h" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {P.webhookTitle}
          </h3>
          {P.webhook.map((t) => (
            <p key={t} className="max-w-[80ch] text-[12.5px] leading-relaxed text-mute">
              {t}
            </p>
          ))}
        </section>
        <CardNote lead={BRANCHEN.note} />
      </div>
    </Card>
  );
}
