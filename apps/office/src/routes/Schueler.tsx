import { useState } from "react";
import { Link } from "react-router-dom";
import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";

interface SchuelerRow {
  id: string;
  vorname: string;
  nachname: string;
  status: string;
}

/** Schüler-Liste, paginiert (Spec: "100+ students rendering/paginating sanely"). */
export function Schueler() {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const { data, loading, error } = useApiGet<{ schueler: SchuelerRow[]; total: number }>(
    `/office/schueler?page=${page}&pageSize=${pageSize}`,
    [page],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <header className="page-header">
        <h1>Schüler</h1>
      </header>
      <DataState loading={loading} error={error} />
      {data ? (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.schueler.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.vorname} {s.nachname}
                  </td>
                  <td>{s.status}</td>
                  <td>
                    <Link to={`/schueler/${s.id}`}>Öffnen</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Zurück
            </button>
            <span>
              Seite {page} / {totalPages} ({data.total} Schüler)
            </span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Weiter
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
