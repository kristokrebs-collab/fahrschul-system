/**
 * Paket B – Anmeldung / Registrierung: no account enumeration, the "mail sent" step with a resend that waits and says why, the
 * pending order shown in the card with the way out ("Ohne Kauf weiter"), offline said before anything is sent, "e-mail not
 * confirmed" leading to a new link, the blade between Anmelden ↔ Registrieren (content switches behind it, reduced motion
 * has none), the brand strip, the armed setup wizard. The Supabase chunk is mocked: this proves the browser flow, not a mail.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInPassword = vi.fn();
const signUp = vi.fn();
const resendConfirmation = vi.fn();
const sendPasswordReset = vi.fn();
vi.mock("@/cloud/runtime", async (orig) => {
  const real = await orig<typeof import("@/cloud/runtime")>();
  return { ...real, ensureCloud: vi.fn(async () => ({ signInPassword, signUp, resendConfirmation, sendPasswordReset, sendMagicLink: vi.fn() })) };
});
const fx = vi.hoisted(() => ({ reduced: true }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

const { setCloudEnabledForTests } = await import("@/cloud/env");
const { resetCloudSession, openAuthSheet, useCloudSession } = await import("@/cloud/session");
const { AuthSheet, RESEND_S, RESEND_LIMIT_S } = await import("@/cloud/ui/AuthSheet");
const { BLADE_MS, BLADE_PEAK } = await import("@/cloud/ui/AuthBlade");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { clearReturnTo, peekReturnTo, setReturnTo } = await import("@/store/returnTo");
const { readWizard, WIZARD_KEY } = await import("@/onboarding/wizard/wizardStore");

const mount = () => render(<MotionRoot><AuthSheet /></MotionRoot>);
const dialog = () => screen.findByRole("dialog");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearReturnTo();
  setCloudEnabledForTests(true);
  resetCloudSession();
  fx.reduced = true;
  for (const f of [signInPassword, signUp, resendConfirmation, sendPasswordReset]) f.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  vi.useRealTimers();
});

describe("registration: no account enumeration", () => {
  async function register() {
    openAuthSheet("signup", "card");
    mount();
    await dialog();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "jemand@example.com" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "Sehr-sicheres-Passwort-42!" } });
    const box = screen.queryByRole("checkbox");
    if (box) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
  }

  it("a new and an existing address end in the SAME 'check your mail' step – the text says neither 'exists' nor 'is new'", async () => {
    signUp.mockResolvedValue({ ok: true, value: { confirm: true } }); // `client.signUp` answers this for both cases
    await register();
    await waitFor(() => expect(useCloudSession.getState().sheet).toMatchObject({ view: "sent", sent: "confirm", email: "jemand@example.com" }));
    const text = (await screen.findByTestId("auth-sent-text")).textContent ?? "";
    expect(text).toContain("jemand@example.com");
    expect(text).toMatch(/Wenn die Adresse frei ist, schicken wir dir eine Bestätigung an jemand@example\.com.*Hast du schon ein Konto, melde dich an oder setze dein Passwort zurück/);
    expect(text).not.toMatch(/gibt es schon|existiert|bereits registriert|already|ist neu/i);
    // the way to the login AND to the password reset is right there
    expect(screen.getByRole("button", { name: "Zur Anmeldung" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Passwort vergessen?" }));
    await waitFor(() => expect(useCloudSession.getState().sheet.view).toBe("reset"));
  });

  it("the pre-selected order travels with the call (it ends up in the link of the mail); a registration without an order sends none", async () => {
    signUp.mockResolvedValue({ ok: true, value: { confirm: true } });
    setReturnTo({ kind: "order", order: "premium.year.1" }, { on: "signedIn" });
    await register();
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("jemand@example.com", "Sehr-sicheres-Passwort-42!", "premium.year.1"));
  });

  it("the resend carries the order too (a second mail must lead to the same order)", async () => {
    resendConfirmation.mockResolvedValue({ ok: true });
    setReturnTo({ kind: "order", order: "team.month.3" }, { on: "signedIn" });
    useCloudSession.setState({ sheet: { ...useCloudSession.getState().sheet, open: true, mounted: true, view: "sent", prev: "signup", sent: "confirm", email: "a@example.com", resendNow: true } });
    mount();
    await dialog();
    fireEvent.click(screen.getByTestId("auth-resend"));
    await waitFor(() => expect(resendConfirmation).toHaveBeenCalledWith("a@example.com", "team.month.3"));
  });

  it("the reset step is neutral too ('Wenn zu … ein Konto gehört')", async () => {
    sendPasswordReset.mockResolvedValue({ ok: true });
    openAuthSheet("reset", "card");
    mount();
    await dialog();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "wer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Link senden" }));
    expect(await screen.findByTestId("auth-sent-text")).toHaveTextContent("Wenn zu wer@example.com ein Konto gehört, haben wir einen Link zum Zurücksetzen geschickt.");
  });

  it("a registration arms the setup wizard once (a login does not)", async () => {
    signUp.mockResolvedValue({ ok: true, value: { confirm: true } });
    await register();
    await waitFor(() => expect(readWizard()?.status).toBe("pending"));
    localStorage.removeItem(WIZARD_KEY);
    signInPassword.mockResolvedValue({ ok: true, value: { mfa: false } });
    act(() => openAuthSheet("signin", "card"));
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "a@b.de" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(signInPassword).toHaveBeenCalled());
    expect(readWizard()).toBeNull();
  });
});

/** The countdown re-arms itself after every second (state → effect → timer): one step per second, each flushed by React. */
async function waitCountdown(seconds: number) {
  for (let i = 0; i <= seconds; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

describe("the 'mail sent' step: resend with a wait, a limit hint, the way back", () => {
  async function sent(kind: "confirm" | "reset" = "confirm", resendNow = false) {
    useCloudSession.setState({ sheet: { ...useCloudSession.getState().sheet, open: true, mounted: true, view: "sent", prev: "signup", sent: kind, email: "a@example.com", resendNow } });
    mount();
    await dialog();
  }

  it("the resend button waits one minute (the server's default), shows the countdown and always shows the limit hint", async () => {
    await sent();
    const btn = screen.getByTestId("auth-resend");
    expect(btn).toBeDisabled();
    expect(RESEND_S).toBe(60);
    expect(screen.getByTestId("auth-limit-hint")).toHaveTextContent("erst nach einer Minute");
    expect(screen.getByTestId("auth-limit-hint")).toHaveTextContent("Spam-Ordner");
  });

  it("after the wait a resend goes out once; the answer stands under the buttons (role=status), the wait starts again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resendConfirmation.mockResolvedValue({ ok: true });
    await sent();
    await waitCountdown(RESEND_S);
    const btn = screen.getByTestId("auth-resend");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    fireEvent.click(btn); // a second tap while it works sends nothing
    await waitFor(() => expect(screen.getByTestId("auth-resend-note")).toHaveTextContent("Neue E-Mail ist unterwegs."));
    expect(resendConfirmation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("auth-resend-note")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("auth-resend")).toBeDisabled();
  });

  it("the server's send limit is said in words, as an alert, and the wait gets longer (never a retry loop)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resendConfirmation.mockResolvedValue({ ok: false, code: "over_email_send_rate_limit", message: "Zu viele E-Mails in kurzer Zeit. Warte bitte eine Minute.", field: "email" });
    await sent();
    await waitCountdown(RESEND_S);
    fireEvent.click(screen.getByTestId("auth-resend"));
    const note = await screen.findByTestId("auth-resend-note");
    expect(note).toHaveAttribute("data-kind", "limit");
    expect(note).toHaveAttribute("role", "alert");
    expect(note).toHaveTextContent("Zu viele E-Mails in kurzer Zeit");
    expect(screen.getByTestId("auth-resend")).toBeDisabled();
    expect(RESEND_LIMIT_S).toBeGreaterThan(RESEND_S);
    expect(resendConfirmation).toHaveBeenCalledTimes(1);
  });

  it("another error (offline, server) is shown as an alert too; offline is said before anything is sent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await sent();
    await waitCountdown(RESEND_S);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    fireEvent.click(screen.getByTestId("auth-resend"));
    expect(await screen.findByTestId("auth-resend-note")).toHaveTextContent("Du bist offline");
    expect(resendConfirmation).not.toHaveBeenCalled();
  });

  it("'Andere E-Mail-Adresse' goes back to the registration with the typed address; 'Zur Anmeldung' to the login", async () => {
    await sent();
    fireEvent.click(screen.getByRole("button", { name: "Andere E-Mail-Adresse" }));
    await waitFor(() => expect(useCloudSession.getState().sheet.view).toBe("signup"));
    expect(screen.getByLabelText("E-Mail")).toHaveValue("a@example.com");
  });

  it("'e-mail not confirmed' at the login leads here with a resend that is available at once", async () => {
    signInPassword.mockResolvedValue({ ok: false, code: "email_not_confirmed", message: "Bitte bestätige zuerst deine E-Mail. Wir können den Link erneut senden.", field: "email" });
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "richtig-geheim-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(useCloudSession.getState().sheet).toMatchObject({ view: "sent", sent: "confirm", resendNow: true }));
    expect(await screen.findByTestId("auth-resend")).toBeEnabled();
    expect(screen.getByTestId("auth-notice")).toHaveTextContent("noch nicht bestätigt");
  });
});

