/**
 * Source "Schlüsselmarken": the user's own key levels (`src/domain/keylevels`), read as green (a level the market should get ABOVE)
 * or red (a level it should get UNDER). Pure: the evaluation of a level is the existing one (`evaluateLevel` / `observe`); this
 * only translates it.
 *
 *   confirmed            → held (the level's side), counts as confirmed at once
 *   running break        → warning (distance 0): the forming candle is beyond the line, the close decides
 *   waiting, within the prepare distance (`observe`) → warning (distance 0)
 *   anything else        → no state (`none`); an unknown level (no candles) gives no reading at all
 *
 * A separate way next to the e-mail summary of the Markt page: switch on one of the two, not both.
 */
import { observe } from "../../keylevels/alerts";
import { ruleText } from "../../keylevels/serverAlerts";
import type { AlertSettings, KeyLevel, LevelEvaluation } from "../../keylevels/types";
import type { AlertReading } from "../types";

const plain = (s: string): string => s.replace(/[\r\n\t<>&]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

export function keyLevelReading(level: KeyLevel, ev: LevelEvaluation, settings: Pick<AlertSettings, "prepare">, asOf: number): AlertReading | null {
  if (ev.status === "unknown") return null;
  const side = level.direction === "above" ? "green" : "red";
  const obs = observe(level, ev, settings);
  const confirmed = ev.status === "confirmed";
  const approaching = ev.status === "provisional" || obs.within;
  return {
    key: `keylevel:${level.id}`,
    source: "keylevel",
    market: plain(level.name) || level.symbol,
    held: confirmed ? side : null,
    margin: Infinity,
    approach: !confirmed && approaching ? { side, distance: 0 } : null,
    asOf,
    detail: `${level.symbol}: ${ruleText(level)}`,
  };
}
