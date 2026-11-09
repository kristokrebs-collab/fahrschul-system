import { Badge, type BadgeTone } from "@/primitives/Badge";
import { TV } from "./strings";
import type { TvSignal } from "./tvStore";

const TONE: Record<TvSignal["status"], BadgeTone> = { processed: "win", duplicate: "mute", rejected: "loss" };

const clock = (iso: string): string => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const day = (iso: string | null): string | null => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : null);

/** What the signal says, in the trader's words: "Testsignal", "Long · XLE · grün". Plain text only – every field was cleaned on the server. */
export function signalTitle(s: TvSignal): string {
  if (s.kind === "test") return `${TV.signalKind.test}${s.symbol ? ` · ${s.symbol}` : ""}`;
  const dir = s.direction ? TV.signalKind[s.direction] : TV.signalKind.other;
  const state = s.data?.zustand ? ` · ${TV.stateWord[s.data.zustand]}` : "";
  return `${dir}${s.symbol ? ` · ${s.symbol}` : ""}${state}`;
}

function Row({ s }: { s: TvSignal }) {
  const detail =
    s.status === "rejected"
      ? (s.reason ?? "abgelehnt")
      : s.status === "duplicate"
        ? (s.reason ?? "Dieses Signal ist schon angekommen.")
        : [s.kind === "test" ? TV.via[s.via] : null, s.schemaId ? TV.schemaWord[s.schemaId] : null, s.strategy, day(s.time) ? `${TV.timeLabel} ${day(s.time)}` : null].filter(Boolean).join(" · ");
  return (
    <li className="cx-panel grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]" data-testid="tv-signal" data-status={s.status} data-kind={s.kind} data-via={s.via}>
      <span className="min-w-0 truncate font-medium text-fg">{signalTitle(s)}</span>
      <Badge tone={TONE[s.status]} className="justify-self-end">
        {TV.statusWord[s.status]}
      </Badge>
      <span className={s.status === "rejected" ? "min-w-0 text-[11.5px] leading-snug text-loss" : "min-w-0 text-[11.5px] leading-snug text-mute"} data-testid="tv-signal-detail">
        {detail}
      </span>
      <span className="num text-[11.5px] text-mute">{clock(s.receivedAt)}</span>
    </li>
  );
}

/**
 * The last deliveries to the address with their fate (verarbeitet / doppelt / abgelehnt with the reason). `limit` shortens the list for the
 * compact view. Live: the wizard polls (`pollBackoff.ts`) and this list is `aria-live="polite"`.
 */
export function TvSignals({ list, limit = 10, live = false }: { list: readonly TvSignal[]; limit?: number; live?: boolean }) {
  return (
    <div className="grid gap-2" data-testid="tv-signals" aria-live={live ? "polite" : undefined}>
      <span className="label">{TV.signalsTitle}</span>
      {list.length === 0 ? (
        <p className="text-[12.5px] text-mute" data-testid="tv-signals-empty">
          {TV.signalsEmpty}
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {list.slice(0, limit).map((s) => (
            <Row key={s.id} s={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
