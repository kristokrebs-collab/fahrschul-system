/**
 * The small Markdown of the legal drafts (`docs/RECHT/*.md`), rendered as React nodes – never as HTML (no
 * `dangerouslySetInnerHTML`; an operator value or a link can never become markup). Supported: `##` / `###` headings,
 * paragraphs, `-` lists, `>` quotes, `**bold**`, `[text](url)` and the two placeholder forms:
 *
 * - `{{VITE_LEGAL_OPERATOR}}` – an operator datum: its value, or a CLEARLY MARKED placeholder naming the variable;
 * - `{{TODO: …}}` – something the operator has to decide: always a marked placeholder, never text that looks final.
 *
 * `> **[ANWALT]** …` quotes are notes for the lawyer in the file and are dropped from the app.
 * Links: only `https:` or a same-site path (`safeLegalUrl`); anything else is shown as plain text.
 */
import type { ReactNode } from "react";
import { safeLegalUrl, type LegalConfig } from "./config";

export type Block =
  | { kind: "h2" | "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "quote"; text: string };

const ANWALT = /^>\s*\*\*\[ANWALT\]\*\*/;

/** Parses the Markdown subset into blocks (pure). Lawyer notes are removed. */
export function parseLegalMarkdown(source: string): Block[] {
  const out: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      out.push({ kind: "h3", text: line.slice(4).trim() });
      i++;
    } else if (line.startsWith("## ")) {
      out.push({ kind: "h2", text: line.slice(3).trim() });
      i++;
    } else if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith(">")) quote.push((lines[i++] ?? "").replace(/^>\s?/, ""));
      if (!ANWALT.test(`> ${quote[0] ?? ""}`)) out.push({ kind: "quote", text: quote.join(" ").trim() });
    } else if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i] ?? "")) items.push((lines[i++] ?? "").slice(2).trim());
      out.push({ kind: "ul", items });
    } else {
      const para: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{2,3} |>|[-*] )/.test(lines[i] ?? "")) para.push((lines[i++] ?? "").trim());
      out.push({ kind: "p", text: para.join(" ") });
    }
  }
  return out;
}

/** The operator datum a `{{VITE_LEGAL_…}}` token stands for, or null when it is not set (or unknown). */
export function legalValue(name: string, c: LegalConfig): string | null {
  switch (name) {
    case "VITE_LEGAL_OPERATOR":
      return c.operator;
    case "VITE_LEGAL_ADDRESS":
      return c.address.length ? c.address.join(", ") : null;
    case "VITE_LEGAL_EMAIL":
      return c.email;
    case "VITE_LEGAL_PHONE":
      return c.phone;
    case "VITE_LEGAL_REPRESENTATIVE":
      return c.representative;
    case "VITE_LEGAL_REGISTER":
      return c.register;
    case "VITE_LEGAL_VAT_ID":
      return c.vatId;
    case "VITE_LEGAL_RESPONSIBLE":
      return c.responsible;
    default:
      return null;
  }
}

/** The marked placeholder (warn tone, „Platzhalter“, the thing to fill in). */
function Placeholder({ label, testId }: { label: string; testId: string }) {
  return (
    <mark className="rounded border border-dashed border-warn/50 bg-warn/[0.08] px-1 py-px text-[0.92em] font-medium text-warn" data-testid={testId}>
      [Platzhalter: {label}]
    </mark>
  );
}

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|\{\{[^}]*\}\})/g;

/** Inline spans of one text: bold, safe links, operator values and marked placeholders. */
export function renderInline(text: string, c: LegalConfig): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeLegalUrl(link[2]) ?? (link[2]?.startsWith("?rechtliches=") ? link[2] : null);
      return href ? (
        <a key={i} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
          {link[1]}
        </a>
      ) : (
        <span key={i}>{link[1]}</span>
      );
    }
    const token = /^\{\{([^}]*)\}\}$/.exec(part);
    if (token) {
      const body = (token[1] ?? "").trim();
      if (body.startsWith("TODO")) return <Placeholder key={i} label={body.replace(/^TODO:?/, "").trim() || "vom Betreiber auszufüllen"} testId="legal-todo" />;
      const value = legalValue(body, c);
      return value ? <span key={i}>{value}</span> : <Placeholder key={i} label={body || "?"} testId="legal-field" />;
    }
    return part;
  });
}

/** The parsed document as React nodes. */
export function LegalMarkdown({ source, config }: { source: string; config: LegalConfig }) {
  const blocks = parseLegalMarkdown(source);
  return (
    <div className="grid gap-3 text-[13px] leading-relaxed text-fg/90 [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2" data-testid="legal-markdown">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h2":
            return (
              <h3 key={i} className="pt-3 text-[16px] font-semibold tracking-tight text-fg first:pt-0">
                {renderInline(b.text, config)}
              </h3>
            );
          case "h3":
            return (
              <h4 key={i} className="pt-1.5 text-[13.5px] font-semibold text-fg">
                {renderInline(b.text, config)}
              </h4>
            );
          case "ul":
            return (
              <ul key={i} className="grid list-disc gap-1.5 pl-5 marker:text-faint">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, config)}</li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={i} className="rounded-xl border border-line bg-ink-900/60 px-3.5 py-2.5 text-fg">
                {renderInline(b.text, config)}
              </blockquote>
            );
          default:
            return <p key={i}>{renderInline(b.text, config)}</p>;
        }
      })}
    </div>
  );
}
