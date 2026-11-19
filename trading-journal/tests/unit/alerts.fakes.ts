/**
 * Fakes of the four alarms' server side: an in-memory `AlertStore` that follows the rules of the SQL functions of 0014 (dedupe key, lease with a
 * fencing token, committed-before-dialed, forward-only call status – those rules are checked against a real Postgres by
 * `supabase/tests/0014_alerts.test.sql`) and a fake Twilio (Voice + Verify) that records every request. No network anywhere.
 */
import type { AlertChannel } from "@/domain/alerts/config";
import { mayAdvance, phoneBudget, type DeliveryStatus } from "@/domain/alerts/delivery";
import type { AlertEvent, AlertSourceKind } from "@/domain/alerts/types";
import type { AlertStore, Candidate, DeliveryPatch, DeliveryRecord, EventInput, JobRecord, PhoneSecret, ReserveResult } from "../../netlify/functions/_lib/alerts/store";

export const MIN = 60_000;
export const H = 3_600_000;

interface EventRow {
  id: string;
  userId: string;
  dedupKey: string;
  source: AlertSourceKind;
  market: string;
  marketKey: string;
  event: AlertEvent;
  detail: string;
  suppressed: "cooldown" | null;
  occurredAt: number;
}

interface DeliveryRow {
  id: string;
  userId: string;
  eventId: string | null;
  kind: "alarm" | "test";
  channel: AlertChannel;
  status: DeliveryStatus;
  reason: string | null;
  attempts: number;
  providerRef: string | null;
  dialedAt: number | null;
  notBefore: number | null;
  updatedAt: number;
}

interface JobRow {
  id: string;
  userId: string;
  key: string;
  deliveryId: string;
  status: "queued" | "leased" | "done" | "dead";
  attempts: number;
  maxAttempts: number;
  runAt: number;
  leaseUntil: number | null;
  token: string | null;
  lastCode: string | null;
}

export interface MemoryStore extends AlertStore {
  clock: { now: number };
  users: Map<string, { prefs: unknown; tz: string; keyLevels?: unknown }>;
  memory: Map<string, unknown>;
  events: EventRow[];
  deliveries: Map<string, DeliveryRow>;
  jobs: Map<string, JobRow>;
  secrets: Map<string, { numberEnc: string; verified: boolean }>;
  state: Record<string, unknown> | null;
  /** throws once when the named call happens (a crash at exactly that point) */
  crashAt: { op: string; times: number } | null;
  /** how often each store method was called */
  calls: Map<string, number>;
  deliveriesOf(userId: string, channel?: AlertChannel): DeliveryRow[];
}

