import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { computePnlR } from "@/domain/derive";
import { EMOTIONS, type Setup, type Trade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { DissolveOut } from "@/motion/fx/DissolveOut";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { TextRoll } from "@/motion/TextRoll";
import { spring, tween } from "@/motion/tokens";
import { useIsDesktop } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { pushToast, useUi } from "@/store/uiStore";
import { GAP_LABEL, gapsOf, readDismissed, syncInbox, writeDismissed, type InboxGap, type InboxItem } from "../inbox";
import { INBOX } from "../strings";
import { Money, shortWhen } from "./parts";

/** Cards dealt at once ("trade the best": the biggest results); the rest are counted. Phones get the top three. */
export const INBOX_TOP = 6;
export const INBOX_TOP_PHONE = 3;

const QUESTION: Readonly<Record<InboxGap, string>> = { setup: "Welches Setup?", stop: "Wo lag dein Stop?", emotion: "Wie ging es dir beim Einstieg?" };
const ORDER: readonly InboxGap[] = ["setup", "stop", "emotion"];

const saveFailed = () => pushToast({ kind: "error", title: INBOX.saveFailed });

function Chip({ children, onClick, tone = "fg" }: { children: string; onClick: () => void; tone?: "fg" | "win" }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      transition={spring.press}
      className={cn(
        "touch-hit max-w-full truncate rounded-full border border-line bg-ink-950/50 px-2.5 py-1 text-[11.5px] text-mute transition-colors hover:text-fg",
        tone === "win" ? "hover:border-win/45" : "hover:border-white/35",
      )}
    >
      {children}
    </motion.button>
  );
}

