import type { SVGProps } from "react";

/**
 * Community icons (P12) – same recipe as `@/primitives/icons` (24 × 24, `currentColor`, stroke 1.8, decorative). They
 * live here because the shared icon map belongs to the integrator.
 */
export type SocialGlyph = "share" | "link" | "users" | "trophy" | "chat" | "lock" | "plus" | "door" | "copy" | "image" | "dice" | "flag" | "seat" | "send" | "mentor" | "check";

const BASE: SVGProps<SVGSVGElement> = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export function Glyph({ name, className }: { name: SocialGlyph; className?: string }) {
  const p = { ...BASE, className: className ?? "size-4" };
  switch (name) {
    case "share":
      return (
        <svg {...p}>
          <path d="M12 3v12" />
          <path d="M7.5 7.5 12 3l4.5 4.5" />
          <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" />
        </svg>
      );
    case "link":
      return (
        <svg {...p}>
          <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
          <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
        </svg>
      );
    case "users":
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
          <path d="M18.5 14.4A6.5 6.5 0 0 1 21.5 20" />
        </svg>
      );
    case "trophy":
      return (
        <svg {...p}>
          <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
          <path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.6M17 6h2.5a2.5 2.5 0 0 1-2.6 3.6" />
          <path d="M12 14v3.5M8.5 21h7M9.5 17.5h5" />
        </svg>
      );
    case "chat":
      return (
        <svg {...p}>
          <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5z" />
        </svg>
      );
    case "lock":
      return (
        <svg {...p}>
          <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...p} strokeWidth={2}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "door":
      return (
        <svg {...p}>
          <path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" />
          <path d="M11 12h10M17.5 8.5 21 12l-3.5 3.5" />
        </svg>
      );
    case "copy":
      return (
        <svg {...p}>
          <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
          <path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
        </svg>
      );
    case "image":
      return (
        <svg {...p}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <circle cx="9" cy="9.5" r="1.6" />
          <path d="m20.5 15.5-4.5-4.5-8.5 8.5" />
        </svg>
      );
    case "dice":
      return (
        <svg {...p}>
          <rect x="4" y="4" width="16" height="16" rx="3.5" />
          <circle cx="9" cy="9" r=".9" fill="currentColor" />
          <circle cx="15" cy="15" r=".9" fill="currentColor" />
          <circle cx="15" cy="9" r=".9" fill="currentColor" />
          <circle cx="9" cy="15" r=".9" fill="currentColor" />
        </svg>
      );
    case "flag":
      return (
        <svg {...p}>
          <path d="M5 21V4.5" />
          <path d="M5 4.5h11l-2 4 2 4H5" />
        </svg>
      );
    case "seat":
      return (
        <svg {...p}>
          <path d="M7 11V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V11" />
          <path d="M5 11h14v4H5zM7 15v5M17 15v5" />
        </svg>
      );
    case "send":
      return (
        <svg {...p}>
          <path d="M21 3 10 14" />
          <path d="m21 3-6.5 18-4.5-7-7-4.5z" />
        </svg>
      );
    case "mentor":
      return (
        <svg {...p}>
          <path d="m12 4 9 4.5-9 4.5L3 8.5z" />
          <path d="M7 10.8V15c0 1.7 2.2 3 5 3s5-1.3 5-3v-4.2" />
          <path d="M21 8.5V14" />
        </svg>
      );
    case "check":
      return (
        <svg {...p} strokeWidth={2.2}>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      );
  }
}
