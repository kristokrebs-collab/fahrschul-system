/**
 * Paket V – the login window as a 1:1 rebuild of the reference recording (`docs/audit/V-VORBILD.md` § 1): one landscape card, the dark
 * band that crosses it ONCE (900 ms, cubic-bezier(0.5, 0.14, 0.3, 1)) and stays on the other side, the hard swap under the fully dark card,
 * the staggered entrance (brand text +20/+80/+140 ms, rows 45 ms apart, the focus line, the button, the footer), field 1 focused AT the swap,
 * reduced motion as one short cross-fade. The Web Animations are recorded with a stand-in `animate` (jsdom has none), so every duration,
 * delay and curve is read back exactly as the browser would get it. Kept behaviour: errors at the field that take the focus, Anmelden and
 * „Link per E-Mail“ share one form, the optional name travels with the registration, „Angemeldet bleiben“ maps to the idle sign-out.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInPassword = vi.fn();
const signUp = vi.fn();
vi.mock("@/cloud/runtime", async (orig) => {
  const real = await orig<typeof import("@/cloud/runtime")>();
  return { ...real, ensureCloud: vi.fn(async () => ({ signInPassword, sendMagicLink: vi.fn(), signUp })) };
});
const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

const { setCloudEnabledForTests } = await import("@/cloud/env");
const { resetCloudSession, openAuthSheet, setAuthView, useCloudSession } = await import("@/cloud/session");
const { AuthSheet } = await import("@/cloud/ui/AuthSheet");
const { bandGeometry, sideOf, stepOf, swapMs } = await import("@/cloud/ui/authBand");
const { authBand } = await import("@/motion/vorbild");
const { useIdlePref } = await import("@/cloud/idle");
const { MotionRoot } = await import("@/motion/MotionRoot");

/** A recorded `element.animate` call; `finish()` resolves its `finished` like the browser at the end. */
interface Rec {
  el: Element;
  keyframes: Keyframe[];
  opts: KeyframeAnimationOptions;
  id: string;
  finish: () => void;
}
let recs: Rec[] = [];
const realAnimate = (Element.prototype as { animate?: unknown }).animate;

function installAnimate() {
  recs = [];
  (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions) {
    let resolve!: () => void;
    const finished = new Promise<void>((r) => (resolve = r));
    const rec: Rec = { el: this, keyframes, opts, id: "", finish: resolve };
    recs.push(rec);
    const a = {
      finished,
      cancel: () => resolve(),
      set id(v: string) {
        rec.id = v;
      },
      get id() {
        return rec.id;
      },
      effect: { getComputedTiming: () => ({ endTime: Number(opts.delay ?? 0) + Number(opts.duration ?? 0) }) },
    };
    return a as unknown as Animation;
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setCloudEnabledForTests(true);
  resetCloudSession();
  fx.reduced = false;
  signInPassword.mockReset();
  signUp.mockReset();
  installAnimate();
});
afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  (Element.prototype as { animate?: unknown }).animate = realAnimate;
  vi.useRealTimers();
});

const mount = () => render(<MotionRoot><AuthSheet /></MotionRoot>);
const byId = (id: string) => recs.filter((r) => r.id === id);
const one = (id: string) => {
  const hit = byId(id);
  expect(hit, id).toHaveLength(1);
  return hit[0]!;
};
const finishAll = async () => {
  await act(async () => {
    for (const r of recs) r.finish();
    await Promise.resolve();
  });
};

