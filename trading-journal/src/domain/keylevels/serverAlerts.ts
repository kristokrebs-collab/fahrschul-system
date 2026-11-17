/**
 * `settings.serverAlerts` – the E-Mail-Alarm bei geschlossener App (F21). Versioned passthrough key of the settings
 * (`{ v: 1, email, maxPerDay, … }`): it travels through backup and cloud sync like `settings.keyLevels`, unknown keys of
 * the root survive every write. Pure, alias-free (the Netlify function `alert-watch-cron` bundles it).
 *
 * Two writers, two sets of keys – so the three-way merge of the cloud sync (`src/store/merge3.ts`) never has to choose:
 *   - the BROWSER owns `email` (the switch) and `maxPerDay` (the daily mail limit);
 *   - the SERVER owns the rest: `mem` (stage memory, same shape as the browser's own), `outbox` (fired, not yet mailed),
 *     `recent` (cooldown), `mails` (sent today), `lastMailAt`, `fail` (a failed send), `notes` (what was folded into the
 *     next mail instead of being mailed alone), `problems` (levels the server could not watch).
 * The server writes only when one of its keys changes (a quiet run writes nothing), through `set_server_alerts`
 * (migration 0008: replaces ONLY `data.serverAlerts` of the settings row, guarded by the row's `rev`).
 *
 * What goes out as mail is decided here, in plain functions: a fire is queued in the outbox (`queueFires`: dedupe, the
 * cooldown of the alert settings), and `planMail` says whether the outbox is mailed NOW – one mail for everything that
 * waits, not one per fire: not outside the active hours (the fires wait, ≤ 24 h), not more than `maxPerDay` a day, not
 * closer than 10 minutes to the last mail, not while a failed send is in back-off.
 */
import { price as fmtPrice } from "../../lib/format";
import { dedupeKey, inActiveHoursAt, stageMessage } from "./alerts";
import { keyLevelsCfgOf } from "./config";
import { tfLabel } from "./timeframes";
import { ALERT_STAGES, isKeyTf, type ActiveHours, type AlertSettings, type AlertStage, type EventBasis, type KeyLevel, type KeyTf } from "./types";
import { parseWatchMems, type WatchFire, type WatchMems } from "./watch";

export const SERVER_ALERTS_VERSION = 1 as const;

