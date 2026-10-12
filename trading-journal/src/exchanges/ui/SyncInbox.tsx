import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { computePnlR } from "@/domain/derive";
import { EMOTIONS, type Setup, type Trade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { DissolveOut } from "@/motion/fx/DissolveOut";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { GAP_LABEL, gapsOf, readDismissed, syncInbox, writeDismissed, type InboxItem } from "../inbox";
import { INBOX } from "../strings";
import { Money } from "./parts";

/** Cards dealt at once ("trade the best": the biggest results); the rest are counted. */
export const INBOX_TOP = 6;

function Chip({ active, children, onClick, tone = "fg" }: { active?: boolean; children: string; onClick: () => void; tone?: "fg" | "win" }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      whileTap={{ scale: 0.94 }}
      transition={spring.press}
      className={cn(
        "touch-hit rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
        active ? (tone === "win" ? "border-win/45 bg-win/12 text-win" : "border-white/40 bg-white/[0.1] text-fg") : "border-line bg-ink-950/50 text-mute hover:border-line-2 hover:text-fg",
      )}
    >
      {children}
    </motion.button>
  );
}

function InboxCard({ item, setups, onDismiss }: { item: InboxItem; setups: readonly Setup[]; onDismiss: (id: string, persist: boolean) => void }) {
  const t = item.trade;
  const save = useJournal((s) => s.saveTrade);
  const [leaving, setLeaving] = useState<null | { persist: boolean; trade: Trade | null }>(null);
  const [stop, setStop] = useState("");
  const usable = setups.filter((s) => s.account === "both" || s.account === (t.account ?? "scalp")).slice(0, 4);

  const apply = (patch: Partial<Trade>) => {
    const next: Trade = { ...t, ...patch };
    const withDerived: Trade = { ...next, ...computePnlR(next), updatedAt: new Date().toISOString() };
    if (gapsOf(next).length === 0) setLeaving({ persist: false, trade: withDerived });
    else void save(withDerived);
  };
  const stopValue = Number(stop.replace(",", "."));

  return (
    <DissolveOut
      as="article"
      active={!!leaving}
      onDone={() => {
        if (leaving?.trade) void save(leaving.trade);
        onDismiss(t.id, leaving?.persist ?? false);
      }}
      className="grid h-full content-start gap-3 rounded-2xl border border-line bg-ink-950/55 p-3.5"
    >
      <div className="flex items-start justify-between gap-3" data-testid="inbox-card">
        <div className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("size-1.5 shrink-0 rounded-full", t.side === "long" ? "bg-win" : "bg-loss")} aria-hidden="true" />
            <span className="truncate text-[14px] font-semibold">{t.pair}</span>
            <span className="text-[11px] uppercase tracking-[0.08em] text-faint">{t.side}</span>
          </span>
          <span className="truncate text-[11.5px] text-faint">{(t.exitDate ?? t.date).replace("T", " · ")}</span>
        </div>
        <Money value={t.pnlManual ?? t.pnl} className="shrink-0 text-[16px] font-semibold" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
        {INBOX.missing}
        {item.missing.map((g) => (
          <Badge key={g} tone="warn" dot>
            {GAP_LABEL[g]}
          </Badge>
        ))}
      </div>

      {item.missing.includes("setup") && usable.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Setup wählen">
          {usable.map((s) => (
            <Chip key={s.id} active={t.setups.includes(s.id)} onClick={() => apply({ setups: [...t.setups, s.id] })}>
              {s.name}
            </Chip>
          ))}
        </div>
      )}

      {item.missing.includes("emotion") && (
        <div className="flex flex-wrap gap-1.5" aria-label="Gefühl beim Einstieg">
          {EMOTIONS.map((e) => (
            <Chip key={e} active={t.emotion === e} tone="win" onClick={() => apply({ emotion: e })}>
              {e}
            </Chip>
          ))}
        </div>
      )}

      {item.missing.includes("stop") && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number.isFinite(stopValue) && stopValue > 0) apply({ stop: stopValue });
          }}
        >
          <input
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            inputMode="decimal"
            placeholder={INBOX.stopPh}
            aria-label={`${INBOX.stopPh} für ${t.pair}`}
            className="min-w-0 flex-1 rounded-xl border border-line bg-ink-950/70 px-3 py-1.5 font-mono text-[13px] text-fg outline-none placeholder:text-faint focus:border-white/40"
          />
          <Button type="submit" size="sm" disabled={!(Number.isFinite(stopValue) && stopValue > 0)}>
            {INBOX.stopSave}
          </Button>
        </form>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={() => useUi.getState().openEditor({ tradeId: t.id })}>
          {INBOX.open}
        </Button>
        <Button size="sm" onClick={() => setLeaving({ persist: true, trade: null })} data-testid="inbox-done">
          {INBOX.done}
        </Button>
      </div>
    </DissolveOut>
  );
}

/**
 * "Zu prüfen" (P11): imported trades that still lack setup, stop or feeling – the biggest results dealt as cards
 * (CardSpread), each with one-tap chips for setup and feeling and a stop field; "Öffnen" opens the full editor,
 * "Passt so" dissolves the card (DissolveOut) and keeps it out of the inbox on this device. A card whose last gap is
 * filled dissolves too. Empty: one calm line.
 */
export function SyncInbox({ className }: { className?: string }) {
  const trades = useJournal((s) => s.trades);
  const setups = useJournal((s) => s.settings.setups);
  const reduced = useReducedFx();
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const items = useMemo(() => syncInbox(trades, dismissed).filter((i) => !hidden.has(i.trade.id)), [trades, dismissed, hidden]);
  const top = items.slice(0, INBOX_TOP);

  const onDismiss = (id: string, persist: boolean) => {
    if (persist) {
      const next = new Set(dismissed);
      next.add(id);
      writeDismissed(next);
      setDismissed(next);
    } else setHidden((h) => new Set(h).add(id));
  };

  return (
    <div className="h-full" data-testid="sync-inbox">
      <Card title={INBOX.title} className={cn("h-full", className)} action={items.length ? <Badge tone="warn">{items.length}</Badge> : null}>
        {items.length === 0 ? (
          <motion.div
            className="flex items-center gap-3 rounded-xl border border-line bg-ink-950/40 p-3 text-[13px] text-mute"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
            transition={{ y: spring.enter, opacity: tween.fade }}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full border border-win/40 bg-win/10 text-win" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5 10 17 19 7" />
              </svg>
            </span>
            {INBOX.empty}
          </motion.div>
        ) : (
          <div className="grid gap-3">
            <p className="text-[12.5px] text-mute">{INBOX.lead}</p>
            <CardSpread className="grid gap-3 sm:grid-cols-2" label={INBOX.title}>
              {top.map((it) => (
                <InboxCard key={it.trade.id} item={it} setups={setups} onDismiss={onDismiss} />
              ))}
            </CardSpread>
            {items.length > INBOX_TOP && <p className="text-[11.5px] text-faint">{INBOX.more(items.length - INBOX_TOP)}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
