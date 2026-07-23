import { useState } from "react";
import { Button, Card } from "@fahrschul/ui";
import { apiMutate, ApiError, OfflineError } from "../api/client.js";
import type { FlagsResponse, Terminangebot, Terminbuchung } from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";
import { OfflineBanner } from "../components/OfflineBanner.js";
import { WunschzeitenEditor } from "../components/WunschzeitenEditor.js";

interface Filters {
  kurzfristig: boolean;
  samstag: boolean;
  automatik: boolean;
}

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.kurzfristig) params.set("kurzfristig", "true");
  if (filters.samstag) params.set("samstag", "true");
  if (filters.automatik) params.set("automatik", "true");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Termine-Tab: echte API-Kalenderdaten mit exaktem Zeitfenster, Filtern,
 * Annahme/Ablehnung. Annahme ruft AUSSCHLIESSLICH den serverseitigen
 * Endpunkt auf (POST /appointment-offers/:id/accept), der die
 * race-sichere, transaktionale Konfliktprüfung aus Prompt 0 wiederverwendet
 * – es gibt hier keinerlei clientseitige Buchungslogik.
 */
export function Termine() {
  const online = useOnlineStatus();
  const [filters, setFilters] = useState<Filters>({ kurzfristig: false, samstag: false, automatik: false });
  const offers = useApiGet<{ offers: Terminangebot[]; dataAsOf: string }>(`/appointment-offers${buildQuery(filters)}`);
  const mine = useApiGet<{ appointments: Terminbuchung[] }>("/appointments/mine");
  const flags = useApiGet<FlagsResponse>("/flags");
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function accept(offerId: string) {
    setActionError(null);
    setPending(offerId);
    try {
      await apiMutate(`/appointment-offers/${offerId}/accept`, "POST", {
        idempotencyKey: `accept-${offerId}-${Date.now()}`,
      });
      offers.refresh();
      mine.refresh();
    } catch (err) {
      if (err instanceof OfflineError) {
        setActionError("Keine Verbindung – Annahme erst wieder online möglich.");
      } else if (err instanceof ApiError) {
        setActionError(
          err.body && typeof err.body === "object" && "reason" in err.body
            ? `Nicht mehr verfügbar (${String((err.body as { reason: unknown }).reason)})`
            : "Dieses Angebot ist gerade nicht mehr verfügbar.",
        );
        offers.refresh();
      } else {
        setActionError("Annahme aktuell nicht möglich.");
      }
    } finally {
      setPending(null);
    }
  }

  async function decline(offerId: string) {
    setPending(offerId);
    try {
      await apiMutate(`/appointment-offers/${offerId}/decline`, "POST");
      offers.refresh();
    } catch {
      setActionError("Ablehnen aktuell nicht möglich.");
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="screen">
      <h1>Termine</h1>
      <OfflineBanner />

      <Card title="Meine Termine">
        {mine.data?.appointments.length ? (
          <ul>
            {mine.data.appointments
              .filter((a) => a.status !== "cancelled")
              .map((a) => (
                <li key={a.id}>
                  {new Date(a.beginnAt).toLocaleString("de-DE")} – {a.art}
                </li>
              ))}
          </ul>
        ) : (
          <p>Noch keine bestätigten Termine.</p>
        )}
      </Card>

      <Card title="Offene Terminangebote">
        <fieldset className="filters">
          <legend>Filter</legend>
          <label>
            <input
              type="checkbox"
              checked={filters.kurzfristig}
              onChange={(e) => setFilters((f) => ({ ...f, kurzfristig: e.target.checked }))}
            />
            Kurzfristig verfügbar
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.samstag}
              onChange={(e) => setFilters((f) => ({ ...f, samstag: e.target.checked }))}
            />
            Samstag
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.automatik}
              onChange={(e) => setFilters((f) => ({ ...f, automatik: e.target.checked }))}
            />
            Automatik
          </label>
        </fieldset>

        {actionError ? <p role="alert">{actionError}</p> : null}

        {offers.loading ? <p>Lädt…</p> : null}
        {offers.data?.offers.length === 0 ? <p>Keine passenden Angebote.</p> : null}
        <ul>
          {offers.data?.offers.map((offer) => (
            <li key={offer.id} className="offer-card">
              <p>
                {new Date(offer.beginnAt).toLocaleString("de-DE")} – {new Date(offer.endeAt).toLocaleTimeString("de-DE")}
              </p>
              <p>{offer.art}{offer.treffpunkt ? ` · ${offer.treffpunkt}` : ""}{offer.automatik ? " · Automatik" : ""}</p>
              {offer.ablaufAt ? <p>Angebot läuft ab: {new Date(offer.ablaufAt).toLocaleString("de-DE")}</p> : null}
              <div className="offer-card__actions">
                <Button
                  onClick={() => accept(offer.id)}
                  disabled={!online || pending === offer.id}
                  aria-label={`Angebot am ${new Date(offer.beginnAt).toLocaleString("de-DE")} annehmen`}
                >
                  Annehmen
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => decline(offer.id)}
                  disabled={!online || pending === offer.id}
                  aria-label={`Angebot am ${new Date(offer.beginnAt).toLocaleString("de-DE")} ablehnen`}
                >
                  Ablehnen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <WunschzeitenEditor />

      {flags.data?.flags.krebs_flex && flags.data.flags.krebs_flex !== "hidden" ? (
        <Card title="Krebs Flex (Pilot)">
          <p>Kurzfristige Ausgleichstermine – siehe Mehr-Tab für Opt-in und Details.</p>
        </Card>
      ) : null}
    </main>
  );
}
