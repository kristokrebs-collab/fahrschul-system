import { Card } from "@fahrschul/ui";
import { DataState } from "../components/DataState.js";
import { useApiGet } from "../state/useApiGet.js";

interface QueueItem {
  id: string;
  bucket: "sofort" | "heute" | "diese_woche";
  grund: string;
  prioritaet: "hoch" | "mittel" | "niedrig";
  frist: string | null;
  verantwortlicher: string;
  aktion: string;
  entitaet: string;
  entitaetId: string;
}

interface HeuteResponse {
  items: QueueItem[];
  counts: { sofort: number; heute: number; diese_woche: number };
  dataAsOf: string;
  hinweis: string;
}

const BUCKETS: Array<{ key: QueueItem["bucket"]; label: string }> = [
  { key: "sofort", label: "Sofort" },
  { key: "heute", label: "Heute" },
  { key: "diese_woche", label: "Diese Woche" },
];

export function Heute() {
  const { data, loading, error, reload } = useApiGet<HeuteResponse>("/office/heute");

  return (
    <div>
      <header className="page-header">
        <h1>Heute-Queue</h1>
        <button className="fahrschul-btn fahrschul-btn--secondary" onClick={reload}>
          Aktualisieren
        </button>
      </header>
      <DataState loading={loading} error={error} />
      {data ? (
        <>
          <p className="dim">Stand: {new Date(data.dataAsOf).toLocaleString("de-DE")}</p>
          <div className="queue-grid">
            {BUCKETS.map((bucket) => (
              <Card key={bucket.key} title={`${bucket.label} (${data.counts[bucket.key]})`}>
                <ul className="queue-list">
                  {data.items
                    .filter((i) => i.bucket === bucket.key)
                    .map((item) => (
                      <li key={item.id} className={`queue-item queue-item--${item.prioritaet}`}>
                        <div className="queue-item__grund">{item.grund}</div>
                        <div className="queue-item__meta">
                          <span>Priorität: {item.prioritaet}</span>
                          {item.frist ? <span>Frist: {new Date(item.frist).toLocaleString("de-DE")}</span> : null}
                          <span>Verantwortlich: {item.verantwortlicher}</span>
                        </div>
                        <div className="queue-item__aktion">Aktion: {item.aktion}</div>
                      </li>
                    ))}
                  {data.items.filter((i) => i.bucket === bucket.key).length === 0 ? (
                    <li className="dim">Nichts offen – alles im grünen Bereich.</li>
                  ) : null}
                </ul>
              </Card>
            ))}
          </div>
          <p className="dim hinweis">{data.hinweis}</p>
        </>
      ) : null}
    </div>
  );
}
