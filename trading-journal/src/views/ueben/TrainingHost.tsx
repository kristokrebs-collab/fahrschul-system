/**
 * Training sheet (F38 "Lernmodus / Replay-Training"): choose a setup of the own journal, practise a handful of its
 * situations without the future (`CaseView`), see the history with its sample size. Lazy chunk – `DeferredHosts` mounts
 * it the first time `openTraining` ran, so nothing of it weighs on the first load. Records live in `settings.training`
 * (`@/domain/training`); nothing here changes a journal trade.
 */
import { useMemo, useState } from "react";
import { buildQueue, caseEligible, poolOf, practisedSetups, SESSION_SIZE, trainingRoundsOf, type QueueCase } from "@/domain/training";
import { checklistItemsFor } from "@/domain/enrich";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useProvider } from "@/market";
import { measurablePair } from "@/market/excursion";
import { DotMatrix } from "@/motion/DotMatrix";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Switch } from "@/motion/Switch";
import { Button, EmptyState } from "@/primitives";
import { useEnriched, useJournal } from "@/store/journalStore";
import { CaseView } from "./CaseView";
import { HistoryCard } from "./HistoryCard";
import { TRAIN } from "./strings";
import { closeTraining, useTraining } from "./trainingStore";

export default function TrainingHost() {
  const open = useTraining((s) => s.open);
  const seq = useTraining((s) => s.seq);
  return (
    <Sheet open={open} onClose={closeTraining} title={TRAIN.title} size="lg" dismissGuard={() => useTraining.getState().dirty}>
      {open ? <TrainingBody key={seq} /> : null}
    </Sheet>
  );
}

interface Session {
  setupId: string;
  blind: boolean;
  queue: QueueCase[];
  index: number;
  /** rounds stored in this session */
  roundIds: string[];
}

