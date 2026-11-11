/**
 * Launch-Audit D1, B9: the failed e-mail link in BOTH shapes Supabase uses (query and fragment) is read and taken out of the address;
 * an ordinary hash route stays untouched.
 */
import { describe, expect, it } from "vitest";
import { authErrorText } from "@/cloud/authErrors";
import { hasBootFragmentError, noteBootHrefForTests, readCallback, takeBootFragmentError } from "@/cloud/callbackUrl";
import { hasAuthCallback } from "@/cloud/hint";

const ORIGIN = "https://journal.example";
const EXPIRED = "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

describe("readCallback", () => {
  it("leaves an address without a callback alone – a hash route is no error", () => {
    for (const href of [`${ORIGIN}/`, `${ORIGIN}/#preise`, `${ORIGIN}/?order=premium.year.1#konto`, `${ORIGIN}/#trades/error`, `${ORIGIN}/#setups?error`]) {
      expect(readCallback(href), href).toEqual({ cleaned: null, error: null });
    }
  });

  it("reads the expired link from the query and keeps the hash route and foreign parameters", () => {
    const r = readCallback(`${ORIGIN}/?order=premium.year.1&${EXPIRED}#preise`);
    expect(r.cleaned).toBe(`${ORIGIN}/?order=premium.year.1#preise`);
    expect(r.error).toEqual({ code: "otp_expired", message: "Email link is invalid or has expired" });
  });

  it("reads the expired link from the FRAGMENT (the verify endpoint's shape) and removes the fragment", () => {
    const r = readCallback(`${ORIGIN}/?order=premium.year.1#${EXPIRED}`);
    expect(r.cleaned).toBe(`${ORIGIN}/?order=premium.year.1`);
    expect(r.error).toEqual({ code: "otp_expired", message: "Email link is invalid or has expired" });
    // the visitor reads a sentence with the way on, not a code
    expect(authErrorText(r.error).message).toBe("Der Link ist abgelaufen. Fordere einfach einen neuen an.");
  });

  it("a fragment with only a description or only `error=` still counts", () => {
    expect(readCallback(`${ORIGIN}/#error_description=Something+went+wrong`).error).toEqual({ code: undefined, message: "Something went wrong" });
    expect(readCallback(`${ORIGIN}/#error=access_denied`).error).toEqual({ code: "access_denied", message: "" });
  });

  it("a used PKCE code is removed without an error", () => {
    expect(readCallback(`${ORIGIN}/?code=abc123#trades`)).toEqual({ cleaned: `${ORIGIN}/#trades`, error: null });
  });

  it("is safe on garbage", () => {
    expect(readCallback("not a url")).toEqual({ cleaned: null, error: null });
  });

  it("the boot hint sees the fragment shape too (the cloud chunk must load to show the reason)", () => {
    expect(hasAuthCallback(`${ORIGIN}/#${EXPIRED}`)).toBe(true);
    expect(hasAuthCallback(`${ORIGIN}/#error=access_denied&error_code=otp_expired`)).toBe(true);
    expect(hasAuthCallback(`${ORIGIN}/#preise`)).toBe(false);
  });

  it("the opening address is noted before the router replaces the fragment, and handed out once", () => {
    expect(hasBootFragmentError()).toBe(false); // the test page was opened without a link error
    noteBootHrefForTests(`${ORIGIN}/#${EXPIRED}`);
    expect(hasBootFragmentError()).toBe(true);
    expect(hasAuthCallback()).toBe(true); // … although the address of the page itself no longer shows it
    expect(takeBootFragmentError()).toEqual({ code: "otp_expired", message: "Email link is invalid or has expired" });
    expect(takeBootFragmentError()).toBeNull();
    expect(hasBootFragmentError()).toBe(false);
    noteBootHrefForTests(`${ORIGIN}/#preise`);
    expect(hasBootFragmentError()).toBe(false);
  });
});
