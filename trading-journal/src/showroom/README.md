# `src/showroom` – der Showroom (Paket S)

Nur für Netlify-Deploy-Previews und `npm run build:showroom` (Schalter `__TJ_SHOWROOM__`, Vite `define`). In jedem anderen Build ist nichts davon im Bundle
(`tests/unit/showroom.bundle.test.ts`). Ausführlich: [`docs/SHOWROOM.md`](../../docs/SHOWROOM.md).

| Datei | Aufgabe |
|---|---|
| `install.ts` | läuft vor dem App-Start: Banner, Erstbesuch-Seed, Mock-Backend, `fetch` / `WebSocket` ersetzen, Übergabe an „Stripe“ umleiten |
| `banner.ts` | der feste Banner (reines DOM, erhöht `--safe-bottom` um seinen Streifen) |
| `seed.ts`, `runtime.ts` | Speicher (`tj2-showroom*`), Zurücksetzen, Zustand der UI |
| `mock/*Core.ts`, `mock/http.ts`, `mock/synth.ts` | transportfreie Mock-Handler – dieselben benutzen die e2e-Mocks (`tests/e2e/mocks/*`) |
| `mock/backend.ts`, `mock/fakeSockets.ts`, `mock/demoJournal.ts` | Routing aller Hosts, WebSockets, das erfundene Demo-Journal |
| `ui/ShowroomHost.tsx` (+ `jumps.ts`, `DemoCheckout.tsx`, `showroom.css`) | Panel „Neu in dieser Version“, Mail-Knopf, Demo-Zahlungsseite – ein lazy Chunk mit eigenem Stylesheet |

Regeln: kein Aufruf an einen echten Dienst (ein fremder Host schlägt wie offline fehl); neue UI nur in `ui/` mit Klassen `sr-…` im eigenen Stylesheet (nie Tailwind-Klassen – sie
landeten im Haupt-CSS); nichts außerhalb dieses Ordners nennt den Showroom außer den zwei Stellen hinter `__TJ_SHOWROOM__` (`main.tsx`, `App.tsx`), der Deklaration in `env.d.ts` und dem
Hook-Namen in `billing/api.ts`.
