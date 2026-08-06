import React from "react";

// A pen, drawn alone — no hand, no arm.
//
// The hand silhouette it replaces was the single most expensive thing on
// screen and the least forgiving: a hand that is even slightly wrong reads
// as wrong immediately, it covers a large wedge of the page while it works,
// and at 1920x1080 it draws attention to itself rather than to the line
// being made. A bare pen has none of those failure modes. It also frees the
// composition, because it occludes roughly a tenth of the area the hand did
// — which is what lets the layout fill the page instead of reserving a
// corner for an arm.
//
// The nib sits at (18, 18) of this 200x200 box and the barrel runs down-right
// from it, preserving the channel's "tool enters from lower-right" rule
// (visual-style.md) without the mass that rule was written around.
export const PEN_TIP = { x: 18, y: 18 };
const VIEWBOX_SIZE = 200;

const INK = "#1A1A1A";
const BARREL = "#2B2B2B";

interface PenProps {
  tipX: number;
  tipY: number;
  visible: boolean;
  accent: string;
  /** Rendered size of the pen in canvas px. */
  size?: number;
}

export const Pen: React.FC<PenProps> = ({ tipX, tipY, visible, accent, size = 210 }) => {
  if (!visible) return null;

  const scale = size / VIEWBOX_SIZE;
  const left = tipX - PEN_TIP.x * scale;
  const top = tipY - PEN_TIP.y * scale;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      style={{ position: "absolute", left, top, pointerEvents: "none" }}
    >
      {/* Contact shadow, offset along the barrel axis so the nib looks like
          it is touching the page rather than floating above it. */}
      <g transform="translate(7,10)" opacity="0.17">
        <path d="M18,18 L44,44 L150,150 L176,176 L150,190 L120,160 L34,74 Z" fill="#000" />
      </g>

      {/* Nib: a short accent-coloured cone so the exact contact point is
          readable at a glance even against busy line work. */}
      <path d="M18,18 L41,33 L33,41 Z" fill={accent} />
      <path d="M18,18 L41,33 L33,41 Z" fill="none" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />

      {/* Barrel: two tapering edges rather than a stroked line, so the pen
          reads as a solid object with thickness. */}
      <path
        d="M36,30 L150,144 L166,178 L132,162 L30,36 Z"
        fill={BARREL}
        stroke={INK}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* Specular edge along the upper-left of the barrel. */}
      <path d="M40,28 L152,140" fill="none" stroke="#6E6E6E" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
      {/* Grip band — the one detail that stops the barrel reading as a stick. */}
      <path d="M74,60 L92,78" fill="none" stroke={accent} strokeWidth="13" strokeLinecap="butt" />
      <path d="M74,60 L92,78" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="butt" opacity="0.5" />
    </svg>
  );
};
