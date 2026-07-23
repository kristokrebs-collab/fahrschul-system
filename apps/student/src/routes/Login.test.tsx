import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Login } from "./Login.js";
import { SessionProvider } from "../state/SessionContext.js";

describe("Login screen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has properly labelled fields (accessible name via <label for>) and no self-registration form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: null }), { status: 401 })));

    render(
      <MemoryRouter>
        <SessionProvider>
          <Login />
        </SessionProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("E-Mail")).toBeInTheDocument();
    expect(screen.getByLabelText("Passwort")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Anmelden/ })).toBeInTheDocument();
    // Keine Registrierungsfelder (kein Self-Signup-Endpunkt in apps/api, siehe
    // docs/student-app-final-qa.md).
    expect(screen.queryByLabelText(/Registrieren/i)).not.toBeInTheDocument();
  });

  it("submits credentials and asks for a TOTP token when the API demands MFA", async () => {
    const fetchMock = vi
      .fn()
      // useSession() initial /me check
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: null }), { status: 401 }))
      // login attempt
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "mfa_setup_required" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SessionProvider>
          <Login />
        </SessionProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-Mail"), "buero@example.test");
    await user.type(screen.getByLabelText("Passwort"), "irrelevant-in-this-test");
    await user.click(screen.getByRole("button", { name: /Anmelden/ }));

    expect(await screen.findByLabelText("Bestätigungscode")).toBeInTheDocument();
  });
});
