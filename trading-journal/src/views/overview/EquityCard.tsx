import { EquityChart } from "@/chart/EquityChart";
import { MotionNumber } from "@/motion/MotionNumber";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

export const EQUITY_TITLE = "Kontostand";
export const EQUITY_EMPTY_TITLE = "Noch keine Kurve";
export const EQUITY_EMPTY_TEXT = "Deine Equity-Kurve startet beim Startkapital und bewegt sich mit jedem abgeschlossenen Trade.";

/**
 * `Kontostand` (Plan 6.1): note `{n} Trades · jetzt {balance} {cur}` (the balance rolls and flashes when a trade
 * changes it), Recharts `EquityChart` with draw-in and a live "jetzt" endpoint, empty state.
 */
export function EquityCard() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const cur = settings.currency;
  const n = view.closed.length;
  return (
    <Card
      title={EQUITY_TITLE}
      note={
        n ? (
          <>
            {n} Trades · jetzt <MotionNumber value={view.balance} decimals={0} suffix={` ${cur}`} tone="none" flash />
          </>
        ) : undefined
      }
    >
      {n ? <EquityChart points={view.equity} start={view.start} balance={view.balance} currency={cur} /> : <EmptyState title={EQUITY_EMPTY_TITLE} text={EQUITY_EMPTY_TEXT} />}
    </Card>
  );
}
