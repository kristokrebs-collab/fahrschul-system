import { MonthlyBars } from "@/chart/MonthlyBars";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

export const MONTHLY_TITLE = "P&L pro Monat";
export const MONTHLY_EMPTY_TITLE = "Noch keine Monate";
export const MONTHLY_EMPTY_TEXT = "Hier erscheint dein Netto-Ergebnis pro Monat, grün im Plus, rot im Minus.";

/** `P&L pro Monat` (Plan 6.1): last 12 months as `MonthlyBars`, empty state. */
export function MonthlyCard() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  return (
    <Card title={MONTHLY_TITLE}>
      {view.closed.length ? <MonthlyBars months={view.months} currency={settings.currency} /> : <EmptyState title={MONTHLY_EMPTY_TITLE} text={MONTHLY_EMPTY_TEXT} />}
    </Card>
  );
}
