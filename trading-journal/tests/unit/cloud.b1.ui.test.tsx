/**
 * B1 UI: the data-takeover dialog (choice, numbers, working, done, undo), the recovery codes (shown once, closed only after
 * "gesichert"), the lost-device path in the 2FA step, and the operator's sync pause in the sync card.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const undoTakeover = vi.fn(async () => true);
const recoveryStatus = vi.fn(async () => ({ ok: true as const, value: { total: 0, remaining: 0, createdAt: null } }));
const generateRecoveryCodes = vi.fn(async () => ({ ok: true as const, value: { codes: ["ABCDE-FGHJK", "KMNPQ-RSTUV"], createdAt: "2026-11-07T10:00:00Z" } }));
const redeemRecoveryCode = vi.fn(async (code: string): Promise<{ ok: true } | { ok: false; message: string; field: null }> => (code.startsWith("OK") ? { ok: true } : { ok: false, message: "Dieser Code passt nicht oder wurde schon benutzt.", field: null }));
vi.mock("@/cloud/runtime", async (orig) => {
  const real = await orig<typeof import("@/cloud/runtime")>();
  return { ...real, ensureCloud: vi.fn(async () => ({ undoTakeover, recoveryStatus, generateRecoveryCodes, redeemRecoveryCode, syncNow: async () => true, listSessions: async () => ({ ok: true, value: [] }), signOutScope: async () => ({ ok: true }) })) };
});

const { setCloudEnabledForTests } = await import("@/cloud/env");
const { resetCloudSession, useCloudSession, openAuthSheet } = await import("@/cloud/session");
const { normalizeSettings, normalizeTrade } = await import("@/domain/normalize");
const { toRemoteDoc } = await import("@/cloud/sync/reconcile");
const { previewTakeover } = await import("@/cloud/sync/takeover");
const { answerTakeover, requestTakeover, resetTakeover, takeoverHooks, useTakeover } = await import("@/cloud/takeover");
const { OPS_SYNC_PAUSED, useOpsFlags } = await import("@/cloud/flags");
const { patchSyncStatus, resetSyncStatus } = await import("@/cloud/sync/status");
const { AuthSheet } = await import("@/cloud/ui/AuthSheet");
const { RecoverySection } = await import("@/cloud/ui/RecoverySection");
const { SyncStatusCard } = await import("@/cloud/ui/SyncStatusCard");
const { TakeoverDialog } = await import("@/cloud/ui/TakeoverDialog");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { mkTrade } = await import("./domain.fixtures");

const T = (id: string, over: object = {}) => normalizeTrade(mkTrade({ id, date: `2026-10-0${id.length}T10:00`, entry: 100 + id.length, exit: 110, size: 1000, ...over }));

function preview(cloud: ReturnType<typeof T>[]) {
  const remote = new Map(cloud.map((t) => [`trade:${t.id}`, toRemoteDoc({ kind: "trade", id: t.id, data: t, deleted: false, rev: 1, updated_at: "u" })!]));
  return previewTakeover({ local: { trades: [T("t_1"), T("t_22"), T("t_333")], hyblock: [], days: {}, settings: normalizeSettings(null) }, remote, settingsRow: null, otherOwner: false });
}

beforeEach(() => {
  localStorage.clear();
  setCloudEnabledForTests(true);
  resetCloudSession();
  resetTakeover();
  resetSyncStatus();
  useOpsFlags.setState({ sync: false, calls: false, ai: false, checkout: false, loaded: false });
  undoTakeover.mockClear();
  redeemRecoveryCode.mockClear();
});
afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetTakeover();
});

describe("TakeoverDialog", () => {
  it("shows the numbers of both sides and four options; the recommended one is preselected; the answer reaches the engine", async () => {
    render(
      <MotionRoot>
        <TakeoverDialog />
      </MotionRoot>,
    );
    const asked = requestTakeover(preview([T("t_1"), T("t_4444", { date: "2026-10-04T10:00" })]));
    const dialog = await screen.findByRole("dialog", { name: "Daten aus diesem Browser" });
    // 3 here, 2 in the account: 1 equal, 2 only here, 1 only there
    const table = within(dialog).getByRole("table");
    expect(within(table).getByRole("row", { name: /Trades 3 2/ })).toBeInTheDocument();
    const radios = within(dialog).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["merge", "local", "cloud", "keep"]);
    expect(radios.find((r) => (r as HTMLInputElement).checked)).toHaveProperty("value", "merge");
    expect(within(dialog).getByText("Empfohlen")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/2 Einträge ins Konto/).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(within(dialog).getByTestId("takeover-cloud"));
    fireEvent.click(within(dialog).getByTestId("takeover-apply"));
    expect(await asked).toBe("cloud");
    expect(useTakeover.getState().phase).toBe("working");
    expect(await screen.findByTestId("takeover-working")).toBeInTheDocument();
  });

  it("working → done: the summary, the undo button, and a click that calls the engine; closing is possible only then", async () => {
    render(
      <MotionRoot>
        <TakeoverDialog />
      </MotionRoot>,
    );
    const asked = requestTakeover(preview([T("t_1")]));
    await screen.findByTestId("takeover-choose");
    act(() => answerTakeover("merge"));
    await asked;
    act(() => takeoverHooks.step("upload"));
    patchSyncStatus({ progress: { done: 1, total: 2 } });
    expect(await screen.findByText("1 von 2")).toBeInTheDocument();
    act(() => takeoverHooks.done({ choice: "merge", pushed: 2, pulled: 0, conflicts: 0, duplicates: 1, undoUntil: new Date(Date.now() + 600_000).toISOString() }));
    const done = await screen.findByTestId("takeover-done");
    expect(within(done).getByText(/2 Einträge ins Konto/)).toBeInTheDocument();
    expect(within(done).getByText(/1 Doppelter übersprungen/)).toBeInTheDocument();
    fireEvent.click(within(done).getByTestId("takeover-undo"));
    await waitFor(() => expect(undoTakeover).toHaveBeenCalledTimes(1));
  });

  it("'Später entscheiden' keeps the journal local; a failure shows the reason and a way out", async () => {
    render(
      <MotionRoot>
        <TakeoverDialog />
      </MotionRoot>,
    );
    const asked = requestTakeover(preview([T("t_1")]));
    fireEvent.click(await screen.findByRole("button", { name: "Später entscheiden" }));
    expect(await asked).toBe("keep");

    const again = requestTakeover(preview([T("t_1")]));
    await screen.findByTestId("takeover-choose");
    act(() => answerTakeover("local"));
    await again;
    act(() => takeoverHooks.failed("Sync gerade nicht möglich."));
    const err = await screen.findByTestId("takeover-error");
    expect(within(err).getByRole("alert")).toHaveTextContent("Sync gerade nicht möglich.");
    expect(within(err).getByText(/unverändert/)).toBeInTheDocument();
  });

  it("a journal of another account offers only 'Nur Cloud' and 'Lokal behalten'", async () => {
    render(
      <MotionRoot>
        <TakeoverDialog />
      </MotionRoot>,
    );
    const p = { ...preview([T("t_1")]), otherOwner: true, allowed: ["cloud", "keep"] as const, recommended: "cloud" as const };
    void requestTakeover({ ...p, allowed: [...p.allowed] });
    const dialog = await screen.findByRole("dialog", { name: "Journal eines anderen Kontos" });
    expect(within(dialog).getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["cloud", "keep"]);
    expect(within(dialog).getByText(/nie in dieses Konto hochgeladen/)).toBeInTheDocument();
  });
});

describe("RecoverySection", () => {
  it("shows the codes once, with copy and file; 'Fertig' only after the user says they are stored; then they are gone", async () => {
    render(<RecoverySection />);
    fireEvent.click(await screen.findByTestId("recovery-create"));
    const panel = await screen.findByTestId("recovery-codes");
    expect(within(panel).getByText("ABCDE-FGHJK")).toBeInTheDocument();
    expect(within(panel).getByText(/nur jetzt/)).toBeInTheDocument();
    const done = within(panel).getByRole("button", { name: "Fertig" });
    expect(done).toBeDisabled();
    fireEvent.click(within(panel).getByTestId("recovery-saved"));
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(screen.queryByText("ABCDE-FGHJK")).toBeNull();
    expect(generateRecoveryCodes).toHaveBeenCalledTimes(1);
  });

  it("with a set already: the count, and a new set asks first (the old ones stop working)", async () => {
    recoveryStatus.mockResolvedValueOnce({ ok: true, value: { total: 8, remaining: 6, createdAt: "2026-11-01T10:00:00Z" } });
    render(<RecoverySection />);
    expect(await screen.findByText("Noch 6 von 8 Codes übrig")).toBeInTheDocument();
    expect(screen.queryByTestId("recovery-create")).toBeNull();
    expect(screen.getByRole("button", { name: "Neue Codes erzeugen" })).toBeInTheDocument();
  });
});

describe("lost device in the 2FA step", () => {
  function open() {
    useCloudSession.setState({ phase: "signedIn", user: { id: "u1", email: "t@x.test", aal: "aal1", mfaEnrolled: true }, needsMfa: true, factors: [{ id: "f", friendlyName: null, status: "verified", createdAt: null }], sessionId: "s1" });
    openAuthSheet("mfa", "card");
    render(
      <MotionRoot>
        <AuthSheet />
      </MotionRoot>,
    );
  }

  it("a recovery code field replaces the app code; a wrong code says so, a right one ends the second factor", async () => {
    open();
    const dialog = await screen.findByRole("dialog", { name: "Zwei-Faktor-Code" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerät verloren? Wiederherstellungscode nutzen" }));
    const field = await within(dialog).findByLabelText("Wiederherstellungscode");
    fireEvent.change(field, { target: { value: "falsch-falsch" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Code einlösen" }));
    expect(await within(dialog).findByText("Dieser Code passt nicht oder wurde schon benutzt.")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "OKAAA-BBBBB" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Code einlösen" }));
    await waitFor(() => expect(redeemRecoveryCode).toHaveBeenLastCalledWith("OKAAA-BBBBB"));
    await waitFor(() => expect(useCloudSession.getState().sheet.view).toBe("welcome"));
  });

  it("the way back to the app code is there, and the no-codes case is explained honestly", async () => {
    open();
    const dialog = await screen.findByRole("dialog", { name: "Zwei-Faktor-Code" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerät verloren? Wiederherstellungscode nutzen" }));
    expect(within(dialog).getByText(/kann nur der Betreiber/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Zurück zum App-Code" }));
    expect(await within(dialog).findByLabelText("2FA-Code")).toBeInTheDocument();
  });
});

describe("operator pause of the sync", () => {
  it("the sync card says the operator switched the sync off – no button that cannot work", () => {
    useCloudSession.setState({ phase: "signedIn", user: { id: "u1", email: "t@x.test", aal: "aal1", mfaEnrolled: false }, sessionId: "s1" });
    patchSyncStatus({ phase: "paused" });
    useOpsFlags.setState({ sync: true });
    render(
      <MotionRoot>
        <SyncStatusCard />
      </MotionRoot>,
    );
    expect(screen.getByTestId("sync-ops-paused")).toHaveTextContent(OPS_SYNC_PAUSED);
    expect(screen.queryByRole("button", { name: "Sync einschalten" })).toBeNull();
  });
});
