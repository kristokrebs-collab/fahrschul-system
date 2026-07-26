import { useEffect, useState } from "react";
import { Button, Card } from "@fahrschul/ui";
import { apiMutate, ApiError, OfflineError } from "../api/client.js";
import { useApiGet } from "../state/useApiGet.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";

interface Eintrag {
  wochentag: number;
  startzeit: string;
  endzeit: string;
}

const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** Ersetzt die 6-Wochen-Tagesperioden-Matrix aus app.html durch exakte Zeitfenster. */
export function WunschzeitenEditor() {
  const online = useOnlineStatus();
  const { data, refresh } = useApiGet<{ wunschzeiten: Eintrag[] }>("/me/wunschzeiten", "wunschzeiten");
  const [entries, setEntries] = useState<Eintrag[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setEntries(data.wunschzeiten);
  }, [data]);

  function addEntry() {
    setEntries((e) => [...e, { wochentag: 0, startzeit: "16:00", endzeit: "18:00" }]);
  }

  function updateEntry(index: number, patch: Partial<Eintrag>) {
    setEntries((e) => e.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function removeEntry(index: number) {
    setEntries((e) => e.filter((_, i) => i !== index));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await apiMutate("/me/wunschzeiten", "PUT", { eintraege: entries });
      refresh();
    } catch (err) {
      if (err instanceof OfflineError) setError("Keine Verbindung – Speichern erst wieder online möglich.");
      else if (err instanceof ApiError) setError("Konnte nicht gespeichert werden.");
      else setError("Unbekannter Fehler.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Wunschzeiten">
      <ul>
        {entries.map((entry, index) => (
          <li key={index}>
            <label>
              Wochentag
              <select
                value={entry.wochentag}
                onChange={(e) => updateEntry(index, { wochentag: Number(e.target.value) })}
              >
                {WOCHENTAGE.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Von
              <input type="time" value={entry.startzeit} onChange={(e) => updateEntry(index, { startzeit: e.target.value })} />
            </label>
            <label>
              Bis
              <input type="time" value={entry.endzeit} onChange={(e) => updateEntry(index, { endzeit: e.target.value })} />
            </label>
            <Button variant="danger" onClick={() => removeEntry(index)} aria-label="Wunschzeit entfernen">
              Entfernen
            </Button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
      <Button variant="secondary" onClick={addEntry}>
        Wunschzeit hinzufügen
      </Button>
      <Button onClick={save} disabled={!online || saving}>
        {saving ? "Speichert…" : "Speichern"}
      </Button>
    </Card>
  );
}
