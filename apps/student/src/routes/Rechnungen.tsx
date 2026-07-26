import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Card } from "@fahrschul/ui";
import { apiMutate, ApiError, OfflineError } from "../api/client.js";
import type { Rechnung } from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";
import { OfflineBanner } from "../components/OfflineBanner.js";

function formatCent(cent: number): string {
  return (cent / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/**
 * Rechnungen: read-only. Es gibt hier absichtlich KEINE
 * Bearbeiten/Bezahlt-markieren-Aktion – jede Mutation bleibt Rolle
 * "finanzen" vorbehalten (serverseitig erzwungen, siehe
 * apps/api/src/routes/invoices.ts). Der Zahlungslink ist ein
 * Mock-Platzhalter (kein echter Zahlungsanbieter, siehe
 * docs/integration-gaps.md).
 */
export function Rechnungen() {
  const online = useOnlineStatus();
  const { data, loading, offline } = useApiGet<{ invoices: Rechnung[] }>("/invoices/mine", "rechnungen", "zahlungen");
  const [inquiryFor, setInquiryFor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function sendInquiry(e: FormEvent, invoiceId: string) {
    e.preventDefault();
    setStatus(null);
    try {
      await apiMutate(`/invoices/${invoiceId}/inquiry`, "POST", { nachricht: message });
      setStatus("Rückfrage gesendet.");
      setMessage("");
      setInquiryFor(null);
    } catch (err) {
      if (err instanceof OfflineError) setStatus("Keine Verbindung – bitte später erneut versuchen.");
      else if (err instanceof ApiError) setStatus("Rückfrage konnte nicht gesendet werden.");
    }
  }

  if (loading) return <main className="screen"><p>Lädt…</p></main>;
  if (offline && !data) return <main className="screen"><OfflineBanner /></main>;

  return (
    <main className="screen">
      <h1>Rechnungen</h1>
      <OfflineBanner />
      {status ? <p role="status">{status}</p> : null}
      {data?.invoices.map((invoice) => (
        <Card key={invoice.id} title={`Rechnung ${formatCent(invoice.betragCent)}`}>
          <p>Status: {invoice.status}</p>
          {invoice.faelligAm ? <p>Fällig am: {new Date(invoice.faelligAm).toLocaleDateString("de-DE")}</p> : null}
          <ul>
            {invoice.positionen.map((pos) => (
              <li key={pos.id}>
                {pos.bezeichnung}: {formatCent(pos.gesamtpreisCent)}
              </li>
            ))}
          </ul>

          {invoice.status !== "bezahlt" ? (
            <p>
              <em>
                Sichere Zahlungsoption: Platzhalter (kein echter Zahlungsanbieter angebunden, siehe
                docs/integration-gaps.md).
              </em>
            </p>
          ) : null}

          {inquiryFor === invoice.id ? (
            <form onSubmit={(e) => sendInquiry(e, invoice.id)}>
              <label htmlFor={`inquiry-${invoice.id}`}>Rückfrage</label>
              <textarea
                id={`inquiry-${invoice.id}`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
              <Button type="submit" disabled={!online}>
                Senden
              </Button>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setInquiryFor(invoice.id)}>
              Rückfrage stellen
            </Button>
          )}
        </Card>
      ))}
      {data && data.invoices.length === 0 ? <p>Keine Rechnungen vorhanden.</p> : null}
    </main>
  );
}
