/**
 * Wie frisch sind die Kerzen? Der Plan verlangt Frische (Skill trader-entry: nur geschlossene Kerzen, Yahoo "can lag"). Diese
 * Rechnung sagt in Fakten, wo der Datenstrom steht, solange die Sitzung läuft: wann die neueste geschlossene Kerze schloss, wann
 * die nächste hätte schließen müssen, und – wenn die Quelle es sagt – wann zuletzt gehandelt wurde. Sie schätzt keine
 * Verzögerung: die App kennt sie nicht, sie sieht nur den Abstand zwischen Uhr und Kerze.
 *
 * Rein: `now` und alle Zeiten kommen von außen.
 */
import { clockIn, MIN } from "./time";
import type { SessionDay } from "./sessions";

export interface FeedLag {
  /** the stream is behind the clock by more than a healthy feed would be */
  late: boolean;
  /** minutes since the newest closed candle ended, `null` = no closed candle yet */
  lagMin: number | null;
  /** one or two sentences in words */
  text: string;
}

export interface FeedLagInput {
  now: number;
  session: SessionDay;
  intervalMs: number;
  /** end of the newest closed candle of the session (ms), `null` = none */
  lastCloseMs: number | null;
  /** the time of the last trade the source reports (ms), `null` = it does not say */
  marketTime: number | null;
}

/** A candle that should have closed this long ago and is still missing makes the feed "late". */
export const FEED_GRACE_MS = 2 * MIN;
/** A last trade older than this is said out loud (it is also the age at which the risk check stops using a price). */
export const QUIET_TRADE_MS = 15 * MIN;

const minutes = (ms: number): string => {
  const m = Math.max(0, Math.floor(ms / MIN));
  return m === 1 ? "1 Minute" : `${m} Minuten`;
};

/** `null` outside a running session (a look back has no lag to speak of). */
export function feedLag(i: FeedLagInput): FeedLag | null {
  const { now, session, intervalMs } = i;
  if (!session.tradingDay || now < session.openMs || now >= session.closeMs) return null;
  const T = (ms: number): string => `${clockIn(ms, session.tz)} Uhr`;
  // the end of the newest candle that should be closed by now
  const expectedEnd = session.openMs + Math.floor((now - session.openMs) / intervalMs) * intervalMs;
  const parts: string[] = [];
  let late = false;
  let lagMin: number | null = null;
  if (i.lastCloseMs == null) {
    if (expectedEnd > session.openMs && now - expectedEnd > FEED_GRACE_MS) {
      late = true;
      parts.push(`Seit dem Beginn der Sitzung (${T(session.openMs)}) ist noch keine geschlossene Kerze angekommen – die Daten hängen hinterher.`);
    } else {
      parts.push("Noch keine Kerze der Sitzung ist geschlossen.");
    }
  } else {
    lagMin = Math.floor((now - i.lastCloseMs) / MIN);
    if (i.lastCloseMs < expectedEnd && now - expectedEnd > FEED_GRACE_MS) {
      late = true;
      parts.push(`Die neueste geschlossene Kerze schloss um ${T(i.lastCloseMs)} (vor ${minutes(now - i.lastCloseMs)}); nach der Uhr wäre die von ${T(expectedEnd)} fällig – die Daten hängen hinterher.`);
    } else {
      parts.push(`Die neueste geschlossene Kerze schloss um ${T(i.lastCloseMs)} (vor ${minutes(now - i.lastCloseMs)}).`);
    }
  }
  if (i.marketTime != null && now - i.marketTime > QUIET_TRADE_MS) {
    late = true;
    parts.push(`Der letzte Handel laut Quelle liegt ${minutes(now - i.marketTime)} zurück (${T(i.marketTime)}): entweder wird kaum gehandelt oder die Daten sind verzögert – die App kann das nicht unterscheiden.`);
  }
  return { late, lagMin, text: parts.join(" ") };
}