export function memoryStore(startNow = Date.UTC(2026, 10, 2, 11, 0, 0)): MemoryStore {
  let seq = 0;
  const id = (p: string): string => `${p}-${++seq}`;
  const clock = { now: startNow };
  const s: MemoryStore = {
    clock,
    users: new Map(),
    memory: new Map(),
    events: [],
    deliveries: new Map(),
    jobs: new Map(),
    secrets: new Map(),
    state: null,
    crashAt: null,
    calls: new Map(),
    deliveriesOf: (userId, channel) => [...s.deliveries.values()].filter((d) => d.userId === userId && (!channel || d.channel === channel)),

    async candidates(limit) {
      const out: Candidate[] = [];
      for (const [userId, u] of s.users) {
        const src = ((u.prefs as { sources?: Record<string, { on?: boolean }> } | null)?.sources ?? {}) as Record<string, { on?: boolean }>;
        if (Object.values(src).some((x) => x?.on === true)) out.push({ userId, prefs: u.prefs, tz: u.tz });
      }
      return out.slice(0, limit);
    },
    async loadMemory(userId) {
      return s.memory.get(userId) ?? {};
    },
    async saveMemory(userId, memory) {
      hit("saveMemory");
      s.memory.set(userId, JSON.parse(JSON.stringify(memory)));
    },
    async userKeyLevels(userId) {
      return s.users.get(userId)?.keyLevels ?? null;
    },
    async enqueue(e: EventInput) {
      hit("enqueue");
      if (s.events.some((x) => x.userId === e.userId && x.dedupKey === e.dedupKey)) return null;
      const eventId = id("ev");
      s.events.push({ id: eventId, userId: e.userId, dedupKey: e.dedupKey, source: e.source, market: e.market, marketKey: e.marketKey, event: e.event, detail: e.detail, suppressed: e.suppressed, occurredAt: e.occurredAt });
      for (const d of e.deliveries) {
        const did = id("dl");
        s.deliveries.set(did, { id: did, userId: e.userId, eventId, kind: "alarm", channel: d.channel, status: d.status, reason: d.reason, attempts: 0, providerRef: null, dialedAt: null, notBefore: d.runAt, updatedAt: clock.now });
        if (d.status === "queued" && (d.channel === "email" || d.channel === "phone")) {
          const key = `${eventId}:${d.channel}`;
          if (![...s.jobs.values()].some((j) => j.key === key)) s.jobs.set(id("job"), { id: `job-${seq}`, userId: e.userId, key, deliveryId: did, status: "queued", attempts: 0, maxAttempts: 5, runAt: d.runAt, leaseUntil: null, token: null, lastCode: null });
        }
      }
      return eventId;
    },
    async enqueueTest(userId, channel, job) {
      const did = id("dl");
      s.deliveries.set(did, { id: did, userId, eventId: null, kind: "test", channel, status: "queued", reason: null, attempts: 0, providerRef: null, dialedAt: null, notBefore: null, updatedAt: clock.now });
      if (job) s.jobs.set(`job-t-${did}`, { id: `job-t-${did}`, userId, key: `test:${did}`, deliveryId: did, status: "queued", attempts: 0, maxAttempts: 5, runAt: clock.now, leaseUntil: null, token: null, lastCode: null });
      return did;
    },
    async claim(limit, leaseSec, userId) {
      const due = [...s.jobs.values()]
        .filter((j) => (!userId || j.userId === userId) && ((j.status === "queued" && j.runAt <= clock.now) || (j.status === "leased" && (j.leaseUntil ?? 0) < clock.now)))
        .sort((a, b) => a.runAt - b.runAt)
        .slice(0, limit);
      return due.map((j): JobRecord => {
        j.status = "leased";
        j.attempts += 1;
        j.leaseUntil = clock.now + leaseSec * 1000;
        j.token = `tok-${++seq}`;
        return { id: j.id, userId: j.userId, deliveryId: j.deliveryId, attempts: j.attempts, maxAttempts: j.maxAttempts, leaseToken: j.token };
      });
    },
    async complete(job, status, code) {
      hit("complete");
      const j = s.jobs.get(job.id);
      if (!j || j.token !== job.leaseToken || j.status !== "leased") return false;
      j.status = status;
      j.lastCode = code;
      j.leaseUntil = null;
      j.token = null;
      return true;
    },
    async retry(job, delaySec, code) {
      hit("retry");
      const j = s.jobs.get(job.id);
      if (!j || j.token !== job.leaseToken || j.status !== "leased") return false;
      j.status = "queued";
      j.runAt = clock.now + delaySec * 1000;
      j.lastCode = code;
      j.leaseUntil = null;
      j.token = null;
      return true;
    },
    async delivery(did) {
      const d = s.deliveries.get(did);
      if (!d) return null;
      const ev = d.eventId ? s.events.find((e) => e.id === d.eventId) : null;
      const rec: DeliveryRecord = {
        id: d.id,
        userId: d.userId,
        eventId: d.eventId,
        kind: d.kind,
        channel: d.channel,
        status: d.status,
        reason: d.reason,
        attempts: d.attempts,
        providerRef: d.providerRef,
        dialedAt: d.dialedAt === null ? null : new Date(d.dialedAt).toISOString(),
        event: ev ? { event: ev.event, market: ev.market, source: ev.source, detail: ev.detail, occurredAt: new Date(ev.occurredAt).toISOString() } : null,
      };
      return rec;
    },
    async patchDelivery(did, patch: DeliveryPatch) {
      hit("patchDelivery");
      const d = s.deliveries.get(did);
      if (!d) return;
      if (patch.status !== undefined) d.status = patch.status;
      if (patch.reason !== undefined) d.reason = patch.reason;
      if (patch.providerRef !== undefined) d.providerRef = patch.providerRef;
      if (patch.attempts !== undefined) d.attempts = patch.attempts;
      if (patch.dialedAt === null) d.dialedAt = null;
      d.updatedAt = clock.now;
    },
    async phoneReserve(did, userId, monthLimit, userDayMax, globalDayMax): Promise<ReserveResult> {
      hit("phoneReserve");
      const d = s.deliveries.get(did);
      if (!d || d.userId !== userId || d.channel !== "phone") return "already";
      if (d.dialedAt !== null || (d.status !== "queued" && d.status !== "sending")) return "already";
      const sec = s.secrets.get(userId);
      if (!sec?.verified) {
        d.status = "skipped";
        d.reason = "phone_opted_out";
        return "phone_opted_out";
      }
      const t = new Date(clock.now);
      const monthStart = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
      const dayStart = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
      const dialed = [...s.deliveries.values()].filter((x) => x.channel === "phone" && x.dialedAt !== null);
      const verdict = phoneBudget({
        monthLimit,
        monthUsed: dialed.filter((x) => x.userId === userId && x.dialedAt! >= monthStart).length,
        userDayMax,
        userDayUsed: dialed.filter((x) => x.userId === userId && x.dialedAt! >= dayStart).length,
        globalDayMax,
        globalDayUsed: dialed.filter((x) => x.dialedAt! >= dayStart).length,
      });
      if (!verdict.ok) {
        d.status = "skipped";
        d.reason = verdict.reason;
        return verdict.reason;
      }
      d.status = "sending";
      d.dialedAt = clock.now;
      d.attempts += 1;
      d.reason = null;
      return "ok";
    },
    async advanceByRef(ref, status, reason) {
      const d = [...s.deliveries.values()].find((x) => x.providerRef === ref && x.channel === "phone");
      if (!d || !["queued", "sending", "ringing"].includes(d.status) || !mayAdvance(d.status, status)) return null;
      d.status = status;
      d.reason = reason;
      return d.id;
    },
    async phoneSecret(userId): Promise<PhoneSecret | null> {
      return s.secrets.get(userId) ?? null;
    },
    async openCalls(olderThanMs, limit) {
      return [...s.deliveries.values()]
        .filter((d) => d.channel === "phone" && d.providerRef && ["queued", "ringing"].includes(d.status) && d.updatedAt < olderThanMs)
        .slice(0, limit)
        .map((d) => ({ providerRef: d.providerRef! }));
    },
    async prefsOf(userId) {
      const u = s.users.get(userId);
      return u ? { prefs: u.prefs, tz: u.tz } : null;
    },
    async prune() {},
    async runState() {
      return s.state;
    },
    async saveRunState(v) {
      s.state = v;
    },
  };
  function hit(op: string): void {
    s.calls.set(op, (s.calls.get(op) ?? 0) + 1);
    if (s.crashAt && s.crashAt.op === op && s.crashAt.times > 0) {
      s.crashAt.times -= 1;
      throw new Error(`crash at ${op}`);
    }
  }
  return s;
}