/** Offered daily mail limits (the switch in the app). */
export const MAIL_DAY_OPTIONS = [3, 6, 12, 24] as const;
export const MAIL_PER_DAY_DEFAULT = 6;
/** Levels with alerts the server watches per account (the rest is named in `problems`). */
export const WATCH_LEVELS_MAX = 20;
/** Fires waiting for a mail: at most this many, at most this old. */
export const OUTBOX_CAP = 30;
export const OUTBOX_TTL_MS = 24 * 3_600_000;
/** Two mails of one account are at least this far apart (a burst becomes ONE mail). */
export const MAIL_MIN_GAP_MS = 10 * 60_000;
/** Fires listed one by one in a mail; the rest is counted. */
export const MAIL_ITEMS_MAX = 8;
export const RECENT_CAP = 40;
const RECENT_TTL_MS = 48 * 3_600_000;
export const PROBLEMS_CAP = 10;
/** Back-off after a failed send: 30 min, 2 h, then 6 h. */
export const SEND_BACKOFF_MS: readonly number[] = [30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");

/** One fire waiting for its mail – a snapshot taken when the stage fired (text, rule and price as they were). */
export interface OutboxItem {
  /** `levelId|cycle|stage` – the dedupe key; a fire is queued once */
  id: string;
  /** ms, when it fired */
  at: number;
  levelId: string;
  name: string;
  symbol: string;
  tf: KeyTf;
  stage: AlertStage;
  /** German rule line ("4H-Schluss über 85.900") */
  rule: string;
  /** the toast title / detail of the browser alert (`stageMessage`) */
  title: string;
  detail: string;
  basis: EventBasis;
  /** the level's price */
  price: number;
  /** last price at the time of the fire */
  last: number | null;
}

export interface RecentFire {
  levelId: string;
  stage: AlertStage;
  at: number;
}

/** A level the server does not watch: `symbol` Binance does not know it, `limit` it is over `WATCH_LEVELS_MAX`. */
export type ProblemCode = "symbol" | "limit";
export interface WatchProblem {
  id: string;
  code: ProblemCode;
}

export interface ServerAlertsCfg {
  v: typeof SERVER_ALERTS_VERSION;
  /** browser-owned: the switch "E-Mail-Alarm bei geschlossener App" */
  email: boolean;
  /** browser-owned: mails per day at most */
  maxPerDay: number;
  /** browser-owned: ms when the switch was turned on – levels made or edited from then on are watched from their creation */
  armedAt: number | null;
  /** server-owned from here on */
  mem: WatchMems;
  outbox: OutboxItem[];
  recent: RecentFire[];
  /** mails sent on `day` (`YYYY-MM-DD` in the account's time zone) */
  mails: { day: string; n: number };
  lastMailAt: number | null;
  /** the last send failed `n` times in a row (`code` of the failure, never an address) */
  fail: { at: number; n: number; code: string } | null;
  /** since the last mail: fires held back by the cooldown / dropped (too old, outbox full) */
  notes: { suppressed: number; dropped: number };
  problems: WatchProblem[];
}

export const EMPTY_SERVER_ALERTS: ServerAlertsCfg = Object.freeze({
  v: SERVER_ALERTS_VERSION,
  email: false,
  maxPerDay: MAIL_PER_DAY_DEFAULT,
  armedAt: null,
  mem: {},
  outbox: [],
  recent: [],
  mails: { day: "", n: 0 },
  lastMailAt: null,
  fail: null,
  notes: { suppressed: 0, dropped: 0 },
  problems: [],
}) as ServerAlertsCfg;

const isStage = (v: unknown): v is AlertStage => (ALERT_STAGES as readonly unknown[]).includes(v);

function itemOf(raw: unknown): OutboxItem | null {
  if (!isObj(raw)) return null;
  const at = num(raw.at);
  const price = num(raw.price);
  if (typeof raw.id !== "string" || !raw.id || at == null || price == null || !isStage(raw.stage) || !isKeyTf(raw.tf) || typeof raw.levelId !== "string") return null;
  return {
    id: raw.id.slice(0, 160),
    at,
    levelId: raw.levelId,
    name: str(raw.name, 60),
    symbol: str(raw.symbol, 24),
    tf: raw.tf,
    stage: raw.stage,
    rule: str(raw.rule, 200),
    title: str(raw.title, 200),
    detail: str(raw.detail, 300),
    basis: raw.basis === "intrabar" ? "intrabar" : "close",
    price,
    last: num(raw.last),
  };
}

/** `settings.serverAlerts` (anything) → a full config. Lenient: whatever cannot be read falls back to its default. */
export function serverAlertsOf(raw: unknown): ServerAlertsCfg {
  if (!isObj(raw)) return EMPTY_SERVER_ALERTS;
  const per = num(raw.maxPerDay);
  const mails = isObj(raw.mails) ? raw.mails : {};
  const fail = isObj(raw.fail) ? raw.fail : null;
  const notes = isObj(raw.notes) ? raw.notes : {};
  return {
    v: SERVER_ALERTS_VERSION,
    email: raw.email === true,
    maxPerDay: per != null ? Math.min(24, Math.max(1, Math.round(per))) : MAIL_PER_DAY_DEFAULT,
    armedAt: num(raw.armedAt),
    mem: parseWatchMems(raw.mem),
    outbox: (Array.isArray(raw.outbox) ? raw.outbox : []).map(itemOf).filter((x): x is OutboxItem => x != null).slice(0, OUTBOX_CAP),
    recent: (Array.isArray(raw.recent) ? raw.recent : [])
      .filter((r): r is Record<string, unknown> => isObj(r) && typeof r.levelId === "string" && isStage(r.stage) && num(r.at) != null)
      .map((r) => ({ levelId: r.levelId as string, stage: r.stage as AlertStage, at: r.at as number }))
      .slice(0, RECENT_CAP),
    mails: { day: str(mails.day, 10), n: Math.max(0, Math.round(num(mails.n) ?? 0)) },
    lastMailAt: num(raw.lastMailAt),
    fail: fail && num(fail.at) != null ? { at: fail.at as number, n: Math.max(1, Math.round(num(fail.n) ?? 1)), code: str(fail.code, 40) } : null,
    notes: { suppressed: Math.max(0, Math.round(num(notes.suppressed) ?? 0)), dropped: Math.max(0, Math.round(num(notes.dropped) ?? 0)) },
    problems: (Array.isArray(raw.problems) ? raw.problems : [])
      .filter((p): p is Record<string, unknown> => isObj(p) && typeof p.id === "string" && (p.code === "symbol" || p.code === "limit"))
      .map((p) => ({ id: p.id as string, code: p.code as ProblemCode }))
      .slice(0, PROBLEMS_CAP),
  };
}

/** `settings.serverAlerts` of a settings object. */
export const serverAlertsOfSettings = (s: { serverAlerts?: unknown } | null | undefined): ServerAlertsCfg => serverAlertsOf(s?.serverAlerts);

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

/**
 * `settings.serverAlerts` with `patch` applied – ONLY the patched keys are written, every other key of the root
 * (a newer version's, the other writer's) stays as it is. Returns the SAME object when nothing changes (the caller
 * skips the save).
 */
export function withServerAlerts(raw: unknown, patch: Partial<Omit<ServerAlertsCfg, "v">>): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const next: Record<string, unknown> = { ...prev, v: SERVER_ALERTS_VERSION };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
  if (typeof next.maxPerDay === "number") next.maxPerDay = Math.min(24, Math.max(1, Math.round(next.maxPerDay)));
  return isObj(raw) && canon(prev) === canon(next) ? (raw as Record<string, unknown>) : next;
}

