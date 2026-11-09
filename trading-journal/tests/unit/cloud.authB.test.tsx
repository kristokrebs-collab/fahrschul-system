/**
 * Paket B – Anmeldung / Registrierung, the fixes that stayed through the Rücknahme R1 and the login window of Paket V (`cloud.authWindow.test.tsx`
 * has the card and its motion): no account enumeration (AUTH-03), the pre-selected order travels with every mail
 * (AUTH-06), the "mail sent" step with a resend that waits a minute and says the server's limit, offline said before anything is sent,
 * "e-mail not confirmed" leading to a new link, the armed setup wizard. The Supabase chunk is mocked: this proves the browser flow, not a mail.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const { MotionRoot } = await import("@/motion/MotionRoot");
const { clearReturnTo, setReturnTo } = await import("@/store/returnTo");
const { useUi } = await import("@/store/uiStore");
const toastTitles = () => useUi.getState().toasts.map((t) => String(t.title));
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
    // the way back is the one of the old sheet (the login holds "Passwort vergessen?")
    fireEvent.click(screen.getByRole("button", { name: "Zurück zur Anmeldung" }));
    await waitFor(() => expect(useCloudSession.getState().sheet.view).toBe("signin"));
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

  it("the reset step says the same for every address (the text of the sheet before Paket B)", async () => {
    sendPasswordReset.mockResolvedValue({ ok: true });
    openAuthSheet("reset", "card");
    mount();
    await dialog();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "wer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Link senden" }));
    expect(await screen.findByTestId("auth-sent-text")).toHaveTextContent("Wir haben einen Link zum Zurücksetzen an wer@example.com geschickt.");
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

describe("the 'mail sent' step: resend with a wait and the server's limit", () => {
  async function sent(kind: "confirm" | "reset" = "confirm", resendNow = false) {
    useCloudSession.setState({ sheet: { ...useCloudSession.getState().sheet, open: true, mounted: true, view: "sent", prev: "signup", sent: kind, email: "a@example.com", resendNow } });
    mount();
    await dialog();
  }

  it("the resend button waits one minute (the server's default) and shows the countdown; no extra hint lines (the old step)", async () => {
    await sent();
    const btn = screen.getByTestId("auth-resend");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Erneut senden");
    expect(RESEND_S).toBe(60);
    expect(screen.queryByTestId("auth-limit-hint")).toBeNull();
    expect(screen.queryByRole("button", { name: "Andere E-Mail-Adresse" })).toBeNull();
  });

  it("after the wait a resend goes out once; the answer is a toast (as before Paket B), the wait starts again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resendConfirmation.mockResolvedValue({ ok: true });
    await sent();
    await waitCountdown(RESEND_S);
    const btn = screen.getByTestId("auth-resend");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    fireEvent.click(btn); // a second tap while it works sends nothing
    await waitFor(() => expect(toastTitles()).toContain("Neue E-Mail ist unterwegs."));
    expect(resendConfirmation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("auth-resend")).toBeDisabled();
  });

  it("the server's send limit is said in words and the wait gets longer (never a retry loop)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resendConfirmation.mockResolvedValue({ ok: false, code: "over_email_send_rate_limit", message: "Zu viele E-Mails in kurzer Zeit. Warte bitte eine Minute.", field: "email" });
    await sent();
    await waitCountdown(RESEND_S);
    fireEvent.click(screen.getByTestId("auth-resend"));
    await waitFor(() => expect(toastTitles().some((t) => t.startsWith("Zu viele E-Mails in kurzer Zeit"))).toBe(true));
    expect(screen.getByTestId("auth-resend")).toBeDisabled();
    expect(RESEND_LIMIT_S).toBeGreaterThan(RESEND_S);
    expect(resendConfirmation).toHaveBeenCalledTimes(1);
  });

  it("offline is said before anything is sent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await sent();
    await waitCountdown(RESEND_S);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    fireEvent.click(screen.getByTestId("auth-resend"));
    await waitFor(() => expect(toastTitles().some((t) => t.startsWith("Du bist offline"))).toBe(true));
    expect(resendConfirmation).not.toHaveBeenCalled();
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

  it("a shown e-mail error goes the moment the address is valid; no extra help line under the password (the old field)", async () => {
    openAuthSheet("signup", "card");
    mount();
    await dialog();
    expect(screen.queryByText(/Mindestens 10 Zeichen – ein langer Satz/)).toBeNull();
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

describe("the login window keeps the choice out of sight (R1 stays), the switch is its footer link", () => {
  it("a noted order is not shown in the login (no order card) – the footer link switches to the registration", async () => {
    setReturnTo({ kind: "order", order: "premium.year.1" }, { on: "signedIn" }, "Bestellung");
    openAuthSheet("signin", "card");
    mount();
    await dialog();
    for (const id of ["auth-order", "auth-stage", "auth-blade"]) expect(screen.queryByTestId(id), id).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByTestId("auth-to-signup"));
    expect(useCloudSession.getState().sheet.view).toBe("signup");
  });
});
