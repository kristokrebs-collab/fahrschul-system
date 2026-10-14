import type { SearchKind } from "./sources";

/** 16 px line glyphs per result kind (stroke = currentColor, decorative). */
export function KindGlyph({ kind, className }: { kind: SearchKind; className?: string }) {
  const p = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className };
  switch (kind) {
    case "best":
      return (
        <svg {...p}>
          <path d="M8 2.2l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.9l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z" />
        </svg>
      );
    case "recent":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="5.6" />
          <path d="M8 5v3.2l2.2 1.4" />
        </svg>
      );
    case "trade":
      return (
        <svg {...p}>
          <path d="M2.5 11.5l3.6-3.6 2.6 2.4 4.8-5.6" />
          <path d="M10.2 4.7h3.3V8" />
        </svg>
      );
    case "setup":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="5.6" />
          <circle cx="8" cy="8" r="2.4" />
        </svg>
      );
    case "day":
      return (
        <svg {...p}>
          <rect x="2.6" y="3.4" width="10.8" height="10" rx="2" />
          <path d="M2.6 6.6h10.8M5.6 2.2v2.4M10.4 2.2v2.4" />
        </svg>
      );
    case "page":
      return (
        <svg {...p}>
          <rect x="2.4" y="2.4" width="4.6" height="4.6" rx="1.2" />
          <rect x="9" y="2.4" width="4.6" height="4.6" rx="1.2" />
          <rect x="2.4" y="9" width="4.6" height="4.6" rx="1.2" />
          <rect x="9" y="9" width="4.6" height="4.6" rx="1.2" />
        </svg>
      );
    case "setting":
      return (
        <svg {...p}>
          <path d="M3 4.5h10M3 8h10M3 11.5h10" />
          <circle cx="6" cy="4.5" r="1.3" fill="currentColor" />
          <circle cx="10.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="5" cy="11.5" r="1.3" fill="currentColor" />
        </svg>
      );
    case "report":
      return (
        <svg {...p}>
          <path d="M4 2.4h5.4L12 5v8.6H4z" />
          <path d="M9.2 2.4V5.2H12M6 8.4h4M6 10.8h4" />
        </svg>
      );
    case "command":
      return (
        <svg {...p}>
          <path d="M4.5 4.5L8 8l-3.5 3.5M9 11.5h3" />
        </svg>
      );
  }
}

export function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className={className}>
      <circle cx="7" cy="7" r="4.6" />
      <path d="M10.4 10.4l3.2 3.2" />
    </svg>
  );
}
