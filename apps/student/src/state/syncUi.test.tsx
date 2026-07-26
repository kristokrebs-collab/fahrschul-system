import { memoryKeyValueStore, type SyncTransport, type SyncTransportResult } from "@fahrschul/sync";
import { PendingOperations, SyncProvider, SyncStatusBar, useSync } from "@fahrschul/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stillerRealtimeTransport } from "../test/renderWithSync.js";

/**
 * PROMPT -1 §1/§7 – die ANZEIGE der Synchronisationszustände.
 *
 * Die Logik hat eigene Tests in `packages/sync`. Hier wird geprüft, dass sie
 * im Frontend auch ANKOMMT: Ein Zustand, den niemand sieht, ist kein Zustand –
 * und ein "erfolgreich", das ohne Serverbestätigung erscheint, ist genau der
 * Fehler, den §7 verbietet.
 */

const BENUTZER = "11111111-1111-4111-8111-111111111111";

function transport(overrides: Partial<SyncTransport> = {}): SyncTransport {
  return {
    online: () => true,
    async send(): Promise<SyncTransportResult> {
      return { status: 200, ok: true, body: {}, outcomeUnknown: false };
    },
    async identity() {
      return { benutzerId: BENUTZER };
    },
    async lookupOperation() {
      return { status: "unknown" as const };
    },
    ...overrides,
  };
}

function Harness({
  children,
  syncTransport,
}: {
  children?: React.ReactNode;
  syncTransport?: SyncTransport;
}) {
  return (
    <SyncProvider
      apiBase="http://localhost:4000"
      benutzerId={BENUTZER}
      storagePrefix="test:"
      store={memoryKeyValueStore()}
      realtimeTransport={stillerRealtimeTransport()}
      syncTransport={syncTransport ?? transport()}
      autoStart={false}
      queueIntervalMs={0}
    >
      <SyncStatusBar />
      <PendingOperations />
      {children}
    </SyncProvider>
  );
}

