import { useEffect, useState } from "react";

/**
 * Platzhalter-App für "Fahrlehrer-App" (Rolle: Fahrlehrer). Reale Fachlogik folgt in
 * Prompt 1-4 (siehe docs/architecture-report.md). Dieser Health-Check zeigt
 * lediglich, dass Build/Dev-Server laufen und die API erreichbar ist.
 */
export function App() {
  const [apiStatus, setApiStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
    fetch(`${apiBase}/health`)
      .then((res) => (res.ok ? setApiStatus("ok") : setApiStatus("error")))
      .catch(() => setApiStatus("error"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Fahrlehrer-App</h1>
      <p>Platzhalter-App (Rolle: Fahrlehrer) – Prompt 0 Grundgerüst.</p>
      <p>
        API-Status: <strong>{apiStatus}</strong>
      </p>
    </main>
  );
}
