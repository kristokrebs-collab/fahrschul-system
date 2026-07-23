import { useState } from "react";
import type { ChangeEvent } from "react";
import { Card } from "@fahrschul/ui";
import { apiUpload, ApiError, OfflineError } from "../api/client.js";
import type { Dokument } from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";
import { OfflineBanner } from "../components/OfflineBanner.js";

const DOC_TYPES = [
  { value: "sehtest", label: "Sehtest" },
  { value: "erste-hilfe", label: "Erste-Hilfe-Nachweis" },
  { value: "passbild", label: "Passbild" },
  { value: "sonstiges", label: "Sonstiges" },
];

/**
 * Sicherer Upload: geht als multipart/form-data an apps/api
 * (POST /documents), NIE als Base64 im Client-State (siehe
 * docs/security-risks.md Punkt 4). Datei-Typ/-Größe werden zusätzlich
 * clientseitig vorab geprüft (bessere UX), die verbindliche Prüfung liegt
 * serverseitig (siehe apps/api/src/routes/documents.ts).
 */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const MAX_BYTES = 10 * 1024 * 1024;

export function Dokumente() {
  const online = useOnlineStatus();
  const { data, offline, refresh } = useApiGet<{ documents: Dokument[] }>("/documents/mine");
  const [typ, setTyp] = useState("sehtest");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: ChangeEvent<HTMLInputElement>, reuploadId?: string) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);

    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Nur JPEG, PNG oder PDF sind erlaubt.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Datei ist zu groß (max. 10 MB).");
      return;
    }

    const form = new FormData();
    if (!reuploadId) form.append("typ", typ);
    form.append("file", file);

    setUploading(true);
    try {
      await apiUpload(reuploadId ? `/documents/${reuploadId}/reupload` : "/documents", form);
      refresh();
    } catch (err) {
      if (err instanceof OfflineError) setError("Keine Verbindung – Upload erst wieder online möglich.");
      else if (err instanceof ApiError) setError("Upload fehlgeschlagen (Format/Größe/Server geprüft).");
      else setError("Unbekannter Fehler beim Upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="screen">
      <h1>Dokumente</h1>
      <OfflineBanner />
      {offline && !data ? <p>Offline – Dokumentenliste ist gerade nicht verfügbar.</p> : null}

      <Card title="Neues Dokument hochladen">
        <label htmlFor="doc-type">Art</label>
        <select id="doc-type" value={typ} onChange={(e) => setTyp(e.target.value)}>
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <label htmlFor="doc-file">Datei (JPEG/PNG/PDF, max. 10 MB)</label>
        <input
          id="doc-file"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={handleUpload}
          disabled={!online || uploading}
        />
        {error ? <p role="alert">{error}</p> : null}
      </Card>

      {data?.documents.map((doc) => (
        <Card key={doc.id} title={doc.typ}>
          <p>Datei: {doc.dateiname}</p>
          <p>Status: {doc.status}</p>
          {doc.ablehnungsgrund ? <p role="alert">Ablehnungsgrund: {doc.ablehnungsgrund}</p> : null}
          {doc.gueltigBis ? <p>Gültig bis: {new Date(doc.gueltigBis).toLocaleDateString("de-DE")}</p> : null}
          {doc.status === "abgelehnt" && !doc.ersetztVonDokumentId ? (
            <>
              <label htmlFor={`reupload-${doc.id}`}>Erneut hochladen</label>
              <input
                id={`reupload-${doc.id}`}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                onChange={(e) => handleUpload(e, doc.id)}
                disabled={!online || uploading}
              />
            </>
          ) : null}
        </Card>
      ))}
      {data && data.documents.length === 0 ? <p>Noch keine Dokumente hochgeladen.</p> : null}
    </main>
  );
}
