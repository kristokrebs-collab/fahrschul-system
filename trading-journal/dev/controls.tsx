import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import "../src/styles/themes.css";
import { MotionRoot } from "@/motion/MotionRoot";
import { Button, type ButtonVariant } from "@/primitives/Button";
import { chipClass } from "@/primitives/chip";
import { CopyButton } from "@/primitives/CopyButton";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Stepper } from "@/primitives/Stepper";
import { useActionStatus } from "@/primitives/useActionStatus";

/*
 * Dev harness of the Runde-10 controls: `/dev/controls.html` under `npm run dev` (`?theme=light`, `?rich=0` for a page without
 * `[data-rich]`). Every button state on every variant (rest, success, error, loading, disabled), the live `useActionStatus` flow,
 * chips with their tick, a search field with its ×, a field with an error, the stepper and the copy buttons.
 */
const params = new URLSearchParams(location.search);
if (params.get("theme") === "light") document.documentElement.dataset.theme = "light";
const rich = params.get("rich") !== "0";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="label">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function Live() {
  const { status, run } = useActionStatus();
  const [fail, setFail] = useState(false);
  return (
    <>
      <Button variant="primary" status={status} onClick={() => void run(() => new Promise<boolean>((r) => setTimeout(() => r(!fail), 700)))}>
        Speichern
      </Button>
      <label className="flex items-center gap-2 text-[12px] text-mute">
        <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} /> fehlschlagen lassen
      </label>
    </>
  );
}

function Harness() {
  const [chips, setChips] = useState<Record<string, boolean>>({ a: true, b: false, c: true });
  const [q, setQ] = useState("break");
  const [seats, setSeats] = useState(3);
  return (
    <MotionRoot>
      <div data-rich={rich ? "" : undefined} className="mx-auto grid max-w-[880px] gap-6 p-6 text-fg">
        <h1 className="text-[22px] font-semibold">Bedienelemente</h1>
        {(["rest", "success", "error", "loading", "disabled"] as const).map((state) => (
          <Row key={state} title={state}>
            {VARIANTS.map((v) => (
              <Button key={v} variant={v} status={state === "rest" || state === "disabled" ? "idle" : state} disabled={state === "disabled"} data-testid={`b-${state}-${v}`}>
                {v === "primary" ? "Weiter" : v === "secondary" ? "Exportieren" : v === "ghost" ? "Zurück" : "Löschen"}
              </Button>
            ))}
            <Button variant="secondary" size="sm" status={state === "rest" || state === "disabled" ? "idle" : state} disabled={state === "disabled"}>
              Klein
            </Button>
          </Row>
        ))}
        <Row title="live: useActionStatus (Laden → Erfolg / Fehler → zurück)">
          <Live />
        </Row>
        <Row title="Rand-Lauf (run) und Hauptaktion ohne Feinheiten (fx=false)">
          <Button variant="primary" run>
            Hervorgehoben
          </Button>
          <Button variant="primary" fx={false}>
            Hauptaktion
          </Button>
        </Row>
        <Row title="Chips (Häkchen-Abzeichen)">
          {(["a", "b", "c"] as const).map((k, i) => (
            <button key={k} type="button" aria-pressed={chips[k]} onClick={() => setChips((c) => ({ ...c, [k]: !c[k] }))} className={chipClass(!!chips[k], { tone: i === 2 ? "win" : "neutral" })}>
              Chip {k.toUpperCase()}
            </button>
          ))}
        </Row>
        <Row title="Kopieren">
          <CopyButton text="Beispieltext" />
          <CopyButton text="Beispieltext" variant="ghost" />
          <CopyButton text="https://example.org/einladung" iconOnly aria-label="Link kopieren" />
        </Row>
        <Row title="Suchfeld mit × · Feld mit Fehler · Schritt-Feld">
          <div className="w-64">
            <Input type="search" aria-label="Suchen" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="w-64">
            <Field label="Risiko je Trade" htmlFor="risk" error={q.length > 8 ? "Zu lang für ein Suchwort." : undefined}>
              <Input id="risk" numeric defaultValue="1,5" invalid={q.length > 8} />
            </Field>
          </div>
          <Stepper value={seats} min={2} max={9} onChange={setSeats} decreaseLabel="Weniger" increaseLabel="Mehr" />
        </Row>
      </div>
    </MotionRoot>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
