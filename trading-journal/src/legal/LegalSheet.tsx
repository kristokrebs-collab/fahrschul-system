/**
 * The legal sheet (Review F07): Impressum from the operator data, Datenschutz / AGB / Widerruf as links to the
 * operator's own texts. Whatever is missing is a clearly marked placeholder (warn tone, „Platzhalter“, the env name to
 * set) – the app never shows invented legal text as if it were final. A `Sheet` (bottom sheet on phones); switching
 * the document is a `Segmented` row, the body cascades in (`StaggerItem`).
 */
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { LEGAL_LABEL, legalConfig, type LegalConfig, type LegalDoc } from "./config";
import { closeLegal, openLegal, useLegal } from "./store";

export const LEGAL_STRINGS = {
  title: "Rechtliches",
  placeholder: "Platzhalter",
  missing: (env: string) => `Vom Betreiber auszufüllen: ${env} in den Netlify-Variablen setzen (siehe SETUP.md „Rechtliches“).`,
  operatorPage: "Das Impressum des Betreibers liegt auf seiner eigenen Seite.",
  external: (doc: string) => `${doc} des Betreibers öffnen`,
  docLead: {
    datenschutz: "Wie der Betreiber dieser Seite mit deinen Daten umgeht.",
    agb: "Die Vertragsbedingungen des Betreibers für die Tarife dieser Seite.",
    widerruf: "Die Widerrufsbelehrung des Betreibers.",
  },
  widerrufInAgb: "Ohne eigene Seite steht die Widerrufsbelehrung in den AGB des Betreibers.",
  rows: { operator: "Anbieter", address: "Anschrift", representative: "Vertreten durch", contact: "Kontakt", register: "Register", vatId: "Umsatzsteuer-ID", responsible: "Verantwortlich für den Inhalt" },
} as const;

function Placeholder({ env }: { env: string }) {
  return (
    <span className="grid gap-0.5 rounded-lg border border-dashed border-warn/50 bg-warn/[0.06] px-2.5 py-1.5 text-[12px] text-warn" data-testid="legal-placeholder">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{LEGAL_STRINGS.placeholder}</span>
      <span>{LEGAL_STRINGS.missing(env)}</span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-2.5 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[12px] text-mute">{label}</dt>
      <dd className="min-w-0 text-[13.5px] text-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Impressum({ c }: { c: LegalConfig }) {
  if (c.urls.impressum)
    return (
      <div className="grid gap-3">
        <p className="text-[13px] text-mute">{LEGAL_STRINGS.operatorPage}</p>
        <Button variant="primary" className="justify-self-start" onClick={() => window.open(c.urls.impressum!, "_blank", "noopener,noreferrer")}>
          {LEGAL_STRINGS.external("Impressum")}
        </Button>
      </div>
    );
  const R = LEGAL_STRINGS.rows;
  return (
    <dl className="grid" data-testid="legal-impressum">
      <Row label={R.operator}>{c.operator ?? <Placeholder env="VITE_LEGAL_OPERATOR" />}</Row>
      <Row label={R.address}>{c.address.length ? c.address.map((l) => <span key={l} className="block">{l}</span>) : <Placeholder env="VITE_LEGAL_ADDRESS" />}</Row>
      {c.representative && <Row label={R.representative}>{c.representative}</Row>}
      <Row label={R.contact}>
        {c.email ? (
          <a href={`mailto:${c.email}`} className="underline-offset-2 hover:underline">
            {c.email}
          </a>
        ) : (
          <Placeholder env="VITE_LEGAL_EMAIL" />
        )}
        {c.phone && <span className="block text-mute">{c.phone}</span>}
      </Row>
      {c.register && <Row label={R.register}>{c.register}</Row>}
      {c.vatId && <Row label={R.vatId}>{c.vatId}</Row>}
      {c.responsible && <Row label={R.responsible}>{c.responsible}</Row>}
    </dl>
  );
}

function ExternalDoc({ doc, c }: { doc: Exclude<LegalDoc, "impressum">; c: LegalConfig }) {
  const url = c.urls[doc];
  const env = doc === "datenschutz" ? "VITE_LEGAL_DATENSCHUTZ_URL" : doc === "agb" ? "VITE_LEGAL_AGB_URL" : "VITE_LEGAL_WIDERRUF_URL";
  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-mute">{LEGAL_STRINGS.docLead[doc]}</p>
      {url ? (
        <Button variant="primary" className="justify-self-start" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
          {LEGAL_STRINGS.external(LEGAL_LABEL[doc])}
        </Button>
      ) : doc === "widerruf" && c.urls.agb ? (
        <p className="text-[12.5px] text-mute">{LEGAL_STRINGS.widerrufInAgb}</p>
      ) : (
        <Placeholder env={env} />
      )}
    </div>
  );
}

const OPTIONS = (["impressum", "datenschutz", "agb", "widerruf"] as const).map((v) => ({ v, label: LEGAL_LABEL[v] }));

export default function LegalSheet() {
  const doc = useLegal((s) => s.open);
  const c = legalConfig();
  return (
    <Sheet open={doc !== null} onClose={closeLegal} title={doc ? LEGAL_LABEL[doc] : LEGAL_STRINGS.title} size="md">
      {doc && (
        <div className="grid gap-4" data-testid="legal-sheet" data-doc={doc}>
          <StaggerItem>
            <Segmented<LegalDoc> aria-label={LEGAL_STRINGS.title} size="sm" value={doc} onChange={openLegal} options={OPTIONS} className="w-full" />
          </StaggerItem>
          <StaggerItem>{doc === "impressum" ? <Impressum c={c} /> : <ExternalDoc doc={doc} c={c} />}</StaggerItem>
        </div>
      )}
    </Sheet>
  );
}