function TrainingBody() {
  const settings = useJournal((s) => s.settings);
  const enriched = useEnriched();
  const provider = useProvider();
  const rounds = useMemo(() => trainingRoundsOf(settings), [settings]);
  const [session, setSession] = useState<Session | null>(null);
  const [finished, setFinished] = useState<Session | null>(null);
  const first = useTraining.getState();

  // only situations on the live market's pair can be shown with candles
  const usable = useMemo(() => enriched.filter((t) => caseEligible(t) && measurablePair(t.pair, provider)), [enriched, provider]);
  const setups = useMemo(() => settings.setups.filter((s) => poolOf(usable, s.id).positive > 0), [settings.setups, usable]);
  const preselected = useMemo(() => {
    const byTrade = first.tradeId ? enriched.find((t) => t.id === first.tradeId) : undefined;
    const fromTrade = byTrade?.setups.find((id) => setups.some((s) => s.id === id));
    if (fromTrade) return fromTrade;
    if (first.setupId && setups.some((s) => s.id === first.setupId)) return first.setupId;
    const practised = practisedSetups(rounds).find((p) => setups.some((s) => s.id === p.setupId));
    return practised?.setupId ?? setups[0]?.id ?? null;
    // the choice is made once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [setupId, setSetupId] = useState<string | null>(preselected);
  const [blind, setBlind] = useState(true);

  const start = () => {
    if (!setupId) return;
    const queue = buildQueue({ trades: usable, setupId, rounds, seed: Date.now() % 2_147_483_647, size: SESSION_SIZE, firstTradeId: first.tradeId });
    if (!queue.length) return;
    setFinished(null);
    setSession({ setupId, blind, queue, index: 0, roundIds: [] });
  };

  if (session) {
    const setup = settings.setups.find((s) => s.id === session.setupId);
    const entry = session.queue[session.index];
    const trade = entry ? enriched.find((t) => t.id === entry.tradeId) : undefined;
    const advance = (roundId: string | null) => {
      const next: Session = { ...session, index: session.index + 1, roundIds: roundId ? [...session.roundIds, roundId] : session.roundIds };
      if (next.index >= next.queue.length) {
        setFinished(next);
        setSession(null);
      } else setSession(next);
    };
    if (!setup || !entry || !trade) {
      // a case that vanished (the trade was deleted meanwhile) is skipped
      return <SessionGone onNext={() => advance(null)} />;
    }
    return (
      <CaseView
        key={`${session.index}-${trade.id}`}
        trade={trade}
        positive={entry.positive}
        setup={setup}
        setups={settings.setups}
        items={checklistItemsFor([setup.id], settings)}
        blind={session.blind}
        index={session.index}
        total={session.queue.length}
        isLast={session.index === session.queue.length - 1}
        onDone={advance}
      />
    );
  }

  return (
    <Home
      setups={setups}
      usable={usable}
      allSetups={settings.setups}
      rounds={rounds}
      setupId={setupId}
      onSetup={setSetupId}
      blind={blind}
      onBlind={setBlind}
      onStart={start}
      lead={first.tradeId != null}
      symbol={provider?.symbol ?? null}
      finished={finished}
    />
  );
}

function SessionGone({ onNext }: { onNext: () => void }) {
  return (
    <StaggerItem className="grid min-h-[160px] place-items-center rounded-2xl border border-line bg-ink-950/50 p-6 text-center">
      <div className="grid justify-items-center gap-3">
        <DotMatrix text="--" tone="mute" size={4} gap={2} glow={false} />
        <p className="max-w-[44ch] text-[13px] text-mute">Dieser Fall ist nicht mehr im Journal.</p>
        <Button variant="ghost" size="sm" onClick={onNext}>
          {TRAIN.skip}
        </Button>
      </div>
    </StaggerItem>
  );
}

function Home({ setups, usable, allSetups, rounds, setupId, onSetup, blind, onBlind, onStart, lead, symbol, finished }: { setups: Setup[]; usable: EnrichedTrade[]; allSetups: readonly Setup[]; rounds: ReturnType<typeof trainingRoundsOf>; setupId: string | null; onSetup: (id: string) => void; blind: boolean; onBlind: (v: boolean) => void; onStart: () => void; lead: boolean; symbol: string | null; finished: Session | null }) {
  const chosen = setups.find((s) => s.id === setupId) ?? null;
  const done = finished ? rounds.filter((r) => finished.roundIds.includes(r.id)) : [];
  return (
    <div className="grid gap-4" data-testid="training-home">
      <StaggerItem className="grid gap-1.5">
        <p className="text-[13px] text-fg/90">{TRAIN.lead}</p>
        <p className="text-[12px] text-mute">{TRAIN.notRewarded}</p>
      </StaggerItem>

      {finished && (
        <StaggerItem className="grid gap-1 rounded-2xl border border-line-2 bg-ink-950/40 px-3.5 py-3 text-[12.5px]" data-testid="training-summary">
          <span className="label">{TRAIN.summaryTitle}</span>
          <p className="text-fg/90">{TRAIN.summaryLead(done.length)}</p>
          {done.length > 0 && (
            <p className="text-mute">
              Erkannt wie im Journal: {done.filter((r) => r.recognized === true).length} von {done.filter((r) => r.recognized !== null).length} · Regeln befolgt: {done.filter((r) => r.rules.followed === true).length} von {done.filter((r) => r.rules.followed !== null).length} · Reflexion: {done.filter((r) => !!r.reflection?.note.trim()).length} von {done.length}
            </p>
          )}
        </StaggerItem>
      )}

      {symbol == null ? (
        <StaggerItem>
          <EmptyState title={TRAIN.noSetups} text={TRAIN.noMarket} line={false} />
        </StaggerItem>
      ) : setups.length === 0 ? (
        <StaggerItem>
          <EmptyState title={TRAIN.noSetups} text={`${TRAIN.noSetupsText} ${TRAIN.marketOnly(symbol)}`} line={false} />
        </StaggerItem>
      ) : (
        <StaggerItem className="grid gap-3">
          <span className="label" id="training-setup-label">
            {TRAIN.chooseSetup}
          </span>
          <div role="radiogroup" aria-labelledby="training-setup-label" className="grid gap-2 sm:grid-cols-2">
            {setups.map((s) => {
              const pool = poolOf(usable, s.id);
              const on = s.id === setupId;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onSetup(s.id)}
                  data-testid={`training-setup-${s.id}`}
                  className={cn("grid gap-0.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors pointer-coarse:min-h-11", on ? "border-white/40 bg-white/[0.06]" : "border-line bg-ink-950/50 hover:border-white/25")}
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="text-[11.5px] text-faint">{TRAIN.setupCases(pool.positive, pool.other)}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11.5px] text-faint">{TRAIN.marketOnly(symbol)}</p>
          <div className="flex items-start gap-3">
            <Switch checked={blind} onCheckedChange={onBlind} aria-label={TRAIN.blindLabel} />
            <div className="grid gap-0.5">
              <span className="text-[13px] text-fg/90">{TRAIN.blindLabel}</span>
              <span className="text-[11.5px] text-faint">{TRAIN.blindNote}</span>
            </div>
          </div>
          {lead && <p className="text-[11.5px] text-faint">Die Übung beginnt mit der Situation des gewählten Trades.</p>}
          <div className="flex justify-end">
            <Button variant="primary" onClick={onStart} disabled={!chosen} data-testid="training-start" className="pointer-coarse:min-h-11">
              {TRAIN.start}
            </Button>
          </div>
        </StaggerItem>
      )}

      <StaggerItem>
        <HistoryCard rounds={rounds} setups={allSetups} setupId={setupId} />
      </StaggerItem>
    </div>
  );
}
