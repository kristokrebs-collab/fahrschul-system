import { useState } from "react";
import { Button, Card } from "@fahrschul/ui";
import { apiMutate, OfflineError } from "../api/client.js";
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
  const { data, loading, refresh } = useApiGet<{ feedback: FeedbackEintrag[] }>("/feedback/mine");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function saveSelfAssessment(id: string) {
    const text = drafts[id];
    if (!text) return;
    setSavingId(id);
    try {
      await apiMutate(`/feedback/${id}/self-assessment`, "PATCH", { text });
      refresh();
    } catch (err) {
      if (!(err instanceof OfflineError)) refresh();
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <main className="screen"><p>Lädt…</p></main>;

  return (
    <main className="screen">
      <h1>Fahrstundenfeedback</h1>
      <OfflineBanner />
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
