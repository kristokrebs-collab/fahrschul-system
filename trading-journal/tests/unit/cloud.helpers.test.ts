/**
 * P09 pure helpers: auth error texts, password checks, PII scrubbing + error reports (opt-in only), device labels,
 * idle sign-out, privacy prefs, session hints, the offline outbox and the sync base.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authErrorText, emailProblem, GENERIC_ERROR, NETWORK_ERROR, passwordProblem, passwordStrength } from "@/cloud/authErrors";
import { agoLabel, deviceKind, deviceLabel } from "@/cloud/device";
import { oauthProviders, setCloudEnabledForTests } from "@/cloud/env";
import { hasAuthCallback, cloudSessionHint } from "@/cloud/hint";
import { idleExpired, setIdleMinutes, useIdlePref, watchIdle } from "@/cloud/idle";
import { DEFAULT_PRIVACY, parsePrivacy, PRIVACY_KEY, readPrivacy, setPrivacy, usePrivacy, onPrivacyChange } from "@/cloud/privacy";
import { buildReport, installErrorReporting, MAX_REPORTS, reportError, setReportSenderForTests } from "@/cloud/report";
import { errorFingerprint, scrubExtra, scrubStack, scrubText, scrubUrl } from "@/cloud/scrub";
import { localBaseStore, parseBase } from "@/cloud/sync/base";
import { createOutbox, type OutboxStorage } from "@/cloud/sync/outbox";
import { KEYS } from "@/store/storage";

beforeEach(() => {
  localStorage.clear();
  usePrivacy.setState({ ...DEFAULT_PRIVACY });
});
afterEach(() => {
  setCloudEnabledForTests(null);
  setReportSenderForTests(null);
  vi.useRealTimers();
});

describe("auth errors", () => {
  it("maps Supabase codes and messages to short German sentences with the field to shake", () => {
    expect(authErrorText({ code: "invalid_credentials" })).toEqual({ message: "E-Mail oder Passwort stimmt nicht.", field: "password" });
    expect(authErrorText({ code: "mfa_verification_failed" }).field).toBe("code");
    expect(authErrorText({ message: "Invalid login credentials" }).field).toBe("password");
    expect(authErrorText({ name: "AuthRetryableFetchError", message: "x" })).toBe(NETWORK_ERROR);
    expect(authErrorText(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR);
    expect(authErrorText({ status: 429 }).message).toMatch(/Zu viele Versuche/);
    expect(authErrorText(null)).toBe(GENERIC_ERROR);
  });

  it("checks e-mail and password locally and rates the strength", () => {
    expect(emailProblem("")).toMatch(/E-Mail ein/);
    expect(emailProblem("a@b")).toMatch(/nicht gültig/);
    expect(emailProblem(" trader@example.com ")).toBeNull();
    expect(passwordProblem("kurz")).toBe("Mindestens 10 Zeichen.");
    expect(passwordProblem("lang-genug-1")).toBeNull();
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("abcdefghij")).toBe(1);
    expect(passwordStrength("Abcdefghij1!xyz")).toBe(4);
  });
});

describe("scrub + reports", () => {
  it("removes e-mails, tokens, ids, IPs, query strings and trade numbers, keeps stack positions", () => {
    expect(scrubText("max@example.com paid 85912.5 at 10.0.0.1 id 11111111-2222-3333-4444-555555555555")).toBe("[email] paid [n] at [ip] id [id]");
    expect(scrubText("Bearer abc.def.ghi and sb_secret_xyz")).toBe("Bearer [token] and [key]");
    expect(scrubText("see https://x.test/a?q=secret#trades?f=1 now")).toBe("see https://x.test/a now");
    expect(scrubStack("Error\n at f (https://x.test/assets/index-B9.js:12:3456)")).toContain(":12:3456");
    expect(scrubUrl("https://x.test/teilen/?code=abc#trades")).toBe("https://x.test/teilen/");
    expect(scrubUrl("file:///x")).toBeNull();
    expect(scrubExtra({ page: "konto", note: "privat", pnl: "120", nested: { a: "b" }, n: 3 })).toEqual({ page: "konto", nested: { a: "b" } });
    expect(errorFingerprint("Fehler 12", null)).toBe(errorFingerprint("Fehler 99", null));
  });

  it("builds a scrubbed report and drops foreign noise", () => {
    const r = buildReport(new Error("Trade 1234.5 kaputt"), { source: "boundary", componentStack: "\n  at TradeRow" }, "https://x.test/#trades?q=notiz")!;
    expect(r).toMatchObject({ message: "Error: Trade [n] kaputt", url: "https://x.test/", source: "boundary", edition: "personal" });
    expect(r.stack).toContain("Component stack");
    expect(buildReport("Script error.")).toBeNull();
    expect(buildReport(new Error("ResizeObserver loop completed with undelivered notifications."))).toBeNull();
  });

  it("sends only with cloud + telemetry opt-in, de-duplicated, capped, never throwing", async () => {
    const sent: unknown[] = [];
    setReportSenderForTests(async (r) => sent.push(r));
    setCloudEnabledForTests(true);
    reportError(new Error("a"));
    expect(sent).toHaveLength(0); // no opt-in
    setPrivacy({ telemetry: true });
    reportError(new Error("a"));
    reportError(new Error("a"));
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 10; i++) reportError(new Error(`b${"x".repeat(i)}`));
    expect(sent.length).toBe(MAX_REPORTS);
    setCloudEnabledForTests(false);
    setReportSenderForTests(async () => {
      throw new Error("down");
    });
    expect(() => reportError(new Error("c"))).not.toThrow();
  });

  it("window errors and unhandled rejections reach reportError; install is idempotent", () => {
    const sent: { source: string }[] = [];
    setReportSenderForTests(async (r) => void sent.push(r));
    setCloudEnabledForTests(true);
    setPrivacy({ telemetry: true });
    const un1 = installErrorReporting();
    const un2 = installErrorReporting();
    expect(un2).toBe(un1);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom"), message: "boom" }));
    const rej = new Event("unhandledrejection") as Event & { reason?: unknown };
    rej.reason = new Error("nope");
    window.dispatchEvent(rej);
    window.dispatchEvent(new Event("error")); // resource error: no message → ignored
    un1();
    expect(sent.map((s) => s.source)).toEqual(["window", "promise"]);
  });
});

describe("devices + idle", () => {
  it("labels devices and ages", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0 Safari/537.36")).toBe("Samsung Internet · Android-Tablet");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iPhone");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/140 Safari/537.36")).toBe("Chrome · macOS");
    expect(deviceLabel(null)).toBe("Unbekanntes Gerät");
    expect(deviceKind("iPhone Mobile")).toBe("phone");
    expect(deviceKind("Android SM-X916B")).toBe("tablet");
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(agoLabel("2026-10-12T11:59:30Z", now)).toBe("gerade eben");
    expect(agoLabel("2026-10-12T11:55:00Z", now)).toBe("vor 5 Min");
    expect(agoLabel("2026-10-12T09:00:00", now)).toBe("vor 3 Std");
    expect(agoLabel("2026-10-10T12:00:00Z", now)).toBe("vor 2 Tagen");
  });

  it("signs out after the chosen idle time, also across a closed browser", () => {
    expect(idleExpired(0, 10, 30)).toBe(false);
    expect(idleExpired(1000, 1000 + 30 * 60_000, 30)).toBe(true);
    expect(idleExpired(1000, 10_000_000, 0)).toBe(false);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T08:00:00Z"));
    setIdleMinutes(30);
    expect(useIdlePref.getState().minutes).toBe(30);
    const onExpire = vi.fn();
    const stop = watchIdle({ onExpire });
    vi.advanceTimersByTime(20 * 60_000);
    window.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(25 * 60_000);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(6 * 60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    stop();
    // a stored last activity from yesterday expires at once
    localStorage.setItem("tj2-cloud-active", JSON.stringify(Date.now() - 86_400_000));
    const onExpire2 = vi.fn();
    watchIdle({ onExpire: onExpire2 })();
    expect(onExpire2).toHaveBeenCalledTimes(1);
  });
});

describe("privacy, hints, env", () => {
  it("privacy prefs: defaults, parse, persist, notify account keys", () => {
    expect(readPrivacy()).toEqual({ sync: true, telemetry: false, leaderboard: false });
    expect(parsePrivacy({ telemetry: true, sync: "yes", extra: 1 })).toEqual({ sync: true, telemetry: true, leaderboard: false });
    const seen: string[][] = [];
    const off = onPrivacyChange((_, changed) => seen.push(changed));
    setPrivacy({ leaderboard: true });
    setPrivacy({ leaderboard: true });
    setPrivacy({ sync: false }, { silent: true });
    off();
    expect(JSON.parse(localStorage.getItem(PRIVACY_KEY)!)).toEqual({ sync: false, telemetry: false, leaderboard: true });
    expect(seen).toEqual([["leaderboard"]]);
  });

  it("session hint: only with cloud, sync on and a stored session or a callback", () => {
    expect(hasAuthCallback("https://x.test/?code=abc#overview")).toBe(true);
    expect(hasAuthCallback("https://x.test/#access_token=a&x=1")).toBe(true);
    expect(hasAuthCallback("https://x.test/#trades?q=code")).toBe(false);
    expect(cloudSessionHint()).toBe(false);
    setCloudEnabledForTests(true);
    expect(cloudSessionHint()).toBe(false);
    localStorage.setItem(KEYS.cloudAuth, "{}");
    expect(cloudSessionHint()).toBe(true);
    setPrivacy({ sync: false });
    expect(cloudSessionHint()).toBe(false);
  });

  it("OAuth providers come from the build env, deduplicated and filtered", () => {
    expect(oauthProviders("google, GitHub,unknown,google")).toEqual(["google", "github"]);
    expect(oauthProviders(undefined)).toEqual([]);
  });
});

describe("outbox + base", () => {
  it("keeps keys with generations; settle removes only entries not marked again; persists through its storage", async () => {
    let stored: Record<string, unknown> | undefined;
    const storage: OutboxStorage = { read: async () => stored as never, write: async (v) => void (stored = v) };
    const box = createOutbox(storage);
    const sizes: number[] = [];
    box.onChange((n) => sizes.push(n));
    await box.mark("trade:t_1");
    await box.mark("day:2026-10-01");
    const snap = await box.all();
    await box.mark("trade:t_1"); // edited again while uploading
    await box.settle(snap);
    expect((await box.all()).map((e) => [e.key, e.gen])).toEqual([["trade:t_1", 2]]);
    expect(Object.keys(stored!)).toEqual(["trade:t_1"]);
    const again = createOutbox(storage);
    expect((await again.all()).map((e) => e.key)).toEqual(["trade:t_1"]);
    expect(sizes.at(-1)).toBe(1);
    // a failing storage degrades to memory
    const broken = createOutbox({ read: async () => Promise.reject(new Error("idb")), write: async () => Promise.reject(new Error("idb")) });
    await broken.mark("trade:x");
    expect(broken.size()).toBe(1);
  });

  it("the sync base parses defensively and lives under its edition key", () => {
    expect(parseBase(null)).toBeNull();
    expect(parseBase({ v: 1, owner: "", docs: {} })).toBeNull();
    const b = parseBase({ v: 1, owner: "u", at: "x", docs: { "trade:t": "h", bad: 3 }, settings: null, settingsRev: 2, serverAt: "s" })!;
    expect(b.docs).toEqual({ "trade:t": "h" });
    localBaseStore.write(b);
    expect(JSON.parse(localStorage.getItem("tj2-cloud-base")!).owner).toBe("u");
    expect(localBaseStore.read()?.settingsRev).toBe(2);
    localBaseStore.clear();
    expect(localBaseStore.read()).toBeNull();
  });
});