/** Three small segments: which of setup / stop / feeling is done. */
function Steps({ missing }: { missing: readonly InboxGap[] }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Fehlt: ${missing.map((g) => GAP_LABEL[g]).join(", ")}`}>
      {ORDER.map((g) => (
        <span key={g} title={GAP_LABEL[g]} className={cn("h-1 w-5 rounded-full transition-colors", missing.includes(g) ? "bg-white/[0.12]" : "bg-win")} />
      ))}
    </span>
  );
}

function InboxCard({ item, setups, onDismiss }: { item: InboxItem; setups: readonly Setup[]; onDismiss: (id: string, persist: boolean) => void }) {
  const t = item.trade;
  const reduced = useReducedFx();
  const save = useJournal((s) => s.saveTrade);
  const [leaving, setLeaving] = useState<null | { persist: boolean; trade: Trade | null }>(null);
  const [stop, setStop] = useState("");
  const gap = ORDER.find((g) => item.missing.includes(g)) ?? "setup";
  const usable = setups.filter((s) => s.account === "both" || s.account === (t.account ?? "scalp")).slice(0, 3);
  const stopValue = Number(stop.replace(",", "."));

  const apply = (patch: Partial<Trade>) => {
    const next: Trade = { ...t, ...patch };
    const withDerived: Trade = { ...next, ...computePnlR(next), updatedAt: new Date().toISOString() };
    if (gapsOf(next).length === 0) setLeaving({ persist: false, trade: withDerived });
    else save(withDerived).catch(saveFailed);
  };

  return (
    <DissolveOut
      as="article"
      active={!!leaving}
      onDone={() => {
        if (leaving?.trade) save(leaving.trade).catch(saveFailed);
        onDismiss(t.id, leaving?.persist ?? false);
      }}
      className="grid h-full min-w-0 content-start gap-3 rounded-2xl border border-line bg-ink-950/55 p-3.5"
    >
      <div className="flex min-w-0 items-start justify-between gap-3" data-testid="inbox-card">
        <div className="grid min-w-0 gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("size-1.5 shrink-0 rounded-full", t.side === "long" ? "bg-win" : "bg-loss")} aria-hidden="true" />
            <span className="truncate text-[14px] font-semibold">{t.pair}</span>
            <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-faint">{t.side}</span>
          </span>
          <span className="flex items-center gap-2 text-[11.5px] text-faint">
            {shortWhen(t.exitDate ?? t.date)}
            <Steps missing={item.missing} />
          </span>
        </div>
        <Money value={t.pnlManual ?? t.pnl} className="shrink-0 text-[17px] font-semibold" />
      </div>

      <div className="grid min-w-0 gap-2">
        <span className="text-[12px] text-mute">
          <TextRoll text={QUESTION[gap]} />
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={gap}
            className="flex min-w-0 flex-wrap gap-1.5"
            initial={reduced ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
            exit={{ opacity: 0, x: -12, transition: tween.exit }}
            transition={{ x: spring.enter, opacity: tween.fade }}
          >
            {gap === "setup" &&
              (usable.length ? (
                usable.map((s) => (
                  <Chip key={s.id} onClick={() => apply({ setups: [s.id] })}>
                    {s.name}
                  </Chip>
                ))
              ) : (
                <span className="text-[11.5px] text-faint">Noch keine Setups – im Editor anlegen.</span>
              ))}
            {gap === "emotion" &&
              EMOTIONS.map((e) => (
                <Chip key={e} tone="win" onClick={() => apply({ emotion: e })}>
                  {e}
                </Chip>
              ))}
            {gap === "stop" && (
              <form
                className="flex w-full min-w-0 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (Number.isFinite(stopValue) && stopValue > 0) apply({ stop: stopValue });
                }}
              >
                <input
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  inputMode="decimal"
                  placeholder={t.entry ? `z. B. ${t.entry}` : INBOX.stopPh}
                  aria-label={`${INBOX.stopPh} für ${t.pair}`}
                  className="w-0 min-w-0 flex-1 rounded-xl border border-line bg-ink-950/70 px-3 py-1.5 font-mono text-[13px] text-fg outline-none placeholder:text-faint focus:border-white/40"
                />
                <Button type="submit" size="sm" disabled={!(Number.isFinite(stopValue) && stopValue > 0)} aria-label={INBOX.stopSave}>
                  ✓
                </Button>
              </form>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

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

/** Setups of the journal, most used first (the inbox offers the top 3 per account). */
function rankSetups(setups: readonly Setup[], trades: readonly Trade[]): Setup[] {
  const uses = new Map<string, number>();
  for (const t of trades) for (const id of t.setups ?? []) uses.set(id, (uses.get(id) ?? 0) + 1);
  return [...setups].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0));
}

/**
 * "Zu prüfen" (P11): imported trades that still lack setup, stop or feeling – the biggest results dealt as cards
 * (CardSpread). Each card asks ONE question at a time (the label rolls, the answers slide in): the three most used
 * setups, the stop, the feeling – one tap saves; when the last gap is filled the card dissolves (DissolveOut).
 * "Öffnen" opens the full editor, "Passt so" dissolves the card and keeps it out of the inbox on this device.
 */
export function SyncInbox({ className, columns = 3 }: { className?: string; columns?: 2 | 3 }) {
  const trades = useJournal((s) => s.trades);
  const setups = useJournal((s) => s.settings.setups);
  const reduced = useReducedFx();
  const limit = useIsDesktop() ? INBOX_TOP : INBOX_TOP_PHONE;
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const items = useMemo(() => syncInbox(trades, dismissed).filter((i) => !hidden.has(i.trade.id)), [trades, dismissed, hidden]);
  const ranked = useMemo(() => rankSetups(setups, trades), [setups, trades]);
  const top = items.slice(0, limit);

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
      <Card title={INBOX.title} className={cn("h-full", className)} action={
          items.length ? (
            <span data-testid="inbox-count">
              <Badge tone="warn">{items.length}</Badge>
            </span>
          ) : null
        }>
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
            <CardSpread className={cn("grid gap-3 sm:grid-cols-2", columns === 3 && "xl:grid-cols-3")} itemClassName="min-w-0" label={INBOX.title}>
              {top.map((it) => (
                <InboxCard key={it.trade.id} item={it} setups={ranked} onDismiss={onDismiss} />
              ))}
            </CardSpread>
            {items.length > limit && <p className="text-[11.5px] text-faint">{INBOX.more(items.length - limit)}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
