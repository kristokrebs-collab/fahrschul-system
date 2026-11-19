# Fixtures of the Congress tracker

Real public files of the House Clerk (`disclosures-clerk.house.gov`), fetched on **2026-10-26** through the agent proxy. They are
public disclosures under the STOCK Act; nothing here is personal data of the user. The reader (`netlify/functions/_lib/congress/pdf.ts`,
`src/market/congress/ptr.ts`) is built and tested against them, not against an invented layout.

| file | what | why it is here |
|---|---|---|
| `2026FD.zip` | the yearly index `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip` (1800 filings, 437 of them PTRs; ZIP stamped 2026-10-23 09:00 New York time, `Last-Modified` 13:00:28 GMT) | index parser, ZIP reader, function `congress-index` |
| `20035143.pdf` | PTR of Nancy Pelosi, filed 2026-08-21, 2 pages, 7 rows | the example of the `trader-pelosi` skill: shares, call options with strike and expiry, a private LLC without ticker, owner `SP` |
| `20035408.pdf` | PTR of April McClain Delaney, filed 2026-09-09, 8 pages, 78 rows | a row that runs over a page break, `S (partial)`, owner `DC`, long asset names |
| `20034694.pdf` | PTR of Laurel Lee, filed 2026-07-19 | option rows whose description names neither strike nor expiry ("Put Option") |
| `20034999.pdf` | PTR of Debbie Wasserman Schultz, filed 2026-07-14 | an amount that is one printed figure ("$2,722.50"), not a range |
| `20035024.pdf` | PTR of Daniel Crenshaw, filed 2026-07-16 | free-text option description ("10 puts at $11.80"), a row without ticker |

What is NOT here: a scanned paper filing (570 KB each). The function test builds a tiny PDF of the same structure (object stream,
page images, no font) instead; the real ones were checked by hand: `9116328` (and 12 more of 110 sampled 2026 reports, 6 of 38 sampled
2023/2025 reports) are scans and read as "Papierformular", all other sampled reports (97 + 32) read without a single unreadable row.

Refresh: `curl -A "…" <url> -o <file>`; a changed layout shows up first as `problem: "format"` in `congress.parse.test.ts`.