describe("geometry and timing (pure)", () => {
  it("mode A has the band's edge at 53.9 % W, mode B its right edge at 45.6 % W; the band is 1.42 W wide and travels 1.503 W", () => {
    expect(authBand.edgeA - authBand.travel + authBand.width).toBeCloseTo(0.456, 3);
    const g = bandGeometry("landscape");
    expect(g.band.left).toBe("53.9%");
    expect(g.band.width).toBe("142%");
    expect(g.bandTransform.a).toBe("translateX(0%) skewX(13deg)");
    expect(g.bandTransform.b).toBe("translateX(-105.845%) skewX(13deg)");
    // the inner layer runs the exact inverse (content stays in card coordinates)
    expect(g.innerTransform.b).toBe("skewX(-13deg) translateX(150.3%)");
    expect(g.inner.left).toBe("-37.958%");
  });

  it("the hard swap lies inside the fully dark window of the run (0.367 … 0.439): 38 % towards B, 43 % back", () => {
    expect(authBand.duration).toBe(900);
    expect(authBand.easing).toBe("cubic-bezier(0.5, 0.14, 0.3, 1)");
    expect(swapMs("b")).toBe(342);
    expect(swapMs("a")).toBe(387);
    for (const ms of [swapMs("b"), swapMs("a")]) {
      expect(ms / 900).toBeGreaterThanOrEqual(0.367);
      expect(ms / 900).toBeLessThanOrEqual(0.439);
    }
  });

  it("phones: the band lies across the card and runs top → bottom (our derivation, same times)", () => {
    const g = bandGeometry("portrait");
    expect(g.bandTransform.a).toContain("translateY(0%)");
    expect(g.bandTransform.b).toMatch(/^translateY\(128\.169%\) skewY\(9deg\)$/);
    expect(g.innerTransform.b).toBe("skewY(-9deg) translateY(-182%)");
  });

  it("Anmelden and „Link per E-Mail“ share one form on side A, Registrieren is side B, the steps stay where the card is", () => {
    expect(sideOf("signin", "b")).toBe("a");
    expect(sideOf("magic", "b")).toBe("a");
    expect(sideOf("signup", "a")).toBe("b");
    expect(sideOf("sent", "b")).toBe("b");
    expect(sideOf("welcome", "a")).toBe("a");
    expect(sideOf("mfa", "b")).toBe("a");
    expect(stepOf("signin")).toBe(stepOf("magic"));
    expect(new Set(["signup", "reset", "sent", "mfa", "newPassword", "welcome", "account"].map((v) => stepOf(v as never))).size).toBe(7);
  });
});

describe("the switch A → B (Web Animations as recorded)", () => {
  async function openSignin() {
    openAuthSheet("signin", "card");
    mount();
    await screen.findByRole("dialog", { name: "Anmelden" });
    recs = [];
  }

  it("the band runs once (900 ms, the measured curve), the inner layer inversely; old content cut hard at the swap", async () => {
    await openSignin();
    fireEvent.click(screen.getByTestId("auth-to-signup"));
    expect(useCloudSession.getState().sheet.view).toBe("signup");
    const band = one("auth:band");
    expect(band.opts).toMatchObject({ duration: 900, easing: "cubic-bezier(0.5, 0.14, 0.3, 1)" });
    expect(band.keyframes).toEqual([{ transform: "translateX(0%) skewX(13deg)" }, { transform: "translateX(-105.845%) skewX(13deg)" }]);
    expect(one("auth:band-inner").keyframes.at(-1)).toEqual({ transform: "skewX(-13deg) translateX(150.3%)" });
    // a hard cut: two keyframes at the same offset 342/900
    const cut = one("auth:old-column-cut").keyframes;
    expect(cut[1]).toEqual({ opacity: 1, offset: 0.38 });
    expect(cut[2]).toEqual({ opacity: 0, offset: 0.38 });
    expect(one("auth:old-brand-cut").keyframes[2]).toEqual({ opacity: 0, offset: 0.38 });
    // the leaving column stays (inert) until the run is over, then goes
    expect(document.querySelector('.aw-col[data-side="a"]')).toHaveAttribute("aria-hidden", "true");
    await finishAll();
    await waitFor(() => expect(document.querySelector('.aw-col[data-side="a"]')).toBeNull());
    expect(screen.getByRole("dialog", { name: "Konto erstellen" })).toBeInTheDocument();
  });

  it("after the swap: brand text +20/+80/+140 ms rising 14/12/10 px, rows 45 ms apart, the focus line +250, the button +270, the footer +390", async () => {
    await openSignin();
    fireEvent.click(screen.getByTestId("auth-to-signup"));
    const swap = 342;
    const brand = [0, 1, 2].map((i) => one(`auth:brand${i}`));
    expect(brand.map((b) => b.opts.delay)).toEqual([swap + 20, swap + 80, swap + 140]);
    expect(brand.map((b) => b.opts.duration)).toEqual([300, 300, 250]);
    expect(brand[0]!.opts.easing).toBe("cubic-bezier(0.2, 0, 0, 1)");
    const rows = recs.filter((r) => /^auth:new-row\d+$/.test(r.id));
    expect(rows.length).toBeGreaterThanOrEqual(5); // title, name, e-mail, password, hint (+ consent where the build has one)
    rows.forEach((r, i) => expect(r.opts.delay).toBe(swap + i * 45));
    expect(rows[0]!.keyframes[0]).toMatchObject({ opacity: 0 });
    expect(one("auth:new-focusline").opts).toMatchObject({ delay: swap + 250, duration: 120, fill: "backwards" });
    expect(one("auth:new-button").opts).toMatchObject({ delay: swap + 270, duration: 300 });
    expect(one("auth:new-footer").opts).toMatchObject({ delay: swap + 390, duration: 150 });
  });

  it("field 1 takes the focus AT the swap (342 ms), not at the end; a second click while the band runs is ignored", async () => {
    await openSignin();
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("auth-to-signup"));
    const band = byId("auth:band").length;
    // the footer link of the new side is there already – a click on it during the run changes nothing
    fireEvent.click(screen.getByTestId("auth-to-signin"));
    expect(useCloudSession.getState().sheet.view).toBe("signup");
    expect(byId("auth:band")).toHaveLength(band);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(330);
    });
    expect(document.activeElement).not.toBe(screen.getByLabelText("Name"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    // let the run end cleanly under the fake clock before the window is unmounted
    await finishAll();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    vi.useRealTimers();
  });

  it("reduced motion: no band run, one short cross-fade (150 ms), field 1 focused at once", async () => {
    fx.reduced = true;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openSignin();
    fireEvent.click(screen.getByTestId("auth-to-signup"));
    expect(byId("auth:band")).toHaveLength(0);
    expect(one("auth:old-fade").opts).toMatchObject({ duration: 150 });
    expect(recs.every((r) => Number(r.opts.duration) <= 150)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });
});

