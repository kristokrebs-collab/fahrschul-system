/**
 * Paket B, release audit AUTH-03 / AUTH-06 pinned at the level below the sheet:
 *
 * AUTH-03 – no account enumeration. `signUp` answers a NEW address and one that ALREADY has an account the same way ("check your
 * mail", `confirm: true`), whichever way Supabase answers (obfuscated user without identities, or the error `user_already_exists`
 * when e-mail confirmation is off). No text of the auth error table says "there is an account / there is none" – checked over every
 * code. The reset answers neutrally by construction (Supabase answers 200 for any address).
 *
 * AUTH-06 – the pre-selected order (plan, interval, seats – never a price) rides in the link of the mail (`emailRedirectTo`), is
 * validated again when the link opens (whitelist grammar, seats clamped, everything else dropped) and only ever becomes a NOTE that
 * opens the order SUMMARY after the sign-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authErrorCodeOf, authErrorText, AUTH_NEUTRAL } from "@/cloud/authErrors";
import { redirectUrl, resendConfirmation, sendMagicLink, sendPasswordReset, setClientForTests, signUp } from "@/cloud/client";
import { captureOrderQuery, clearReturnTo, ORDER_QUERY, pendingOrderParam, peekReturnTo } from "@/store/returnTo";

const signUpApi = vi.fn();
const resend = vi.fn();
const otp = vi.fn();
const reset = vi.fn();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearReturnTo();
  for (const f of [signUpApi, resend, otp, reset]) f.mockReset();
  setClientForTests({
    auth: { signUp: signUpApi, resend, signInWithOtp: otp, resetPasswordForEmail: reset, getSession: async () => ({ data: { session: null } }) },
  } as unknown as SupabaseClient);
});
afterEach(() => {
  setClientForTests(null);
  window.history.replaceState(null, "", "/");
});

describe("AUTH-03: registration never says whether an account exists", () => {
  it("an obfuscated user (confirmation on, address taken) and a fresh user without a session end in the SAME answer", async () => {
    signUpApi.mockResolvedValueOnce({ data: { user: { id: "u1", identities: [] }, session: null }, error: null }); // taken
    const taken = await signUp("vorhanden@example.com", "Sehr-sicheres-Passwort-42!");
    signUpApi.mockResolvedValueOnce({ data: { user: { id: "u2", identities: [{ id: "i" }] }, session: null }, error: null }); // new
    const fresh = await signUp("neu@example.com", "Sehr-sicheres-Passwort-42!");
    expect(taken).toEqual({ ok: true, value: { confirm: true } });
    expect(fresh).toEqual(taken);
  });

  it("the error `user_already_exists` / `email_exists` (confirmation off) is answered the same way – never surfaced", async () => {
    for (const code of ["user_already_exists", "email_exists"]) {
      signUpApi.mockResolvedValueOnce({ data: { user: null, session: null }, error: Object.assign(new Error("User already registered"), { code, status: 422 }) });
      expect(await signUp("vorhanden@example.com", "Sehr-sicheres-Passwort-42!"), code).toEqual({ ok: true, value: { confirm: true } });
    }
    // by message only (an older server without codes)
    signUpApi.mockResolvedValueOnce({ data: { user: null, session: null }, error: Object.assign(new Error("User already registered"), { status: 400 }) });
    expect(await signUp("vorhanden@example.com", "Sehr-sicheres-Passwort-42!")).toEqual({ ok: true, value: { confirm: true } });
  });

  it("other errors stay honest (weak password, rate limit): they say nothing about the address's account", async () => {
    signUpApi.mockResolvedValueOnce({ data: { user: null, session: null }, error: Object.assign(new Error("x"), { code: "weak_password", status: 422 }) });
    expect(await signUp("a@example.com", "kurz")).toMatchObject({ ok: false, field: "password", code: "weak_password" });
    signUpApi.mockResolvedValueOnce({ data: { user: null, session: null }, error: Object.assign(new Error("x"), { code: "over_email_send_rate_limit", status: 429 }) });
    expect(await signUp("a@example.com", "Sehr-sicheres-Passwort-42!")).toMatchObject({ ok: false, code: "over_email_send_rate_limit" });
  });

  it("no text of the auth error table (any code, any message pattern) says an account exists, is taken or is missing", () => {
    const codes = ["invalid_credentials", "email_not_confirmed", "user_already_exists", "email_exists", "weak_password", "same_password", "email_address_invalid", "validation_failed", "signup_disabled", "email_provider_disabled", "over_email_send_rate_limit", "over_request_rate_limit", "otp_expired", "flow_state_expired", "flow_state_not_found", "bad_code_verifier", "mfa_verification_failed", "mfa_challenge_expired", "session_not_found", "user_banned", "captcha_failed"];
    const texts = codes.map((c) => authErrorText({ code: c }).message);
    for (const m of ["User already registered", "email address already exists", "user not found", "Invalid login credentials"]) texts.push(authErrorText({ message: m }).message);
    for (const t of texts) expect(t, t).not.toMatch(/gibt es schon|existiert|bereits (registriert|vergeben)|kein Konto|nicht registriert|schon ein Konto\. Melde|kein Benutzer/i);
    // the one sentence for "may already have an account" names neither case and shows both ways on
    expect(authErrorText({ code: "user_already_exists" }).message).toBe(AUTH_NEUTRAL);
    expect(AUTH_NEUTRAL).toMatch(/Wenn die Adresse frei ist.*melde dich an oder setze dein Passwort zurück/);
    // a wrong password and an unknown address are the same sentence (the login never tells which one it was)
    expect(authErrorText({ code: "invalid_credentials" })).toEqual(authErrorText({ message: "Invalid login credentials" }));
  });

  it("the reset and the magic link ask the server and ignore the answer's detail: the same ok for any address", async () => {
    reset.mockResolvedValue({ data: {}, error: null });
    otp.mockResolvedValue({ data: {}, error: null });
    expect(await sendPasswordReset("irgendwer@example.com")).toEqual({ ok: true });
    expect(await sendMagicLink("irgendwer@example.com")).toEqual({ ok: true });
    expect(authErrorCodeOf({ message: "Invalid login credentials" })).toBe("invalid_credentials");
  });
});

describe("AUTH-06: the pre-selection rides in the link of the mail", () => {
  it("redirectUrl carries ONLY a valid order (plan.interval.seats) – never a price, never anything else", () => {
    const base = redirectUrl();
    expect(base).toBe(`${location.origin}/`);
    expect(redirectUrl("premium.year.1")).toBe(`${location.origin}/?order=premium.year.1`);
    expect(redirectUrl("team.month.3")).toBe(`${location.origin}/?order=team.month.3`);
    for (const bad of ["enterprise.year.1", "free.year.1", "pro.week.1", "pro.year.1&price=1", "https://evil.example/", "pro.year.999", "", null, undefined]) expect(redirectUrl(bad as string | null | undefined), String(bad)).toBe(base);
  });

  it("signUp, the resend, the magic link and the reset put it into emailRedirectTo / redirectTo", async () => {
    signUpApi.mockResolvedValue({ data: { user: { id: "u", identities: [{}] }, session: null }, error: null });
    resend.mockResolvedValue({ data: {}, error: null });
    otp.mockResolvedValue({ data: {}, error: null });
    reset.mockResolvedValue({ data: {}, error: null });
    const want = `${location.origin}/?order=premium.year.1`;
    await signUp("a@example.com", "Sehr-sicheres-Passwort-42!", "premium.year.1");
    expect(signUpApi.mock.calls[0]![0].options.emailRedirectTo).toBe(want);
    await resendConfirmation("a@example.com", "premium.year.1");
    expect(resend.mock.calls[0]![0].options.emailRedirectTo).toBe(want);
    await sendMagicLink("a@example.com", "premium.year.1");
    expect(otp.mock.calls[0]![0].options.emailRedirectTo).toBe(want);
    await sendPasswordReset("a@example.com", "premium.year.1");
    expect(reset.mock.calls[0]![1].redirectTo).toBe(want);
    // without an order: the plain root, as before
    await signUp("b@example.com", "Sehr-sicheres-Passwort-42!");
    expect(signUpApi.mock.calls[1]![0].options.emailRedirectTo).toBe(`${location.origin}/`);
  });
});

describe("AUTH-06: the page that the link opens validates the selection again and only notes it", () => {
  const open = (search: string) => window.history.replaceState(null, "", `/${search}#preise`);

  it("a valid selection becomes the order note (waits for the sign-in), the parameter leaves the address, the hash route stays", () => {
    open(`?${ORDER_QUERY}=premium.year.1&code=abc123`);
    expect(captureOrderQuery()).toBe(true);
    expect(peekReturnTo()).toMatchObject({ target: { kind: "order", order: "premium.year.1" }, wait: { on: "signedIn" } });
    expect(pendingOrderParam()).toBe("premium.year.1");
    expect(window.location.search).toBe("?code=abc123"); // the auth code is Supabase's to take, not ours
    expect(window.location.hash).toBe("#preise");
  });

  it("seats are clamped to the plan's limits (Team 2…50; one for the other plans), the note stores the normalized order", () => {
    open(`?${ORDER_QUERY}=team.year.1`);
    expect(captureOrderQuery()).toBe(true);
    expect(pendingOrderParam()).toBe("team.year.2");
    clearReturnTo();
    open(`?${ORDER_QUERY}=premium.month.40`);
    expect(captureOrderQuery()).toBe(true);
    expect(pendingOrderParam()).toBe("premium.month.1");
  });

  it("anything that is not the grammar is dropped – and the parameter is still taken out of the address", () => {
    for (const bad of ["enterprise.year.1", "free.month.1", "pro.week.1", "pro.year.1%26price%3D1", "javascript%3Aalert(1)", "%2F%2Fevil.example", "pro.year.999", "premium.year.1.extra", "x".repeat(200), ""]) {
      open(`?${ORDER_QUERY}=${bad}`);
      expect(captureOrderQuery(), bad).toBe(false);
      expect(peekReturnTo(), bad).toBeNull();
      expect(window.location.search, bad).toBe("");
    }
  });

  it("no parameter: nothing happens (an earlier note stays as it is)", () => {
    open("");
    expect(captureOrderQuery()).toBe(false);
    expect(peekReturnTo()).toBeNull();
  });

  it("the note lives in the shared storage too: the tab that the link opened and the next tab both see it, once", () => {
    open(`?${ORDER_QUERY}=pro.month.1`);
    captureOrderQuery();
    expect(localStorage.getItem("tj2-return-to-order")).toContain("pro.month.1");
  });
});
