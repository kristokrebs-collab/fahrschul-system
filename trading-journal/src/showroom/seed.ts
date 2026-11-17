/**
 * Showroom storage: first-visit seeding of the device's journal, the persisted state of the mock backend (it lives in the page, a reload or the
 * "mail link" navigation would forget it) and the reset. Every key of the Showroom starts with `tj2-showroom` so a reset knows its own.
 */
import { buildDemoJournal, type DemoJournal } from "./mock/demoJournal";
import type { ShowroomPersisted } from "./mock/backend";

export const STATE_KEY = "tj2-showroom";
export const INIT_KEY = "tj2-showroom-init";
export const BOOT_KEY = "tj2-showroom-boot";
export const AFTER_KEY = "tj2-showroom-after";
export const PANEL_STORAGE_KEY = "tj2-showroom-panel";

export interface BootPlan {
  journal: "demo" | "empty";
  signedIn: boolean;
}

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* blocked storage: the demo then starts fresh on every load, harmless */
  }
};

/** The boot plan of the next first visit (a reset leaves one; the default is "demo journal, signed in as the demo account"). */
export function readBootPlan(): BootPlan {
  try {
    const p = JSON.parse(read(BOOT_KEY) ?? "null") as Partial<BootPlan> | null;
    if (p && (p.journal === "demo" || p.journal === "empty")) return { journal: p.journal, signedIn: p.signedIn === true };
  } catch {
    /* default */
  }
  return { journal: "demo", signedIn: true };
}

export const isFirstVisit = (): boolean => read(INIT_KEY) === null;

/** Every report period around "now" counts as announced (no full-screen "Bericht bereit" over the first view – same as the e2e seed). */
function announcedPeriods(now: number): string[] {
  const keys = new Set<string>();
  const p2 = (n: number) => String(n).padStart(2, "0");
  for (let back = 0; back <= 35; back++) {
    const d = new Date(now - back * 86_400_000);
    const y = d.getFullYear();
    keys.add(String(y));
    keys.add(`${y}-Q${Math.floor(d.getMonth() / 3) + 1}`);
    keys.add(`${y}-${p2(d.getMonth() + 1)}`);
    const t = new Date(Date.UTC(y, d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const wy = t.getUTCFullYear();
    keys.add(`${wy}-W${p2(Math.ceil(((+t - Date.UTC(wy, 0, 1)) / 864e5 + 1) / 7))}`);
  }
  return [...keys];
}

/** Writes the legacy `tj2-*` journal keys (the app migrates them at boot) and the quiet defaults – only when the device has no journal yet. */
export function seedDevice(journal: DemoJournal | null, now: number): void {
  const j = (v: unknown) => JSON.stringify(v);
  if (journal && read("tj2-settings") === null && read("tj2-trades") === null) {
    write("tj2-settings", j(journal.settings));
    write("tj2-trades", j(journal.trades));
    write("tj2-hyblock", j(journal.hyblock));
  }
  // nothing opens by itself over the first view: no tour, no review sheet, no check-in, no "report ready" wipe; every fold open
  const quiet: Record<string, unknown> = {
    "tj2-onboarding": { status: "done", at: "", v: 1 },
    "tj2-growth-review": { auto: false },
    "tj2-checkin-device": { prompt: false },
    "tj2-folds": ["*"],
    "tj2-report-ready": announcedPeriods(now),
  };
  for (const [k, v] of Object.entries(quiet)) if (read(k) === null) write(k, j(v));
}

export function loadPersisted(): ShowroomPersisted | null {
  try {
    const p = JSON.parse(read(STATE_KEY) ?? "null") as ShowroomPersisted | null;
    return p && p.v === 1 && p.sb && p.bill ? p : null;
  } catch {
    return null;
  }
}

export function savePersisted(p: ShowroomPersisted): void {
  write(STATE_KEY, JSON.stringify(p));
}

export function markInit(): void {
  write(INIT_KEY, "1");
}

/** The demo journal of THIS day (first visit only). */
export const demoJournalNow = (now: number): DemoJournal => buildDemoJournal(now);

/**
 * Back to a first visit: every `tj2*` key goes (the app's own data included), the next load seeds again according to `plan`, then the page reloads.
 * `after` = what the panel wants done once the page is back (`register` opens the sign-up sheet).
 */
export function resetShowroom(plan: BootPlan, after?: "register" | "signin"): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("tj2") && k !== PANEL_STORAGE_KEY) localStorage.removeItem(k);
    sessionStorage.clear();
    localStorage.setItem(BOOT_KEY, JSON.stringify(plan));
    if (after) localStorage.setItem(AFTER_KEY, after);
  } catch {
    /* blocked storage: the reload below still gives a fresh page */
  }
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  location.assign(u.toString());
}

/** One-shot "after the reload" request of the panel (read and cleared). */
export function takeAfter(): "register" | "signin" | null {
  const v = read(AFTER_KEY);
  if (v === null) return null;
  try {
    localStorage.removeItem(AFTER_KEY);
  } catch {
    /* ignore */
  }
  return v === "register" || v === "signin" ? v : null;
}
