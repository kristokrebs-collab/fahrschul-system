import { memo } from "react";
import { Card } from "@/primitives/Card";
import type { DraftKey, DraftTextKey, SettingsDraft } from "./draft";
import { DraftField } from "./fields";
import { ChangedDot } from "./fx";

export const LIMITS_STRINGS = {
  title: "Disziplin-Grenzen",
  note: "Für die Disziplin-Auswertung in der Übersicht. Standard: 2 % pro Trade, 4 % pro Tag, Makro 2 · Scalp 5 Trades.",
  trade: "Max. Verlust pro Trade %",
  tradeHelp: "vom Startkapital des Kontos",
  day: "Max. Verlust pro Tag %",
  dayHelp: "je Konto und Kalendertag",
  makro: "Max. Trades pro Tag · Makro",
  scalp: "Max. Trades pro Tag · Scalp",
} as const;

const S = LIMITS_STRINGS;
const KEYS: readonly DraftKey[] = ["dlTrade", "dlDay", "dlMakro", "dlScalp"];

export interface LimitsCardProps {
  draft: SettingsDraft;
  onChange: (key: DraftTextKey, value: string) => void;
  changed: ReadonlySet<DraftKey>;
  invalid: DraftTextKey | null;
  className?: string;
}

/**
 * NEW `Disziplin-Grenzen` card (`settings.discipline`, read by the overview's discipline evaluation): loss limits per
 * trade / day in % of the account capital and the max. trades per day and account. Written only when changed
 * (`draft.ts`), so the defaults stay implicit until the user sets their own.
 */
export const LimitsCard = memo(function LimitsCard({ draft, onChange, changed, invalid, className }: LimitsCardProps) {
  const field = (id: DraftTextKey, label: string, help?: string) => <DraftField id={id} label={label} help={help} draft={draft} onChange={onChange} changed={changed.has(id)} invalid={invalid === id} />;
  return (
    <Card
      title={
        <>
          {S.title}
          <ChangedDot show={KEYS.some((k) => changed.has(k))} />
        </>
      }
      note={S.note}
      className={className}
    >
      <div className="grid grid-cols-2 gap-3.5">
        {field("dlTrade", S.trade, S.tradeHelp)}
        {field("dlDay", S.day, S.dayHelp)}
        {field("dlMakro", S.makro)}
        {field("dlScalp", S.scalp)}
      </div>
    </Card>
  );
});