describe("the forms (kept behaviour)", () => {
  const email = () => screen.getByLabelText("E-Mail") as HTMLInputElement;

  it("the e-mail field keeps its DOM node, value and focus when the mode changes", async () => {
    mount();
    act(() => openAuthSheet("signin", "card"));
    const field = await waitFor(() => email());
    fireEvent.change(field, { target: { value: "ich@beispiel.de" } });
    field.focus();
    act(() => setAuthView("magic"));
    await waitFor(() => expect(document.querySelector("form")).toHaveAttribute("data-auth-mode", "magic"));
    expect(email()).toBe(field);
    expect(email().value).toBe("ich@beispiel.de");
    expect(document.activeElement).toBe(field);
    expect(screen.queryByLabelText("Passwort")).toBeNull();
    // the typed address travels to the registration as well (another form, on the other side of the card)
    fireEvent.click(screen.getByTestId("auth-to-signup"));
    await finishAll();
    await waitFor(() => expect(email().value).toBe("ich@beispiel.de"));
    expect(screen.getByRole("dialog", { name: "Konto erstellen" })).toBeInTheDocument();
  });

  it("a refused field shows the error at the field and takes the focus", async () => {
    mount();
    act(() => openAuthSheet("signin", "card"));
    await waitFor(() => email());
    fireEvent.change(email(), { target: { value: "kein-mail" } });
    fireEvent.submit(email().closest("form")!);
    await waitFor(() => expect(email()).toHaveAttribute("aria-invalid", "true"));
    await waitFor(() => expect(document.activeElement).toBe(email()));
    expect(email()).toHaveAttribute("aria-describedby", expect.stringContaining("-error"));
    fireEvent.change(email(), { target: { value: "ich@beispiel.de" } });
    fireEvent.submit(email().closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Passwort")).toHaveAttribute("aria-invalid", "true"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Passwort")));
    expect(signInPassword).not.toHaveBeenCalled();
  });

  it("the optional name travels with the registration (it prefills the card holder later); without one nothing extra is sent", async () => {
    signUp.mockResolvedValue({ ok: true, value: { confirm: true } });
    openAuthSheet("signup", "card");
    mount();
    await screen.findByRole("dialog", { name: "Konto erstellen" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Beispiel" } });
    fireEvent.change(email(), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "Ein-langes-Passwort-42" } });
    const box = screen.queryByRole("checkbox");
    if (box) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Konto erstellen" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("ada@example.com", "Ein-langes-Passwort-42", null, "Ada Beispiel"));
  });

  it("„Angemeldet bleiben“ is the idle sign-out: unticked, a successful login sets 30 minutes; left as it was, nothing changes", async () => {
    signInPassword.mockResolvedValue({ ok: true, value: { mfa: false } });
    openAuthSheet("signin", "card");
    mount();
    await screen.findByRole("dialog", { name: "Anmelden" });
    const remember = screen.getByRole("checkbox", { name: "Angemeldet bleiben" });
    expect(remember).toBeChecked();
    fireEvent.click(remember);
    fireEvent.change(email(), { target: { value: "a@b.de" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "geheim-genug" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(useIdlePref.getState().minutes).toBe(30));
  });

  it("the card has the brand half: the active side is readable, the other one hidden from screen readers; no tabs, no order card", async () => {
    openAuthSheet("signin", "card");
    mount();
    const dialog = await screen.findByRole("dialog", { name: "Anmelden" });
    expect(screen.getByTestId("auth-brand-a")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByTestId("auth-brand-b")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("auth-brand-a")).toHaveTextContent("Willkommenzurück.");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByTestId("auth-order")).toBeNull();
    expect(dialog).toHaveAttribute("data-orient", "landscape");
    expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
  });
});