/**
 * What the switch writes when it is turned ON: the flag, the moment, and a clean slate for the server-owned state of the
 * last time (stage memory, outbox, cooldown, back-off, notes) – the first look after it is silent again. The day's mail
 * counter stays, so switching off and on does not reset the daily limit.
 */
export function armPatch(now: number): Partial<Omit<ServerAlertsCfg, "v">> {
  return { email: true, armedAt: now, mem: {}, outbox: [], recent: [], fail: null, notes: { suppressed: 0, dropped: 0 }, problems: [] };
}

/** A level made or edited from this long before the switch on counts from its creation: the server watches it live. */
export const ARM_MARGIN_MS = 10 * 60_000;

/** `StepOptions.live` of an account: levels that count from a time the e-mail alarm already covers. */
export const liveSince = (armedAt: number | null, now: number): ((l: KeyLevel) => boolean) => {
  const from = (armedAt ?? now) - ARM_MARGIN_MS;
  return (l) => l.since != null && l.since >= from;
};

// ------------------------------------------------------------------------------------------ what the server watches

/** An own level the server watches: switched on, alerts on, at least one stage wanted. */
export const isServerWatched = (l: KeyLevel): boolean => !l.legacy && l.enabled && l.alerts.on && (l.alerts.prepare || l.alerts.confirm || l.alerts.retest || l.alerts.invalid);

export interface ServerWatchSet {
  /** the levels to evaluate (≤ `WATCH_LEVELS_MAX`) */
  levels: KeyLevel[];
  /** global alert settings (`prepare` distance, `hours`, `cooldownMin`) */
  alerts: AlertSettings;
  /** watched levels beyond the cap */
  over: KeyLevel[];
}

/** The watch set of `settings.keyLevels`: only own levels with alerts on. */
export function serverWatchSet(keyLevelsRaw: unknown): ServerWatchSet {
  const cfg = keyLevelsCfgOf(keyLevelsRaw);
  const all = cfg.levels.filter(isServerWatched);
  return { levels: all.slice(0, WATCH_LEVELS_MAX), alerts: cfg.alerts, over: all.slice(WATCH_LEVELS_MAX) };
}

// ------------------------------------------------------------------------------------------ the outbox

/** The German rule line of a level ("4H-Schluss über 85.900"). */
export function ruleText(l: KeyLevel): string {
  const tf = tfLabel(l.tf);
  const over = l.direction === "above" ? "über" : "unter";
  const p = fmtPrice(l.price);
  switch (l.kind) {
    case "touch":
      return `Berührung von ${p}`;
    case "running":
      return `laufende ${tf}-Kerze ${over} ${p} (bestätigt erst mit dem Schluss)`;
    case "close":
      return `${tf}-Schluss ${over} ${p}`;
    case "closes":
      return `${l.closes} ${tf}-Schlüsse in Folge ${over} ${p}`;
    case "buffer":
      return `${tf}-Schluss ${over} ${p} plus Puffer (${fmtPrice(l.distance.value)} ${l.distance.mode === "pct" ? "%" : "× ATR"})`;
    default:
      return `${tf}-Schluss ${over} ${p}, danach Retest`;
  }
}

/** A fire as the outbox keeps it. */
export function outboxItemOf(f: WatchFire, now: number): OutboxItem {
  const msg = stageMessage(f.level, f.stage, f.evaluation);
  return {
    id: dedupeKey(f.level.id, f.cycle, f.stage),
    at: now,
    levelId: f.level.id,
    name: f.level.name,
    symbol: f.level.symbol,
    tf: f.level.tf,
    stage: f.stage,
    rule: ruleText(f.level),
    title: msg.title,
    detail: msg.detail,
    basis: msg.basis,
    price: f.level.price,
    last: f.evaluation.last,
  };
}

export interface QueueResult {
  outbox: OutboxItem[];
  recent: RecentFire[];
  notes: ServerAlertsCfg["notes"];
}

/**
 * Puts the fires of one look into the outbox. A fire of the same level and stage within the cooldown of the alert
 * settings is not queued (counted in `notes.suppressed` – the next mail says so); an id already waiting is skipped; an
 * outbox over `OUTBOX_CAP` loses its oldest entries (counted in `notes.dropped`).
 */
