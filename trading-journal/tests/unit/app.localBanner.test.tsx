/**
 * Local mode since Etappe 1a: the ordinary `Lokaler Modus.` hint is a small header badge (`LocalModeBadge`, a tap opens the
 * explanation with the same sentences); only without usable storage the red `Speichern nicht möglich.` banner with the
 * backup import/export path remains (not dismissible).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalModeBadge } from "@/app/LocalModeBadge";
import { LOCAL_BANNER_TEXT, LocalModeBanner, NO_STORAGE_EXPORT, NO_STORAGE_IMPORT, NO_STORAGE_STRONG, useLocalBannerOpen } from "@/app/LocalModeBanner";
import { resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

function Probe() {
  return <span data-testid="open">{String(useLocalBannerOpen())}</span>;
}

describe("LocalModeBanner (only the red variant) and the header badge", () => {
  beforeEach(() => {
    resetJournal();
    useUi.setState({ hideLocalBanner: false });
  });
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  it("local mode with storage: no banner at all – the badge carries the hint, a tap explains it", async () => {
    act(() => useJournal.setState({ mode: "local", storage: "ok" }));
    render(<><LocalModeBanner /><LocalModeBadge /><Probe /></>);
    expect(screen.queryByText("Lokaler Modus.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("open")).toHaveTextContent("false");
    const badge = screen.getByTestId("local-badge");
    expect(badge).toHaveAccessibleName("Lokaler Modus – Erklärung öffnen");
    expect(screen.queryByTestId("local-badge-panel")).toBeNull();
    fireEvent.click(badge);
    const panel = await screen.findByTestId("local-badge-panel");
    expect(panel.textContent).toContain("Trades bleiben nur in diesem Browser");
    // nothing to dismiss any more: no close-the-banner preference is written
    expect(useUi.getState().hideLocalBanner).toBe(false);
  });

  it("no storage: `Speichern nicht möglich.` with import / export, shown even when the old hint was dismissed; no badge", () => {
    useUi.setState({ hideLocalBanner: true });
    act(() => useJournal.setState({ mode: "local", storage: "unavailable" }));
    render(<><LocalModeBanner /><LocalModeBadge /><Probe /></>);
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(screen.queryByTestId("local-badge")).toBeNull();
    const banner = screen.getByText(NO_STORAGE_STRONG).closest('[role="status"]')!;
    expect(banner.textContent).toContain("Änderungen gehen beim Schließen verloren");
    expect(screen.queryByRole("button", { name: "Hinweis schließen" })).toBeNull();
    expect(screen.getByRole("button", { name: NO_STORAGE_EXPORT })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: NO_STORAGE_IMPORT }));
    expect(screen.getByRole("dialog", { name: "Backup importieren" })).toBeInTheDocument();
  });

  it("standalone web build without cloud: no claude.ai advice, the backup path instead (review F8)", async () => {
    act(() => useJournal.setState({ mode: "local", storage: "ok" }));
    render(<LocalModeBadge />);
    fireEvent.click(screen.getByTestId("local-badge"));
    const text = (await screen.findByTestId("local-badge-panel")).textContent!;
    expect(text).not.toContain("claude.ai");
    expect(text).toContain("Trades bleiben nur in diesem Browser auf diesem Gerät.");
    expect(text).toContain("Nutze Backup (JSON) unter Einstellungen → Daten.");
  });

  it("inside the claude.ai runtime the PR #3 sentence stays word for word", async () => {
    (window as unknown as { claude?: unknown }).claude = { use: () => Promise.resolve(null) };
    act(() => useJournal.setState({ mode: "local", storage: "ok" }));
    render(<LocalModeBadge />);
    fireEvent.click(screen.getByTestId("local-badge"));
    const text = (await screen.findByTestId("local-badge-panel")).textContent!;
    expect(text).toContain(LOCAL_BANNER_TEXT.trim());
    expect(text).not.toContain("Nutze Backup (JSON)");
  });

  it("cloud / connecting: no banner and no badge", () => {
    act(() => useJournal.setState({ mode: "cloud", storage: "ok" }));
    render(<><LocalModeBanner /><LocalModeBadge /><Probe /></>);
    expect(screen.getByTestId("open")).toHaveTextContent("false");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("local-badge")).toBeNull();
  });
});
