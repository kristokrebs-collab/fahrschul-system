/**
 * The Zustellprotokoll of the four alarms: every event with what became of each channel (queued, ringing, answered, sent, failed, skipped, dead)
 * and WHY – "Ruhezeit", "Besetzt", "Anruf-Grenze des Monats erreicht". A delivery that ran out of retries is the dead letter: shown in red with the
 * number of tries, never silent. Reads `/api/v1/alerts/feed`; the list refreshes once a minute while the page is visible and on the button.
 */
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/cloud/api";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { fetchFeed } from "./api";
import { deadLetters, protocolRows, type Feed } from "./model";

const POLL_MS = 60_000;
const FIRST = 8;

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; feed: Feed };

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

export function Protocol({ active, refreshKey }: { active: boolean; refreshKey: number }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const load = (): void => {
      fetchFeed(ctrl.signal).then(
        (feed) => !ctrl.signal.aborted && setState({ kind: "ok", feed }),
        (e: unknown) => !ctrl.signal.aborted && setState({ kind: "error", message: e instanceof ApiError ? e.message : "Der Server hat nicht geantwortet." }),
      );
    };
    load();
    const t = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) load();
    }, POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, [active, nonce, refreshKey]);

  const rows = useMemo(() => (state.kind === "ok" ? protocolRows(state.feed) : []), [state]);
  const dead = state.kind === "ok" ? deadLetters(state.feed) : 0;
  const shown = all ? rows : rows.slice(0, FIRST);

  return (
    <section aria-labelledby="alert-protocol-h" data-testid="alert-protocol" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="alert-protocol-h" className="label !text-fg">
          Zustellprotokoll
        </h3>
        <Button size="sm" variant="ghost" onClick={() => setNonce((n) => n + 1)}>
          Aktualisieren
        </Button>
      </div>
      {dead > 0 && (
        <p className="rounded-xl border border-(--color-danger)/40 bg-(--color-danger)/10 px-3 py-2 text-[12px] text-(--color-danger-text)" role="alert" data-testid="alert-dead-note">
          {dead === 1 ? "Eine Zustellung" : `${dead} Zustellungen`} ist nach allen Versuchen verworfen worden. Der Grund steht in der Zeile; es wird nicht noch einmal versucht.
        </p>
      )}
      {state.kind === "loading" && <p className="text-[12px] text-mute">Lädt …</p>}
      {state.kind === "error" && (
        <p className="text-[12px] text-warn" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "ok" && rows.length === 0 && <p className="text-[12px] text-mute">Noch nichts zugestellt. Sobald ein Alarm auslöst oder du einen Test machst, steht er hier – mit dem Grund, falls etwas nicht ankam.</p>}
      {shown.length > 0 && (
        <ol className="grid gap-2" data-testid="alert-protocol-list">
          {shown.map((r) => (
            <li key={r.id} data-testid="alert-protocol-row" className="grid gap-1.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 text-[13px] text-fg">{r.title}</span>
                <time className="text-[11px] text-faint" dateTime={r.at}>
                  {when(r.at)}
                </time>
              </div>
              <span className="text-[11px] text-faint">{r.sub}</span>
              {r.note && <span className="text-[12px] text-mute">{r.note}</span>}
              {r.deliveries.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {r.deliveries.map((d) => (
                    <li key={d.id} data-status={d.status}>
                      <Badge tone={d.tone === "steel" ? "steel" : d.tone} title={d.text}>
                        {d.text}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {!all && rows.length > FIRST && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Alle {rows.length} zeigen
          </Button>
        </div>
      )}
    </section>
  );
}
