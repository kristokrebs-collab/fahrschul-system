# `src/market/industry` – Ken French's 48 industries (Branchen-Trend)

Data side of Aktien › Branchen-Trend (`src/views/aktien/branchen`). Same rules as `src/market/stocks` and `src/market/congress`: every value carries its source and
stand, a failure is a typed result (`ok | stale | unavailable(reason)`), nothing leaves the device (the request has no parameters).

The data: the value-weighted daily returns of the 48 industry portfolios of the Kenneth R. French Data Library (CRSP, from 1926-07-01), from
`48_Industry_Portfolios_daily_CSV.zip`. It is a research file, **updated about once a month and one to two months behind** – no real-time data.

| file | what |
|---|---|
| `wire.ts` | the answer contract of `GET /api/v1/industry/daily`: one gzip + base64 block of `days × Int32` dates then `48 × days × Int16` returns in basis points (`-32768` = no value); `industryPayloadOk`. PURE, alias-free (the function imports it by relative path). Real size: 26,338 days → 2.6 MB raw, 2.36 MB as base64 in the JSON (the platform limit for a response is 6 MB). |
| `decode.ts` | base64 → gunzip (`DecompressionStream`, injectable) → `IndustryDataset`; every length and the first / last day are checked, a block that does not add up is a `DecodeError`. |
| `result.ts` · `client.ts` | `ok | stale | unavailable` with German reasons (the stock ones plus `format`); `createIndustryData` / `industryData()`: cache first (memory + IndexedDB `industry:daily`, fresh 12 h, a copy up to 400 days old is still shown – labelled as a copy, with the reason), one request at a time, a failed refresh = the old copy as `stale`. |

Server side: `netlify/functions/industry-daily.mts` + `_lib/industry/load.ts` (download with an own User-Agent and an 8 s timeout, ZIP read without a dependency, only the value-weighted table, 6 h memory cache, an older copy up to 90 days on failure, typed errors). No secret anywhere.
