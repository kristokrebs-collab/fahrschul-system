import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Layout } from "./Layout.js";
import { SessionProvider } from "../state/SessionContext.js";

// Der eigentliche Session-Fetch (/me) schlägt in der Testumgebung fehl
// (kein Netzwerk) – SessionProvider fällt dann auf user:null zurück, das
// Layout selbst rendert die Navigation trotzdem (Auth-Gate liegt in App.tsx,
// nicht in Layout.tsx).
describe("Layout", () => {
  it("renders all eleven required navigation entries", async () => {
    render(
      <MemoryRouter initialEntries={["/heute"]}>
        <SessionProvider>
          <Routes>
            <Route path="/*" element={<Layout />}>
              <Route path="heute" element={<div>Heute-Inhalt</div>} />
            </Route>
          </Routes>
        </SessionProvider>
      </MemoryRouter>,
    );

    const expectedLabels = [
      "Heute",
      "Planung",
      "Schüler",
      "Prüfungen",
      "Dokumente",
      "Zahlungen",
      "Leads/CRM",
      "Kommunikation",
      "Ressourcen",
      "Auswertungen",
      "Audit",
    ];
    for (const label of expectedLabels) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }
  });
});
