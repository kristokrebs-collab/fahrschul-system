/**
 * `LocalModeBanner` variants: the normal `Lokaler Modus.` hint (dismissible) and, without usable storage, the red
 * `Speichern nicht möglich.` banner with the backup import/export path (not dismissible).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_BANNER_TEXT, LocalModeBanner, NO_STORAGE_EXPORT, NO_STORAGE_IMPORT, NO_STORAGE_STRONG, useLocalBannerOpen } from "@/app/LocalModeBanner";
import { resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

function Probe() {
  return <span data-testid="open">{String(useLocalBannerOpen())}</span>;
}

describe("LocalModeBanner", () => {
  beforeEach(() => {
    resetJournal();
    useUi.setState({ hideLocalBanner: false });
  });
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  it("local mode with storage: dismissible `Lokaler Modus.` hint", () => {
    act(() => useJournal.setState({ mode: "local", storage: "ok" }));
    render(<><LocalModeBanner /><Probe /></>);
    expect(screen.getByText("Lokaler Modus.")).toBeInTheDocument();
    expect(screen.queryByText(NO_STORAGE_STRONG)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hinweis schließen" }));
    expect(useUi.getState().hideLocalBanner).toBe(true);
    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });

  it("no storage: `Speichern nicht möglich.` with import / export, shown even when the hint was dismissed", () => {
    useUi.setState({ hideLocalBanner: true });
    act(() => useJournal.setState({ mode: "local", storage: "unavailable" }));
    render(<><LocalModeBanner /><Probe /></>);
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    const banner = screen.getByText(NO_STORAGE_STRONG).closest('[role="status"]')!;
    expect(banner.textContent).toContain("Änderungen gehen beim Schließen verloren");
    expect(screen.queryByRole("button", { name: "Hinweis schließen" })).toBeNull();
    expect(screen.getByRole("button", { name: NO_STORAGE_EXPORT })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: NO_STORAGE_IMPORT }));
    expect(screen.getByRole("dialog", { name: "Backup importieren" })).toBeInTheDocument();
  });

  it("standalone web build without cloud: no claude.ai advice, the backup path instead (review F8)", () => {
    act(() => useJournal.setState({ mode: "local", storage: "ok" }));
    render(<LocalModeBanner />);
    const text = screen.getByText("Lokaler Modus.").closest('[role="status"]')!.textContent!;
    expect(text).not.toContain("claude.ai");
    expect(text).toContain("Trades bleiben nur in diesem Browser auf diesem Gerät.");
    expect(text).toContain("Nutze Backup (JSON) unter Einstellungen → Daten.");
  });

  it("inside the claude.ai runtime the PR #3 sentence stays word for word", () => {
    (window as unknown as { claude?: unknown }).claude = { use: () => Promise.resolve(null) };
    act(() => useJournal.setState({ mode: "local", storage: "ok" }));
    render(<LocalModeBanner />);
    const text = screen.getByText("Lokaler Modus.").closest('[role="status"]')!.textContent!;
    expect(text).toContain(LOCAL_BANNER_TEXT.trim());
    expect(text).not.toContain("Nutze Backup (JSON)");
  });

  it("cloud / connecting: no banner", () => {
    act(() => useJournal.setState({ mode: "cloud", storage: "ok" }));
    render(<><LocalModeBanner /><Probe /></>);
    expect(screen.getByTestId("open")).toHaveTextContent("false");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
