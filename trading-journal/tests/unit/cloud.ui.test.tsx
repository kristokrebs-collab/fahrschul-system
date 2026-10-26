/**
 * P09 cloud UI: Konto page states (no cloud / signed out / signed in), the login sheet's validation and error paths
 * (Supabase chunk mocked), the code slots, the privacy switches and the cloud variant of the local-mode banner.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInPassword = vi.fn();
const sendMagicLink = vi.fn();
const signUp = vi.fn();
vi.mock("@/cloud/runtime", async (orig) => {
  const real = await orig<typeof import("@/cloud/runtime")>();
  return {
    ...real,
    ensureCloud: vi.fn(async () => ({
      signInPassword,
      sendMagicLink,
      signUp,
      listSessions: async () => ({ ok: true, value: [{ id: "s1", createdAt: null, lastActiveAt: new Date().toISOString(), userAgent: "Mozilla/5.0 (Macintosh) Chrome/140", ip: "10.0.0.x", aal: "aal1", current: true }] }),
      signOutScope: async () => ({ ok: true }),
      syncNow: async () => true,
    })),
  };
});

const { LocalModeBanner } = await import("@/app/LocalModeBanner");
const { setCloudEnabledForTests } = await import("@/cloud/env");
const { DEFAULT_PRIVACY, readPrivacy, usePrivacy } = await import("@/cloud/privacy");
const { resetCloudSession, useCloudSession, openAuthSheet } = await import("@/cloud/session");
const { patchSyncStatus, resetSyncStatus } = await import("@/cloud/sync/status");
const { AuthSheet } = await import("@/cloud/ui/AuthSheet");
const { CodeSlots, cleanCode } = await import("@/cloud/ui/CodeSlots");
const { PrivacyCard } = await import("@/cloud/ui/PrivacyCard");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { resetJournal, useJournal } = await import("@/store/journalStore");
const { useUi } = await import("@/store/uiStore");
const { KontoView } = await import("@/views/konto");

const USER = { id: "u1", email: "trader@example.com", aal: "aal1" as const, mfaEnrolled: false };

function signIn() {
  useCloudSession.setState({ phase: "signedIn", user: USER, provider: "email", emailConfirmed: true, createdAt: "2026-03-01T09:00:00Z", factors: [], sessionId: "s1" });
}

beforeEach(() => {
  localStorage.clear();
  setCloudEnabledForTests(true);
  resetCloudSession();
  resetSyncStatus();
  usePrivacy.setState({ ...DEFAULT_PRIVACY });
  signInPassword.mockReset();
  sendMagicLink.mockReset();
});
afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
});

describe("KontoView", () => {
  it("without cloud: an honest card and nothing to sign in to", () => {
    setCloudEnabledForTests(false);
    render(<KontoView />);
    expect(screen.getByRole("heading", { level: 1, name: "Konto" })).toBeInTheDocument();
    expect(screen.getByText("Cloud nicht eingerichtet")).toBeInTheDocument();
    expect(screen.getByText(/Login und Sync sind in dieser Version nicht aktiv/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anmelden" })).toBeNull();
  });

  it("signed out: the pitch opens the login sheet; privacy works without an account", () => {
    useCloudSession.setState({ phase: "signedOut" });
    render(<KontoView />);
    expect(screen.getByRole("heading", { name: "Ein Journal. Alle Geräte." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signup", source: "card" });
    expect(screen.getByRole("switch", { name: /Fehlerberichte senden/ })).toBeEnabled();
    expect(screen.getByRole("switch", { name: /In der Rangliste erscheinen/ })).toBeDisabled();
    expect(screen.queryByText("Sicherheit")).toBeNull();
  });

  it("signed in: login, sync, security, privacy and data cards", async () => {
    signIn();
    patchSyncStatus({ phase: "live", pending: 2, records: 16, realtime: true, lastSyncAt: new Date().toISOString() });
    render(
      <MotionRoot>
        <KontoView />
      </MotionRoot>,
    );
    expect(screen.getByText("trader@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Änderungen warten");
    expect(screen.getByText("Echtzeit verbunden")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Zwei-Faktor-Schutz" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Konto löschen" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Dieses Gerät")).toBeInTheDocument());
    // the delete hold button appears only once the word is typed
    expect(screen.queryByRole("button", { name: "Halten zum Löschen" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tippe LÖSCHEN zur Bestätigung"), { target: { value: "löschen" } });
    expect(screen.getByRole("button", { name: "Halten zum Löschen" })).toBeInTheDocument();
  });

  it("sync card: 2FA pending and paused states point to the one fix", () => {
    signIn();
    patchSyncStatus({ phase: "locked" });
    const { rerender } = render(<KontoView />);
    fireEvent.click(screen.getByRole("button", { name: "Code eingeben" }));
    expect(useCloudSession.getState().sheet.view).toBe("mfa");
    act(() => patchSyncStatus({ phase: "paused" }));
    rerender(<KontoView />);
    fireEvent.click(screen.getByRole("button", { name: "Sync einschalten" }));
    expect(readPrivacy().sync).toBe(true);
  });
});

describe("AuthSheet", () => {
  it("validates locally, then shows the server's German error on the password field", async () => {
    openAuthSheet("signin", "card");
    render(
      <MotionRoot>
        <AuthSheet />
      </MotionRoot>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Anmelden" });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByText("Bitte gib deine E-Mail ein.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "trader@example.com" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "falsch" } });
    signInPassword.mockResolvedValueOnce({ ok: false, message: "E-Mail oder Passwort stimmt nicht.", field: "password" });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByText("E-Mail oder Passwort stimmt nicht.")).toBeInTheDocument();
    expect(signInPassword).toHaveBeenCalledWith("trader@example.com", "falsch");
    expect(dialog).toBeInTheDocument();
    signInPassword.mockResolvedValueOnce({ ok: true, value: { mfa: true } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(useCloudSession.getState().sheet.view).toBe("mfa"));
  });

  it("magic link → the 'sent' view with a resend countdown", async () => {
    openAuthSheet("magic", "card");
    render(
      <MotionRoot>
        <AuthSheet />
      </MotionRoot>,
    );
    await screen.findByRole("dialog", { name: "Magic Link" });
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "trader@example.com" } });
    sendMagicLink.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Link senden" }));
    await waitFor(() => expect(useCloudSession.getState().sheet).toMatchObject({ view: "sent", sent: "magic", email: "trader@example.com" }));
    expect(await screen.findByText(/Wir haben einen Anmelde-Link an trader@example.com geschickt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Erneut senden/ })).toBeDisabled();
  });
});

describe("AuthSheet – Registrierung mit Zustimmung (Review F07)", () => {
  it("a sign-up needs the AGB / Datenschutz box; the documents are links that open without ticking it", async () => {
    openAuthSheet("signup", "card");
    render(
      <MotionRoot>
        <AuthSheet />
      </MotionRoot>,
    );
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "neu@example.com" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "Sehr-sicheres-Passwort-42!" } });
    const consent = screen.getByTestId("signup-consent");
    expect(consent).toHaveAttribute("data-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
    expect(await screen.findByText("Bitte bestätige die AGB und die Datenschutzerklärung.")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
    // the links are real links to the operator's documents
    expect(consent.querySelector('[data-testid="legal-agb"]')).toHaveAttribute("href", "?rechtliches=agb");
    expect(consent.querySelector('[data-testid="legal-datenschutz"]')).toHaveAttribute("href", "?rechtliches=datenschutz");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(consent).toHaveAttribute("data-checked", "true");
    signUp.mockResolvedValueOnce({ ok: true, value: { confirm: true } });
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("neu@example.com", "Sehr-sicheres-Passwort-42!"));
  });

  it("signing in shows the documents as a note, no box", async () => {
    openAuthSheet("signin", "card");
    render(
      <MotionRoot>
        <AuthSheet />
      </MotionRoot>,
    );
    await screen.findByRole("dialog", { name: "Anmelden" });
    expect(screen.queryByTestId("signup-consent")).toBeNull();
    expect(screen.getByTestId("auth-legal-note")).toHaveTextContent("Es gelten die AGB und die Datenschutzerklärung des Betreibers.");
  });
});

describe("CodeSlots", () => {
  it("keeps digits only, max six, and completes once", () => {
    expect(cleanCode("12 34-56 78")).toBe("123456");
    const onChange = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(<CodeSlots value="" onChange={onChange} onComplete={onComplete} label="Code" />);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "12a3456" } });
    expect(onChange).toHaveBeenLastCalledWith("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
    rerender(<CodeSlots value="123456" onChange={onChange} onComplete={onComplete} label="Code" accepted />);
    expect(screen.getByLabelText("Code")).toHaveAttribute("autocomplete", "one-time-code");
  });
});

describe("PrivacyCard + banner", () => {
  it("switches persist; ranking needs an account", () => {
    useCloudSession.setState({ phase: "signedOut" });
    render(<PrivacyCard />);
    fireEvent.click(screen.getByRole("switch", { name: /Fehlerberichte senden/ }));
    expect(readPrivacy().telemetry).toBe(true);
    act(() => signIn());
    fireEvent.click(screen.getByRole("switch", { name: /In der Rangliste erscheinen/ }));
    expect(readPrivacy().leaderboard).toBe(true);
  });

  it("local banner with a cloud: talks about the login, not about claude.ai", () => {
    resetJournal();
    useUi.setState({ hideLocalBanner: false });
    useCloudSession.setState({ phase: "signedOut" });
    act(() => useJournal.setState({ mode: "local", storage: "ok" }));
    render(<LocalModeBanner />);
    expect(screen.getByText(/Melde dich an, dann ist dein Journal auf allen Geräten synchron/)).toBeInTheDocument();
    expect(screen.queryByText(/claude\.ai/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signin", source: "banner" });
  });
});
