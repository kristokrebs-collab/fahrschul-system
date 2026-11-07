/**
 * Login/Signup-Morph (R11): the three entry modes are ONE mounted form (e-mail value and DOM node survive a switch, the password
 * manager sees one form), the fields only one mode has come and go, the autocomplete hints follow the mode, a refused field takes
 * the focus, and the step map treats the 2FA step as its own step.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInPassword = vi.fn();
vi.mock("@/cloud/runtime", async (orig) => {
  const real = await orig<typeof import("@/cloud/runtime")>();
  return { ...real, ensureCloud: vi.fn(async () => ({ signInPassword, sendMagicLink: vi.fn(), signUp: vi.fn() })) };
});
const fx = vi.hoisted(() => ({ reduced: true }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

const { setCloudEnabledForTests } = await import("@/cloud/env");
const { resetCloudSession, openAuthSheet, setAuthView, useCloudSession } = await import("@/cloud/session");
const { AuthSheet } = await import("@/cloud/ui/AuthSheet");
const { stepOf, slideDir, MODE_ORDER } = await import("@/cloud/ui/AuthMorph");
const { MotionRoot } = await import("@/motion/MotionRoot");

beforeEach(() => {
  localStorage.clear();
  setCloudEnabledForTests(true);
  resetCloudSession();
  signInPassword.mockReset();
});
afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
});

const mount = () => render(<MotionRoot><AuthSheet /></MotionRoot>);
const email = () => screen.getByLabelText("E-Mail") as HTMLInputElement;

describe("step map", () => {
  it("anmelden / link / registrieren are one step, every other view is its own", () => {
    expect(stepOf("signin")).toBe("entry");
    expect(stepOf("magic")).toBe("entry");
    expect(stepOf("signup")).toBe("entry");
    expect(stepOf("mfa")).toBe("mfa");
    expect(stepOf("sent")).toBe("sent");
    expect(new Set(["reset", "mfa", "newPassword", "welcome", "account"].map((v) => stepOf(v as never))).size).toBe(5);
  });
  it("the slide goes forward along the order and back against it", () => {
    expect(slideDir("signup", "signin")).toBe(1);
    expect(slideDir("signin", "signup")).toBe(-1);
    expect(slideDir("mfa", "signin")).toBe(1);
    expect(Object.keys(MODE_ORDER)).toContain("mfa");
  });
});

describe("one form for the entry modes", () => {
  it("the e-mail field keeps its DOM node, value and focus when the mode changes", async () => {
    mount();
    act(() => openAuthSheet("signin", "card"));
    const field = await waitFor(() => email());
    fireEvent.change(field, { target: { value: "ich@beispiel.de" } });
    field.focus();
    act(() => setAuthView("signup"));
    await waitFor(() => expect(document.querySelector("form")).toHaveAttribute("data-auth-mode", "signup"));
    expect(email()).toBe(field);
    expect(email().value).toBe("ich@beispiel.de");
    expect(document.activeElement).toBe(field);
    act(() => setAuthView("magic"));
    expect(email()).toBe(field);
  });

  it("password hints follow the mode: signin → current-password / username, signup → new-password / email", async () => {
    mount();
    act(() => openAuthSheet("signin", "card"));
    const pw = () => screen.getByLabelText("Passwort") as HTMLInputElement;
    await waitFor(() => expect(pw()).toBeInTheDocument());
    expect(pw()).toHaveAttribute("autocomplete", "current-password");
    expect(pw()).toHaveAttribute("name", "password");
    expect(email()).toHaveAttribute("autocomplete", "username");
    expect(email()).toHaveAttribute("name", "email");
    const node = pw();
    act(() => setAuthView("signup"));
    expect(pw()).toBe(node); // same input, so the manager still sees one login form
    expect(pw()).toHaveAttribute("autocomplete", "new-password");
    expect(email()).toHaveAttribute("autocomplete", "email");
  });

  it("the password field goes away in „Link per E-Mail“ and a focus inside it moves to the e-mail field", async () => {
    mount();
    act(() => openAuthSheet("signin", "card"));
    const pw = await waitFor(() => screen.getByLabelText("Passwort") as HTMLInputElement);
    pw.focus();
    act(() => setAuthView("magic"));
    await waitFor(() => expect(screen.queryByLabelText("Passwort")).toBeNull());
    expect(document.activeElement).toBe(email());
  });

  it("a refused field shows the error at the field and takes the focus", async () => {
    mount();
    act(() => openAuthSheet("signin", "card"));
    await waitFor(() => email());
    fireEvent.change(email(), { target: { value: "kein-mail" } });
    fireEvent.submit(email().closest("form")!);
    await waitFor(() => expect(email()).toHaveAttribute("aria-invalid", "true"));
    await waitFor(() => expect(document.activeElement).toBe(email()));
    fireEvent.change(email(), { target: { value: "ich@beispiel.de" } });
    fireEvent.submit(email().closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Passwort")).toHaveAttribute("aria-invalid", "true"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Passwort")));
    expect(signInPassword).not.toHaveBeenCalled();
  });

  it("2FA is its own step: a successful password login with a second factor swaps the form for the code step", async () => {
    signInPassword.mockResolvedValue({ ok: true, value: { mfa: true } });
    mount();
    act(() => openAuthSheet("signin", "card"));
    await waitFor(() => email());
    fireEvent.change(email(), { target: { value: "ich@beispiel.de" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "geheim-genug-1" } });
    fireEvent.submit(email().closest("form")!);
    await waitFor(() => expect(useCloudSession.getState().sheet.view).toBe("mfa"));
    await waitFor(() => expect(document.querySelector("[data-auth-morph='mfa']")).not.toBeNull());
  });
});