/** Kleiner Treiber, der beim Mounten einen Vorgang anlegt und absendet. */
function Treiber({
  art,
  path,
  method = "POST",
  onFertig,
}: {
  art: "draft" | "critical";
  path: string;
  method?: "POST" | "PATCH";
  onFertig?: (fehler: unknown) => void;
}) {
  const sync = useSync();
  const [gestartet, setGestartet] = useState(false);
  useEffect(() => {
    if (!sync.ready || gestartet) return;
    setGestartet(true);
    void (async () => {
      try {
        if (art === "draft") {
          const e = await sync.createDraft({
            method,
            path,
            body: { text: "Entwurfsinhalt" },
            bezeichnung: "Selbsteinschätzung",
          });
          sync.submitDraft(e.operationId);
        } else {
          await sync.createCritical({
            method,
            path,
            body: {},
            bezeichnung: "Terminangebot annehmen",
          });
        }
        await sync.flush();
        onFertig?.(null);
      } catch (err) {
        onFertig?.(err);
      }
    })();
  }, [sync, gestartet, art, path, method, onFertig]);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("§1 Statuszeile: Datenalter, Synchronisationsstatus, Offline, Entwürfe", () => {
  it("zeigt alle vier Angaben und den zusammengefassten Zustand", async () => {
    render(<Harness />);
    const bar = await screen.findByRole("status");
    expect(bar).toHaveAttribute("data-sync-status", "synced");
    // Ohne geladene Daten wird das ehrlich benannt, nicht als "aktuell" getarnt.
    expect(bar.textContent).toContain("Daten noch nicht geladen");
  });

  it("ein lokaler Entwurf ist in der Statuszeile sichtbar", async () => {
    render(
      <Harness syncTransport={transport({ online: () => false })}>
        <Treiber art="draft" path="/feedback/f1/self-assessment" method="PATCH" />
      </Harness>,
    );
    await waitFor(() => {
      const bar = screen.getByRole("status");
      expect(bar.textContent).toMatch(/wartend|Entwurf/);
    });
  });

  it("offline wird als Zustand gezeigt, nicht verschwiegen", async () => {
    render(<Harness syncTransport={transport({ online: () => false })} />);
    const bar = await screen.findByRole("status");
    await waitFor(() => expect(bar).toHaveAttribute("data-sync-status", "offline"));
    expect(bar.textContent).toContain("Offline");
  });
});

describe("§7 kritische Vorgänge in der Anzeige", () => {
  it("ein Konflikt erscheint als Konflikt – mit Serverangaben und OHNE automatische Auflösung", async () => {
    const gesendet: string[] = [];
    render(
      <Harness
        syncTransport={transport({
          async send(input) {
            gesendet.push(input.idempotencyKey);
            return {
              status: 409,
              ok: false,
              body: {
                error: "version_conflict",
                currentVersion: 5,
                conflictFields: ["endzeit"],
                current: { id: "t1" },
                message: "Datensatz wurde geändert",
              },
              outcomeUnknown: false,
            };
          },
        })}
      >
        <Treiber art="critical" path="/appointments/t1/cancel" />
      </Harness>,
    );

    // Zweimal sichtbar: in der Statuszeile (zusammengefasst) UND am Vorgang.
    await waitFor(() =>
      expect(screen.getAllByText(/Konflikt – Prüfung nötig/).length).toBeGreaterThanOrEqual(2),
    );
    // Fehlercode steht sowohl in der Metadatenliste (letzter Fehler) als auch
    // in der Konfliktbox – beides ist beabsichtigt.
    expect(screen.getAllByText(/version_conflict/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Serverversion 5/)).toBeInTheDocument();
    expect(screen.getByText(/Betroffene Felder: endzeit/)).toBeInTheDocument();
    expect(screen.getByText(/nichts automatisch überschrieben/i)).toBeInTheDocument();
    // Genau EIN Sendeversuch – ein Konflikt wird nicht automatisch wiederholt.
    expect(gesendet).toHaveLength(1);
  });

  it('ein unbekannter Ausgang zeigt "Status wird geprüft" – nie Erfolg', async () => {
    render(
      <Harness
        syncTransport={transport({
          async send() {
            // Abgesendet, keine Antwort: der Ausgang ist UNBEKANNT.
            return { status: 0, ok: false, body: null, outcomeUnknown: true };
          },
        })}
      >
        <Treiber art="critical" path="/finance/bank/b1/resolve" />
      </Harness>,
    );

    await waitFor(() =>
      expect(screen.getAllByText("Status wird geprüft").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Aktuell")).not.toBeInTheDocument();
    const bar = screen.getByRole("status");
    expect(bar).toHaveAttribute("data-outcome-unknown", "true");
  });

  it("ein kritischer Vorgang mit unbekanntem Ausgang lässt sich nur mit Bestätigung entfernen", async () => {
    render(
      <Harness
        syncTransport={transport({
          async send() {
            return { status: 0, ok: false, body: null, outcomeUnknown: true };
          },
        })}
      >
        <Treiber art="critical" path="/finance/bank/b1/resolve" />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByText(/Offene Vorgänge/)).toBeInTheDocument());
    // Es gibt KEINEN einfachen "Verwerfen"-Knopf, nur den bestätigenden.
    expect(screen.queryByRole("button", { name: "Verwerfen" })).not.toBeInTheDocument();
    const knopf = screen.getByRole("button", { name: /Ausgang geprüft/ });
    await act(async () => {
      await userEvent.click(knopf);
    });
    await waitFor(() => expect(screen.queryByText(/Offene Vorgänge/)).not.toBeInTheDocument());
  });

  it("ein nicht-kritischer Fehlschlag behält seinen Kontext und ist wiederholbar oder verwerfbar", async () => {
    render(
      <Harness
        syncTransport={transport({
          async send() {
            return { status: 400, ok: false, body: { error: "invalid_body" }, outcomeUnknown: false };
          },
        })}
      >
        <Treiber art="draft" path="/instructor/vehicle-issues" />
      </Harness>,
    );
    await waitFor(() =>
      expect(screen.getAllByText("Fehlgeschlagen").length).toBeGreaterThanOrEqual(2),
    );
    // Voller Kontext: letzter Fehler + Versuchszähler bleiben sichtbar.
    expect(screen.getByText("invalid_body")).toBeInTheDocument();
    expect(screen.getByText("Letzter Fehler")).toBeInTheDocument();
    expect(screen.getByText("Versuche")).toBeInTheDocument();
    // Beide Benutzeraktionen stehen zur Verfügung.
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verwerfen" })).toBeInTheDocument();
  });

  it("erst die Serverbestätigung räumt den Vorgang aus der Liste", async () => {
    render(
      <Harness>
        <Treiber art="critical" path="/appointment-offers/o1/accept" />
      </Harness>,
    );
    // Nach einer 2xx-Antwort ist nichts mehr offen (`synced` wird nicht als
    // offener Vorgang gelistet).
    await waitFor(() => expect(screen.queryByText(/Offene Vorgänge/)).not.toBeInTheDocument());
    const bar = screen.getByRole("status");
    expect(bar).toHaveAttribute("data-sync-status", "synced");
  });

  it("ein offline VERBOTENER kritischer Vorgang wird gar nicht angelegt", async () => {
    let fehler: unknown = undefined;
    render(
      <Harness syncTransport={transport({ online: () => false })}>
        <Treiber
          art="critical"
          path="/appointments/t1/cancel"
          onFertig={(e) => {
            fehler = e;
          }}
        />
      </Harness>,
    );
    await waitFor(() => expect(fehler).toBeTruthy());
    expect((fehler as Error).name).toBe("OfflineNotAllowedError");
    // Und in der Liste steht nichts – kein stilles Queuing eines Stornos.
    expect(screen.queryByText(/Offene Vorgänge/)).not.toBeInTheDocument();
  });
});

describe("§6 Refetch-Auslöser aus dem Kanal", () => {
  it("eine Kanalmeldung erhöht die Revision des betroffenen Themas – und nur die", async () => {
    let hooks: Parameters<ReturnType<typeof stillerRealtimeTransport>["openStream"]>[0] | null = null;
    const kanal = {
      ...stillerRealtimeTransport(),
      openStream(input: Parameters<ReturnType<typeof stillerRealtimeTransport>["openStream"]>[0]) {
        hooks = input;
        return { close() {} };
      },
    };

    function Anzeige() {
      const sync = useSync();
      return (
        <div>
          <span data-testid="termine">{sync.revisionOf("termine")}</span>
          <span data-testid="rechnungen">{sync.revisionOf("rechnungen")}</span>
          <span data-testid="resync">{sync.resyncRevision}</span>
        </div>
      );
    }

    render(
      <SyncProvider
        apiBase="http://localhost:4000"
        benutzerId={BENUTZER}
        storagePrefix="test-kanal:"
        store={memoryKeyValueStore()}
        realtimeTransport={kanal}
        syncTransport={transport()}
        queueIntervalMs={0}
      >
        <Anzeige />
      </SyncProvider>,
    );

    await waitFor(() => expect(hooks).not.toBeNull());
    expect(screen.getByTestId("termine").textContent).toBe("0");

    await act(async () => {
      hooks!.onHello({ cursor: 0, resyncRequired: false, resyncReason: null });
      hooks!.onChange({
        cursor: 1,
        eventId: "ev-1",
        eventType: "lesson.booked",
        dataType: "termine",
      });
    });

    await waitFor(() => expect(screen.getByTestId("termine").textContent).toBe("1"));
    // Nur das gemeldete Thema – kein pauschales Neuladen aller Ansichten.
    expect(screen.getByTestId("rechnungen").textContent).toBe("0");
    // Das Verbinden selbst löst genau eine Vollsynchronisation aus.
    expect(screen.getByTestId("resync").textContent).toBe("1");
  });
});
