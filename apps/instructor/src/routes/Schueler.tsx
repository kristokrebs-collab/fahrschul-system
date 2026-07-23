import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client.js";

interface SchuelerRow {
  id: string;
  vorname: string;
  nachname: string;
}

export function Schueler() {
  const [rows, setRows] = useState<SchuelerRow[] | null>(null);

  useEffect(() => {
    apiGet<{ schueler: SchuelerRow[] }>("/instructor/schueler").then((res) => setRows(res.data.schueler));
  }, []);

  return (
    <main className="screen">
      <h1>Schüler</h1>
      {rows === null ? <p>Lädt…</p> : null}
      <ul>
        {rows?.map((s) => (
          <li key={s.id}>
            <Link to={`/schueler/${s.id}/briefing`}>
              {s.vorname} {s.nachname}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
