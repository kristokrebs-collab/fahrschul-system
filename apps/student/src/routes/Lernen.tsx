import { Button, Card } from "@fahrschul/ui";
import { apiMutate, OfflineError } from "../api/client.js";
import type { Lernressource } from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";
import { OfflineBanner } from "../components/OfflineBanner.js";

const TYPE_LABEL: Record<Lernressource["typ"], string> = {
  video: "Video",
  hoerbuch: "Hörbuch",
  simulator: "Simulator",
  kurs: "Theoriekurs",
  gefahrentraining: "Gefahrentraining",
};

/**
 * Lernen-Tab: Lerninhalte kommen als Domain-Ressourcen aus
 * GET /learning/resources (siehe packages/domain/src/curriculum.ts
 * lernressourceSchema) – keine hartcodierten Videos/Standorte. Es gibt hier
 * bewusst KEINE Inhalte zu einer "geheimen Prüfungsstrecke" (Non-Negotiable).
 */
export function Lernen() {
  const online = useOnlineStatus();
  const { data, loading, offline, refresh } = useApiGet<{ resources: Lernressource[] }>("/learning/resources");

  async function markVisited(id: string) {
    if (!online) return;
    try {
      await apiMutate(`/learning/resources/${id}/visit`, "POST");
      refresh();
    } catch (err) {
      if (!(err instanceof OfflineError)) refresh();
    }
  }

  return (
    <main className="screen">
      <h1>Lernen</h1>
      <OfflineBanner />
      {loading ? <p>Lädt…</p> : null}
      {offline && !data ? <p>Offline – zeige zuletzt geladene Inhalte, sobald verfügbar.</p> : null}
      {data?.resources.map((resource) => (
        <Card key={resource.id} title={resource.titel}>
          <p>
            {TYPE_LABEL[resource.typ]}
            {resource.ort ? ` · ${resource.ort}` : ""}
          </p>
          {resource.beschreibung ? <p>{resource.beschreibung}</p> : null}
          <p>Status: {resource.fortschritt === "besucht" ? "besucht" : "offen"}</p>
          {resource.fortschritt === "offen" ? (
            <Button onClick={() => markVisited(resource.id)} disabled={!online}>
              Als besucht markieren
            </Button>
          ) : null}
        </Card>
      ))}
      {data && data.resources.length === 0 ? <p>Noch keine Lerninhalte hinterlegt.</p> : null}
    </main>
  );
}
