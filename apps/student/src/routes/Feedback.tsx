import { useState } from "react";
import { Button, Card } from "@fahrschul/ui";
import { SyncBadge, useSync } from "@fahrschul/ui";
import { apiMutate, OfflineError, OfflineNotAllowedError } from "../api/client.js";
import type { FeedbackEintrag } from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";
import { OfflineBanner } from "../components/OfflineBanner.js";

/**
 * Fahrstundenfeedback: zeigt AUSSCHLIESSLICH die vom Server freigegebenen
 * Felder (siehe apps/api/src/routes/feedback.ts – interne Notizen werden
 * dort gar nicht erst selektiert, nicht nur hier ausgeblendet).
 */
export function Feedback() {
  const online = useOnlineStatus();
  const sync = useSync();
  const { data, loading, refresh } = useApiGet<{ feedback: FeedbackEintrag[] }>("/feedback/mine", "feedback");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  /**
   * PROMPT -1 §8: Die Selbsteinschätzung ist eine der VIER offline erlaubten
   * Entwurfsarten (`schueler_selbsteinschaetzung`). Sie wird deshalb immer
   * zuerst als verschlüsselter lokaler Entwurf gespeichert und dann gesendet.
   * Offline bleibt sie ein Entwurf – sichtbar in der Statuszeile – statt
   * einen Erfolg zu behaupten oder verloren zu gehen.
   */
  async function saveSelfAssessment(id: string) {
    const text = drafts[id];
    if (!text) return;
    setSavingId(id);
    try {
      const entwurf = await sync.createDraft({
        method: "PATCH",
        path: `/feedback/${id}/self-assessment`,
        body: { text },
        bezeichnung: "Selbsteinschätzung",
        target: id,
      });
      sync.submitDraft(entwurf.operationId);
      if (!online) return;
      await apiMutate(
        `/feedback/${id}/self-assessment`,
        "PATCH",
        { text },
        { idempotencyKey: entwurf.idempotencyKey },
      );
      sync.discard(entwurf.operationId, { force: true });
      refresh();
    } catch (err) {
      // Offline/nicht erlaubt: der Entwurf bleibt in der Warteschlange und
      // wird nach der Wiederverbindung idempotent gesendet.
      if (!(err instanceof OfflineError) && !(err instanceof OfflineNotAllowedError)) refresh();
    } finally {
      setSavingId(null);
    }
  }

  const offeneEntwuerfe = sync.entries.filter(
    (e) => e.draftKind === "schueler_selbsteinschaetzung" && e.status !== "synced",
  );

  if (loading) return <main className="screen"><p>Lädt…</p></main>;

  return (
    <main className="screen">
      <h1>Fahrstundenfeedback</h1>
      <OfflineBanner />
      {offeneEntwuerfe.length > 0 ? (
        <Card title="Nicht übertragene Selbsteinschätzungen">
          <ul>
            {offeneEntwuerfe.map((e) => (
              <li key={e.operationId}>
                {new Date(e.createdAt).toLocaleString("de-DE")} <SyncBadge entry={e} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data?.feedback.length === 0 ? <p>Noch kein Feedback vorhanden.</p> : null}
      {data?.feedback.map((fb) => (
        <Card key={fb.id} title={new Date(fb.createdAt).toLocaleDateString("de-DE")}>
          {fb.wentWell ? <p>Das lief gut: {fb.wentWell}</p> : null}
          {fb.workOn ? <p>Daran arbeiten wir: {fb.workOn}</p> : null}
          {fb.nextGoal ? <p>Nächstes Lernziel: {fb.nextGoal}</p> : null}
          {fb.studentSelfAssessment ? (
            <p>Deine Selbsteinschätzung: {fb.studentSelfAssessment}</p>
          ) : (
            <div>
              <label htmlFor={`self-${fb.id}`}>Deine Selbsteinschätzung (optional)</label>
              <textarea
                id={`self-${fb.id}`}
                value={drafts[fb.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [fb.id]: e.target.value }))}
              />
              <Button onClick={() => saveSelfAssessment(fb.id)} disabled={!online || savingId === fb.id}>
                Speichern
              </Button>
            </div>
          )}
        </Card>
      ))}
    </main>
  );
}
