/**
 * The industry function for the browser specs: `/api/v1/industry/daily` answered from `page.route` with a small, deterministic world of the
 * 48 real industry names (the packing is the server's own: Int32 days, then Int16 basis points industry after industry, gzip, base64).
 *
 *   industry i % 3 = 0  rises every day            → green (Kaufsignal) from the first full window on
 *   industry i % 3 = 1  falls every day            → red, was never in the market ("seit Beginn der Daten")
 *   industry i % 3 = 2  rises, then crashes 50 days before the end → red, left the market inside the last 60 days (a protocol line each)
 *
 * The numbers are not Ken French's – the specs check the page, not the market; the rule itself is checked against the lab script's own output in
 * `tests/unit/industryTrend.signal.test.ts`.
 */
import { gzipSync } from "node:zlib";
import type { Page, Route } from "@playwright/test";

export const NAMES = [
  "Agric", "Food", "Soda", "Beer", "Smoke", "Toys", "Fun", "Books", "Hshld", "Clths", "Hlth", "MedEq", "Drugs", "Chems", "Rubbr", "Txtls", "BldMt", "Cnstr", "Steel", "FabPr", "Mach", "ElcEq", "Autos", "Aero", "Ships", "Guns", "Gold", "Mines", "Coal", "Oil", "Util", "Telcm", "PerSv", "BusSv", "Comps", "Chips", "LabEq", "Paper", "Boxes", "Trans", "Whlsl", "Rtail", "Meals", "Banks", "Insur", "RlEst", "Fin", "Other",
] as const;
export const DAYS = 5200;
const CRASH = DAYS - 50;
export const GREEN = NAMES.filter((_, i) => i % 3 === 0);
export const EXITED = NAMES.filter((_, i) => i % 3 === 2);

const dayOf = (k: number): number => {
  const y = 1990 + Math.floor(k / 360);
  const m = 1 + Math.floor((k % 360) / 30);
  const d = 1 + (k % 30);
  return y * 10_000 + m * 100 + d;
};
export const LAST_DAY = dayOf(DAYS - 1);

function bp(i: number, k: number): number {
  if (i % 3 === 1) return -30;
  if (i % 3 === 2 && k >= CRASH) return -80;
  return k % 2 ? 40 : 60;
}

function payload(now: number) {
  const buf = Buffer.alloc(DAYS * 4 + NAMES.length * DAYS * 2);
  for (let k = 0; k < DAYS; k++) buf.writeInt32LE(dayOf(k), k * 4);
  for (let i = 0; i < NAMES.length; i++) for (let k = 0; k < DAYS; k++) buf.writeInt16LE(bp(i, k), DAYS * 4 + (i * DAYS + k) * 2);
  return {
    source: "ken-french",
    fetchedAt: now,
    fileTime: now - 5 * 86_400_000,
    cached: false,
    database: "202609",
    names: [...NAMES],
    days: DAYS,
    firstDay: dayOf(0),
    lastDay: LAST_DAY,
    encoding: "int32le-dates+int16le-industry-major;gzip;base64",
    bytes: buf.length,
    data: gzipSync(buf).toString("base64"),
  };
}

export interface Industry {
  /** requests that reached the function */
  calls: number;
  /** answer with this failure instead (a library that is down) */
  fail: { status: number; code: string; message: string } | null;
  /** hold every answer back this long (ms) */
  delayMs: number;
}

export async function mockIndustry(page: Page): Promise<Industry> {
  const state: Industry = { calls: 0, fail: null, delayMs: 0 };
  const body = JSON.stringify(payload(Date.now()));
  await page.route(/\/api\/v1\/industry\/daily/, async (route: Route) => {
    state.calls++;
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.fail) return route.fulfill({ status: state.fail.status, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: { code: state.fail.code, message: state.fail.message } }) });
    return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body });
  });
  return state;
}
