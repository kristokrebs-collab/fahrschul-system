# `src/market/congress` – the House Clerk's STOCK Act reports (Kongress-Tracker)

Data side of the Congress tracker (`src/views/aktien/kongress`). Same rules as `src/market/stocks`: every value carries `source`, `asOf` (the index file's time) and `receivedAt` / `fetchedAt`, a failure is a typed result (`ok | stale | unavailable(reason)`), nothing but a year and document numbers ever leaves the device.

| file | what |
|---|---|
| `wire.ts` | the answer contract of `/api/v1/congress/index` and `/ptr` (`CongressFiling`, `CongressTrade`, `CongressReport`, …), the guards the client validates with, `LATE_AFTER_DAYS = 45`, the Senate link. PURE, alias-free (the functions import it by relative path). |
| `clerk.ts` | the two Clerk URLs and the index XML → PTR filings (`parseIndexXml`; a file in another shape is `ClerkFormatError`, not an empty year). PURE. |
| `ptr.ts` | the PTR table from the positioned text runs of a PDF → rows (`parsePtr`): columns from each page's header row, a row anchored by its date / type, page-break glue, owner / type / date / amount / option read strictly. A row that cannot be read cleanly is `{ ok: false, reason, raw }`; a report whose rows and `F S:` labels do not add up is `problem: "format"`. PURE. |
| `result.ts` · `client.ts` | `ok | stale | unavailable`, reasons with German sentences (the stock ones plus `format` and `no-index`); `createCongressData` / `congressData()`: cache first (IndexedDB, keys `congress:…`; index fresh 10 min / usable 14 days, a report fresh 30 days / usable 120 days, an unreadable one asked again after 12 h or when the reader improved), four reports per request through a small throttle, a failed refresh = the old copy as `stale` with the reason. |

The PDF text reader is server-only: `netlify/functions/_lib/congress/pdf.ts`. Fixtures: `tests/fixtures/congress` (real files, README there).
