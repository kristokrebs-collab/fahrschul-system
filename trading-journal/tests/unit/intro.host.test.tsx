import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntroStageProps } from "@/intro/IntroStage";

const boot = vi.hoisted(() => ({ autoplay: true, replay: true }));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), restoreScroll: vi.fn() }));

vi.mock("@/intro/introBoot", async (orig) => ({
  ...(await orig<typeof import("@/intro/introBoot")>()),
  canAutoplay: () => boot.autoplay,
  canReplay: () => boot.replay,
}));
vi.mock("@/store/router", () => nav);
// the stage itself needs real layout and a canvas; here it is a stub that exposes the host's callbacks
vi.mock("@/intro/IntroStage", () => ({
  IntroStage: ({ covering, directorRef, onBuild, onDone, onSkip }: IntroStageProps) => {
    directorRef.current = { skip: () => onDone(), destroy: () => {} };
    return (
      <div role="dialog" aria-label="Intro" data-intro-stage="" data-covering={String(covering)}>
        <button type="button" onClick={onSkip}>
          Überspringen
        </button>
        <button type="button" onClick={onBuild}>
          build
        </button>
      </div>
    );
  },
}));

const { IntroHost, resetIntroBootForTests } = await import("@/intro/IntroHost");
const { getIntroPhase, replayIntro, setIntroPhase, skipIntro } = await import("@/intro/introStore");

function mount() {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  const utils = render(<IntroHost />, { container: root });
  return { root, ...utils };
}

describe("IntroHost", () => {
  beforeEach(() => {
    sessionStorage.clear();
    boot.autoplay = true;
    boot.replay = true;
    nav.navigate.mockClear();
    nav.restoreScroll.mockClear();
    resetIntroBootForTests();
    setIntroPhase("off");
  });
  afterEach(() => {
    document.getElementById("root")?.remove();
    act(() => setIntroPhase("off"));
  });

  it("autoplay: stage phase, session flag set, app root inert; skip settles to done and restores the app", () => {
    const { root, unmount } = mount();
    expect(getIntroPhase()).toBe("stage");
    expect(sessionStorage.getItem("tj2-intro")).toBe("1");
    expect(root).toHaveAttribute("inert");
    expect(screen.getByRole("dialog", { name: "Intro" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Überspringen" }));
    expect(getIntroPhase()).toBe("done");
    expect(root).not.toHaveAttribute("inert");
    expect(screen.queryByRole("dialog", { name: "Intro" })).toBeNull();
    unmount();
  });

  it("phases stage → build → done; Esc / Enter / Space skip during the stage", () => {
    mount();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(getIntroPhase()).toBe("done");
    act(() => replayIntro());
    expect(getIntroPhase()).toBe("stage");
    fireEvent.click(screen.getByRole("button", { name: "build" }));
    expect(getIntroPhase()).toBe("build");
    expect(document.getElementById("root")).not.toHaveAttribute("inert");
    expect(screen.getByRole("dialog", { name: "Intro" })).toHaveAttribute("data-covering", "false");
    // during the build only Esc skips – Enter / Space belong to the app again
    fireEvent.keyDown(window, { key: " " });
    expect(getIntroPhase()).toBe("build");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(getIntroPhase()).toBe("done");
  });

  it("skipIntro() command settles too", () => {
    mount();
    act(() => skipIntro());
    expect(getIntroPhase()).toBe("done");
  });

  it("no autoplay → phase off, renders nothing; replay navigates to the overview top and plays", () => {
    boot.autoplay = false;
    mount();
    expect(getIntroPhase()).toBe("off");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => replayIntro());
    expect(nav.navigate).toHaveBeenCalledWith("overview");
    expect(nav.restoreScroll).toHaveBeenCalledWith("overview", true);
    expect(getIntroPhase()).toBe("stage");
  });

  it("replay is refused where it may not play (reduced motion / jsdom), but still lands on the overview top", () => {
    boot.autoplay = false;
    boot.replay = false;
    mount();
    act(() => replayIntro());
    expect(nav.navigate).toHaveBeenCalledWith("overview");
    expect(nav.restoreScroll).toHaveBeenCalledWith("overview", true);
    expect(getIntroPhase()).toBe("off");
  });
});