describe("fields: understandable errors, offline, show/hide", () => {
  it("offline is said before anything is sent and the typed values stay", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "geheim" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByText(/Du bist offline/)).toBeInTheDocument();
    expect(signInPassword).not.toHaveBeenCalled();
    expect(screen.getByLabelText("E-Mail")).toHaveValue("a@example.com");
  });

  it("a shown e-mail error goes the moment the address is valid; the registration names its password rule at the field", async () => {
    openAuthSheet("signup", "card");
    mount();
    await dialog();
    expect(screen.getByText(/Mindestens 10 Zeichen – ein langer Satz/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "kaputt" } });
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
    expect(await screen.findByText("Diese E-Mail-Adresse sieht nicht gültig aus.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "ok@example.com" } });
    await waitFor(() => expect(screen.queryByText("Diese E-Mail-Adresse sieht nicht gültig aus.")).toBeNull());
    expect(signUp).not.toHaveBeenCalled();
  });

  it("the password has a show / hide toggle with a state (aria-pressed)", async () => {
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    const pw = screen.getByLabelText("Passwort") as HTMLInputElement;
    expect(pw.type).toBe("password");
    const toggle = screen.getByRole("button", { name: "Passwort anzeigen" });
    fireEvent.click(toggle);
    expect(pw.type).toBe("text");
    expect(screen.getByRole("button", { name: "Passwort verbergen" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the order the login is for", () => {
  it("shows plan, interval and the amount due, keeps them through the views and drops them with 'Ohne Kauf weiter'", async () => {
    setReturnTo({ kind: "order", order: "premium.year.1" }, { on: "signedIn" }, "Bestellung");
    openAuthSheet("signup", "card");
    mount();
    await dialog();
    const ctx = await screen.findByTestId("auth-order");
    expect(ctx).toHaveAttribute("data-plan", "premium");
    expect(ctx).toHaveAttribute("data-interval", "year");
    expect(within(ctx).getByTestId("auth-order-line")).toHaveTextContent("Premium · jährlich · 240 € pro Jahr");
    expect(ctx).toHaveTextContent("Bestellt ist erst, wenn du dort ausdrücklich bestellst");
    fireEvent.click(within(ctx).getByTestId("auth-order-skip"));
    expect(peekReturnTo()).toBeNull();
    await waitFor(() => expect(useCloudSession.getState().sheet.open).toBe(false));
  });

  it("Team shows the seats and the total (2 × 190 € = 380 € per year)", async () => {
    setReturnTo({ kind: "order", order: "team.year.2" }, { on: "signedIn" });
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    expect(await screen.findByTestId("auth-order-line")).toHaveTextContent("Team · jährlich · 2 Sitze · 380 € pro Jahr");
  });

  it("nothing is shown without a pending order (the free registration)", async () => {
    openAuthSheet("signup", "card");
    mount();
    await dialog();
    expect(screen.queryByTestId("auth-order")).toBeNull();
  });
});

describe("brand strip and blade", () => {
  it("our name and one claim per mode; no foreign brand", async () => {
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    const brand = screen.getByTestId("auth-brand");
    expect(brand).toHaveTextContent("TRADE JOURNAL");
    expect(screen.getByTestId("auth-brand-claim")).toHaveTextContent("Willkommen zurück.");
    expect(brand).not.toHaveTextContent(/verso/i);
  });

  it("the strip sits INSIDE the card's height-following box (its claim may take one line or two – that change must ride the card's own spring, not reach the panel un-pinned)", async () => {
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    const brand = screen.getByTestId("auth-brand");
    const morph = document.querySelector("[data-auth-morph]")!;
    // brand and steps are siblings in the one measured box (`MorphHeight`'s inner element), the blade stage wraps that box
    expect(brand.parentElement).toBe(morph.parentElement);
    expect(screen.getByTestId("auth-stage").contains(brand)).toBe(true);
  });

  it("reduced motion: the switch is immediate, no band exists, the focus lands in the first field", async () => {
    fx.reduced = true;
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    // the sheet puts its own first focus on the close button once it is open: wait for that, THEN switch (a person clicks later)
    await waitFor(() => expect(screen.getByRole("button", { name: "Schließen" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Neu hier? Jetzt registrieren" }));
    expect(useCloudSession.getState().sheet.view).toBe("signup");
    expect(screen.queryByTestId("auth-blade")).toBeNull();
    expect(screen.getByTestId("auth-brand-claim")).toHaveTextContent("Dein Journal. Dein Start.");
    await waitFor(() => expect(screen.getByLabelText("E-Mail")).toHaveFocus());
  });

  it("with motion: a band sweeps once, the content changes BEHIND it (not before), then the band is gone and a second switch works", async () => {
    fx.reduced = false;
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    fireEvent.click(screen.getByRole("button", { name: "Neu hier? Jetzt registrieren" }));
    expect(screen.getByTestId("auth-blade")).toBeInTheDocument();
    expect(screen.getByTestId("auth-stage")).toHaveAttribute("data-blade", "running");
    // the mode switch shows the target at once, the content has not changed yet
    expect(screen.getByRole("radio", { name: "Neu hier" })).toBeChecked();
    expect(useCloudSession.getState().sheet.view).toBe("signin");
    // a second click while the band runs changes nothing
    fireEvent.click(screen.getByRole("radio", { name: "Magic Link" }));
    await waitFor(() => expect(useCloudSession.getState().sheet.view).toBe("signup"), { timeout: BLADE_MS * BLADE_PEAK + 800 });
    expect(screen.getByTestId("auth-brand-claim")).toHaveTextContent("Dein Journal. Dein Start.");
    await waitFor(() => expect(screen.queryByTestId("auth-blade")).toBeNull(), { timeout: BLADE_MS + 1500 });
    // and back
    fireEvent.click(screen.getByRole("button", { name: "Schon registriert? Zur Anmeldung" }));
    await waitFor(() => expect(useCloudSession.getState().sheet.view).toBe("signin"), { timeout: BLADE_MS + 1500 });
  });

  it("the band only transforms (no layout properties) and is out of the accessibility tree and the pointer's way", async () => {
    fx.reduced = false;
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    fireEvent.click(screen.getByRole("button", { name: "Neu hier? Jetzt registrieren" }));
    const band = screen.getByTestId("auth-blade");
    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(band.className).toContain("pointer-events-none");
    expect(band.style.transform).toMatch(/translateX\(.+\) skewX\(-14deg\)/);
    await waitFor(() => expect(screen.queryByTestId("auth-blade")).toBeNull(), { timeout: BLADE_MS + 1500 });
  });
});
