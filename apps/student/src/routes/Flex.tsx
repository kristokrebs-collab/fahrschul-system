import { Button, Card } from "@fahrschul/ui";
import { apiMutate, ApiError, OfflineError } from "../api/client.js";
import type { FlagsResponse, Terminangebot } from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";
import { OfflineBanner } from "../components/OfflineBanner.js";
import { useState } from "react";

interface FlexOffer {
  flex: { id: string; ablaufAt: string; status: string };
  offer: Terminangebot | null;
}

/**
 * Krebs Flex – Feature-Flag-gesteuert (hidden/pilot/live). "Faire
 * Verteilung" und "Stunden gespart" sind laut
 * docs/fachliche-bestaetigungen.md Punkt 8 unbestätigte Platzhalter, siehe
 * apps/api/src/routes/flex.ts.
 */
export function Flex() {
  const online = useOnlineStatus();
  const flags = useApiGet<FlagsResponse>("/flags");
  const state = flags.data?.flags.krebs_flex ?? "hidden";
  const offers = useApiGet<{ offers: FlexOffer[]; optedIn: boolean }>(state === "hidden" ? null : "/flex/offers", "flex", "angebote");
  const metrics = useApiGet<{ acceptedOffers: number; hoursSaved: number }>(state === "hidden" ? null : "/flex/metrics", "flex");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  if (flags.loading) return <main className="screen"><p>Lädt…</p></main>;
  if (state === "hidden") {
    return (
      <main className="screen">
        <h1>Krebs Flex</h1>
        <p>Diese Funktion ist aktuell nicht verfügbar.</p>
      </main>
    );
  }

  async function optIn() {
    setError(null);
    try {
      await apiMutate("/flex/opt-in", "POST");
      offers.refresh();
    } catch (err) {
      if (err instanceof OfflineError) setError("Keine Verbindung.");
      else setError("Opt-in aktuell nicht möglich.");
    }
  }

  async function accept(flexId: string) {
    setPending(flexId);
    setError(null);
    try {
      await apiMutate(`/flex/offers/${flexId}/accept`, "POST", {
        idempotencyKey: `flex-${flexId}-${Date.now()}`,
      });
      offers.refresh();
      metrics.refresh();
    } catch (err) {
      if (err instanceof OfflineError) setError("Keine Verbindung – Annahme erst wieder online möglich.");
      else if (err instanceof ApiError) setError("Angebot nicht mehr verfügbar.");
      offers.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="screen">
      <h1>Krebs Flex {state === "pilot" ? "(Pilot)" : ""}</h1>
      <OfflineBanner />
      <p>
        Kurzfristige Ausgleichstermine deines Fahrlehrers. Faire Verteilung/Metrik sind fachlich noch
        nicht final bestätigt (siehe docs/fachliche-bestaetigungen.md Punkt 8).
      </p>
      {error ? <p role="alert">{error}</p> : null}

      {!offers.data?.optedIn ? (
        <Button onClick={optIn} disabled={!online}>
          Teilnehmen (Opt-in)
        </Button>
      ) : (
        <>
          <Card title="Offene Flex-Angebote">
            {offers.data?.offers.length === 0 ? <p>Aktuell keine Flex-Angebote.</p> : null}
            <ul>
              {offers.data?.offers.map(({ flex, offer }) =>
                offer ? (
                  <li key={flex.id}>
                    <p>{new Date(offer.beginnAt).toLocaleString("de-DE")}</p>
                    <Button onClick={() => accept(flex.id)} disabled={!online || pending === flex.id}>
                      Annehmen
                    </Button>
                  </li>
                ) : null,
              )}
            </ul>
          </Card>
          <Card title="Stunden gespart (unbestätigte Metrik)">
            <p>{metrics.data?.hoursSaved ?? 0} Stunden über {metrics.data?.acceptedOffers ?? 0} angenommene Angebote.</p>
          </Card>
        </>
      )}
    </main>
  );
}
