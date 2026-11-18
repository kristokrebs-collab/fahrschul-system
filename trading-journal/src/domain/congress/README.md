# `src/domain/congress` – pure logic of the Congress tracker

No network, no clock (`today` is passed in), no storage – the card (`src/views/aktien/kongress`) feeds it.

| file | what |
|---|---|
| `delay.ts` | days from trade date to filing date (`delayInfo`); over 45 is late; a trade dated after its filing has no number and says why. |
| `format.ts` | the words and figures of a row in German: owner, side, asset type codes, dates, the amount RANGE as printed, the option line (only what the description states, else "nicht erkannt"). |
| `watch.ts` | one comparable ticker key (`BRK.B` = `BRK-B` = `BRK/B`) and the watchlist match. |
| `window.ts` | the window "gemeldet in den letzten 7 / 30 / 90 Tagen / dieses Jahr" on the FILING day, which index years it needs, member match (all words, no accents), which filings to read (newest first, capped). |
| `lines.ts` | filings + reports → one line per row (or one "nicht lesbar" line per unreadable report) with delay, watchlist mark, new mark; the filters (unreadable rows a content filter keeps out are COUNTED, never dropped silently); the summary counts. |
| `fresh.ts` | "neu seit deinem letzten Besuch": the document numbers the index listed at the last visit. |

Tests: `tests/unit/congress.domain.test.ts`.