// ------------------------------------------------------------------------------------------ Twilio

export interface TwilioFake {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** every call-creation request (the number is in `to`) */
  calls: { to: string; from: string; twiml: string; statusCallback: string | null; auth: string }[];
  verifications: { to: string; channel: string; locale: string }[];
  checks: { to: string; code: string }[];
  polls: string[];
  /** next call-creation requests answer with these (an HTTP status, or "network" for a broken connection); consumed one by one */
  callFail: (number | "network")[];
  /** status Twilio reports for a polled call */
  pollStatus: Map<string, string>;
  /** verify: next start answers with this status / code */
  verifyStartFail: { status: number; code?: number } | null;
  /** the code that is right */
  rightCode: string;
  /** verify check answers 404 (expired) */
  checkExpired: boolean;
}

export function twilioFake(): TwilioFake {
  let n = 0;
  const t: TwilioFake = {
    calls: [],
    verifications: [],
    checks: [],
    polls: [],
    callFail: [],
    pollStatus: new Map(),
    verifyStartFail: null,
    rightCode: "123456",
    checkExpired: false,
    fetch: async (url, init) => {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.includes("/Calls.json")) {
        const fail = t.callFail.shift();
        t.calls.push({ to: form.get("To") ?? "", from: form.get("From") ?? "", twiml: form.get("Twiml") ?? "", statusCallback: form.get("StatusCallback"), auth });
        if (fail === "network") throw new TypeError("fetch failed");
        if (fail) return json(fail, { code: 21211, message: "Invalid 'To' Phone Number", status: fail });
        n += 1;
        return json(201, { sid: `CA${String(n).padStart(32, "0")}`, status: "queued" });
      }
      if (url.includes("/Calls/")) {
        const sid = /Calls\/(CA[0-9a-f]+)\.json/i.exec(url)?.[1] ?? "";
        t.polls.push(sid);
        const st = t.pollStatus.get(sid);
        return st ? json(200, { sid, status: st }) : json(404, { code: 20404 });
      }
      if (url.endsWith("/Verifications")) {
        t.verifications.push({ to: form.get("To") ?? "", channel: form.get("Channel") ?? "", locale: form.get("Locale") ?? "" });
        if (t.verifyStartFail) return json(t.verifyStartFail.status, { code: t.verifyStartFail.code ?? 60200 });
        return json(201, { status: "pending" });
      }
      if (url.endsWith("/VerificationCheck")) {
        t.checks.push({ to: form.get("To") ?? "", code: form.get("Code") ?? "" });
        if (t.checkExpired) return json(404, { code: 20404 });
        return json(200, { status: form.get("Code") === t.rightCode ? "approved" : "pending" });
      }
      return json(404, {});
    },
  };
  return t;
}
