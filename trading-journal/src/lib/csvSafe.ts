/**
 * CSV formula injection (OWASP "CSV Injection"): a cell that STARTS with `=`, `+`, `-`, `@`, a tab or a carriage return is
 * run as a formula by Excel, Sheets and Numbers (`=HYPERLINK(…)`, `=cmd|…`). Free-text columns therefore get a leading
 * `'`, which spreadsheets show as plain text. Number columns must NOT go through this (a negative number starts with `-`).
 * Shared by every CSV writer of the app (`domain/csv.ts`, `domain/archive/export.ts`, `domain/plan/ticket.ts`).
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** `v` with a leading `'` when a spreadsheet would read it as a formula. */
export const neutralizeFormula = (v: string): string => (FORMULA_LEAD.test(v) ? `'${v}` : v);