export function queueFires(cfg: Pick<ServerAlertsCfg, "outbox" | "recent" | "notes">, fires: readonly WatchFire[], now: number, cooldownMin: number): QueueResult {
  let outbox = [...cfg.outbox];
  const recent = cfg.recent.filter((r) => now - r.at < RECENT_TTL_MS);
  let suppressed = cfg.notes.suppressed;
  let dropped = cfg.notes.dropped;
  const cooldown = Math.max(0, cooldownMin) * 60_000;
  for (const f of fires) {
    const item = outboxItemOf(f, now);
    if (outbox.some((o) => o.id === item.id)) continue;
    if (cooldown > 0 && recent.some((r) => r.levelId === item.levelId && r.stage === item.stage && now - r.at < cooldown)) {
      suppressed += 1;
      continue;
    }
    outbox.push(item);
    recent.unshift({ levelId: item.levelId, stage: item.stage, at: now });
  }
  if (outbox.length > OUTBOX_CAP) {
    dropped += outbox.length - OUTBOX_CAP;
    outbox = outbox.slice(outbox.length - OUTBOX_CAP);
  }
  return { outbox, recent: recent.slice(0, RECENT_CAP), notes: { suppressed, dropped } };
}

/** The clock of the account's time zone at a moment (the server computes it with `Intl`). */
export interface LocalClock {
  /** minutes after local midnight */
  minutes: number;
  /** `YYYY-MM-DD` */
  day: string;
}

export type MailHold = "empty" | "hours" | "limit" | "gap" | "backoff";

export interface MailPlan {
  /** the outbox without what is older than 24 h */
  fresh: OutboxItem[];
  /** how many were older than 24 h (they are never mailed) */
  expired: number;
  /** what to mail now (all of `fresh`), or `null` */
  send: OutboxItem[] | null;
  hold: MailHold | null;
}

/** Back-off after `n` failed sends in a row. */
export const sendBackoffMs = (n: number): number => SEND_BACKOFF_MS[Math.min(Math.max(1, n), SEND_BACKOFF_MS.length) - 1]!;

/** Whether the outbox is mailed now. Order of the checks: age, back-off after a failure, active hours, daily limit, gap. */
export function planMail(cfg: Pick<ServerAlertsCfg, "outbox" | "mails" | "maxPerDay" | "lastMailAt" | "fail">, now: number, local: LocalClock, hours: ActiveHours): MailPlan {
  const fresh = cfg.outbox.filter((i) => now - i.at <= OUTBOX_TTL_MS);
  const expired = cfg.outbox.length - fresh.length;
  const hold = (h: MailHold): MailPlan => ({ fresh, expired, send: null, hold: h });
  if (!fresh.length) return hold("empty");
  if (cfg.fail && now < cfg.fail.at + sendBackoffMs(cfg.fail.n)) return hold("backoff");
  if (!inActiveHoursAt(hours, local.minutes)) return hold("hours");
  const today = cfg.mails.day === local.day ? cfg.mails.n : 0;
  if (today >= cfg.maxPerDay) return hold("limit");
  if (cfg.lastMailAt != null && now - cfg.lastMailAt < MAIL_MIN_GAP_MS) return hold("gap");
  return { fresh, expired, send: fresh, hold: null };
}

/** The server-owned keys after a mail: sent (the mailed items leave the outbox, the day counter counts) or failed (back-off). */
export function afterMail(cfg: Pick<ServerAlertsCfg, "outbox" | "mails" | "fail">, sent: readonly OutboxItem[], now: number, local: LocalClock, result: { ok: true } | { ok: false; code: string }): Partial<ServerAlertsCfg> {
  if (!result.ok) return { fail: { at: now, n: (cfg.fail?.n ?? 0) + 1, code: result.code } };
  const ids = new Set(sent.map((i) => i.id));
  return {
    outbox: cfg.outbox.filter((i) => !ids.has(i.id)),
    mails: { day: local.day, n: (cfg.mails.day === local.day ? cfg.mails.n : 0) + 1 },
    lastMailAt: now,
    fail: null,
    notes: { suppressed: 0, dropped: 0 },
  };
}

/** Whether two server-owned states are the same (a quiet run does not write). */
export function sameServerState(a: ServerAlertsCfg, b: ServerAlertsCfg): boolean {
  const pick = (c: ServerAlertsCfg) => ({ mem: c.mem, outbox: c.outbox, recent: c.recent, mails: c.mails, lastMailAt: c.lastMailAt, fail: c.fail, notes: c.notes, problems: c.problems });
  return canon(pick(a)) === canon(pick(b));
}
