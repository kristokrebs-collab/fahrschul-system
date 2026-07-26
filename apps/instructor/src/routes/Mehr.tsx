import { useEffect, useState } from "react";
import { Card, PendingOperations } from "@fahrschul/ui";
import { apiGet } from "../api/client.js";
import { useSession } from "../state/SessionContext.js";

interface Arbeitszeit {
  regel: { maxStundenProTag: string; maxStundenProWoche: string; minPauseMinuten: number } | null;
  heute: { planMinuten: number; istMinuten: number; maxMinuten: number; warnung: boolean };
}

export function Mehr() {
  const { user, logout, logoutAll } = useSession();
  const [arbeitszeit, setArbeitszeit] = useState<Arbeitszeit | null>(null);
  const [revoked, setRevoked] = useState<number | null>(null);

  useEffect(() => {
    apiGet<Arbeitszeit>("/instructor/arbeitszeit").then((res) => setArbeitszeit(res.data));
  }, []);

  return (
    <main className="screen">
      <h1>Mehr</h1>
      <p>
        Angemeldet als {user?.vorname} {user?.nachname}
      </p>

      <Card title="Arbeitszeit (Plan vs. Ist)">
        {arbeitszeit ? (
          <>
            <p>Heute geplant: {Math.round(arbeitszeit.heute.planMinuten)} min</p>
            <p>Heute tatsächlich: {Math.round(arbeitszeit.heute.istMinuten)} min</p>
            {arbeitszeit.heute.warnung ? <p role="alert">⚠️ Tageshöchstarbeitszeit überschritten.</p> : null}
          </>
        ) : (
          <p>Lädt…</p>
        )}
      </Card>

      <Card title="Sitzungen">
        <button type="button" className="fahrschul-btn" onClick={() => logout()}>
          Abmelden (dieses Gerät)
        </button>
        <button
          type="button"
          className="fahrschul-btn fahrschul-btn--danger"
          onClick={async () => setRevoked(await logoutAll())}
        >
          Überall abmelden
        </button>
        {revoked !== null ? <p role="status">{revoked} Sitzung(en) beendet.</p> : null}
      </Card>
    {/*
        PROMPT -1 §7: Prüf-Warteschlange. Kritische Konflikte (z. B. eine
        Fahrstunde, die inzwischen storniert wurde) werden hier vorgelegt –
        nicht automatisch aufgelöst.
      */}
      <PendingOperations />
      </main>
  );
}
