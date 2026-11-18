import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRIVACY, onPrivacyChange, PRIVACY_KEY, resyncPrivacy, setPrivacy, usePrivacy } from "@/cloud/privacy";
import { PrivacyCard } from "@/cloud/ui/PrivacyCard";

const fx = vi.hoisted(() => ({ reduced: true }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

beforeEach(() => {
  localStorage.removeItem(PRIVACY_KEY);
  usePrivacy.setState({ ...DEFAULT_PRIVACY });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("setPrivacy resolves whether the change is stored where it must be", () => {
  it("true when this device took it and nobody objects; the local value is set at once", async () => {
    const p = setPrivacy({ telemetry: true });
    expect(usePrivacy.getState().telemetry).toBe(true);
    expect(await p).toBe(true);
    expect(JSON.parse(localStorage.getItem(PRIVACY_KEY)!)).toMatchObject({ telemetry: true });
  });

  it("false when the account mirror says no (the local value stays, honestly reported)", async () => {
    const off = onPrivacyChange(async () => false);
    expect(await setPrivacy({ leaderboard: true })).toBe(false);
    expect(usePrivacy.getState().leaderboard).toBe(true);
    off();
  });

  it("false when a mirror throws; a change that changes nothing is true without asking anyone", async () => {
    const ask = vi.fn();
    const off = onPrivacyChange(() => {
      ask();
      throw new Error("offline");
    });
    expect(await setPrivacy({ telemetry: true })).toBe(false);
    ask.mockClear();
    expect(await setPrivacy({ telemetry: true })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    off();
  });

  it("false when this device's storage refuses the write", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(await setPrivacy({ telemetry: true })).toBe(false);
    spy.mockRestore();
  });

  it("silent adoption from the profile never asks the mirror", async () => {
    const ask = vi.fn();
    const off = onPrivacyChange(ask);
    expect(await setPrivacy({ leaderboard: true }, { silent: true })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    off();
  });

  it("resyncPrivacy offers the account keys again and reports the answer", async () => {
    let ok = false;
    const seen: string[][] = [];
    const off = onPrivacyChange(async (_, changed) => {
      seen.push([...changed]);
      return ok;
    });
    expect(await resyncPrivacy()).toBe(false);
    ok = true;
    expect(await resyncPrivacy()).toBe(true);
    expect(seen[0]).toEqual(["telemetry", "leaderboard"]);
    off();
  });
});

describe("PrivacyCard: the ✓ follows the answer, not the click", () => {
  it("shows saving while the account has not answered, saved after it said yes", async () => {
    let answer!: (v: boolean) => void;
    const off = onPrivacyChange(
      () =>
        new Promise<boolean>((res) => {
          answer = res;
        }),
    );
    render(<PrivacyCard />);
    fireEvent.click(screen.getByRole("switch", { name: /Fehlerberichte|anonym/i }));
    expect(document.querySelector("[data-save-pill='saving']")).not.toBeNull();
    expect(document.querySelector("[data-save-pill='saved']")).toBeNull();
    await act(async () => {
      answer(true);
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(document.querySelector("[data-save-pill='saved']")).not.toBeNull();
    off();
  });

  it("an account that refuses ends in the failed state with „Erneut versuchen“", async () => {
    const off = onPrivacyChange(async () => false);
    render(<PrivacyCard />);
    fireEvent.click(screen.getByRole("switch", { name: /Fehlerberichte|anonym/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(document.querySelector("[data-save-pill='failed']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
    expect(document.querySelector("[data-save-pill='saved']")).toBeNull();
    off();
  });
});
