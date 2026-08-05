import React from "react";

// The pen tip lands at (25, 24) in this 200x200 viewBox — the barrel and
// the hand trail down-right from it, which keeps the channel's fixed
// "hand enters from lower-right" rule (visual-style.md) while leaving the
// drawing itself unobscured up and to the left.
export const HAND_TIP = { x: 25, y: 24 };
const VIEWBOX_SIZE = 200;

const INK = "#1A1A1A";
const PAPER = "#F5F0E6";

// The hand is one continuous silhouette rather than a stack of capsule
// shapes. Assembling a hand from separate finger capsules reads as
// sausages resting on a ball no matter how the anatomy is tuned; a single
// outline with a V-notch where the pen enters reads as a grip immediately.
//
// The notch matters: the barrel passes through the open V between the
// index finger's lower edge and the thumb's upper edge, and is covered by
// the palm below it. Both edges are offset perpendicular to the barrel
// axis (unit 0.671,0.741 → perpendicular 0.741,-0.671) so a sliver of pen
// stays visible between the fingers.
const HAND_SILHOUETTE = `
  M100,80
  C105,73 115,72 121,79
  L160,123
  C174,132 188,144 195,160
  C200,171 201,184 199,196
  L199,200
  L150,200
  C136,197 123,189 115,177
  L106,159
  L76,124
  C70,117 71,107 78,102
  C85,97 93,99 97,106
  L143,154
  L151,146
  L93,83
  C88,79 93,76 100,80
  Z
`;

const HandSVG: React.FC<{ accent: string }> = ({ accent }) => (
  <svg viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} width="100%" height="100%">
    {/* --- pen, drawn first so the hand silhouette covers its lower half --- */}
    <path
      d="M34.1,40.8 L169,183.5 L179.5,175.4 L41.9,33.2 Z"
      fill={PAPER}
      stroke={INK}
      strokeWidth={3.4}
      strokeLinejoin="round"
    />
    {/* nib, tapering to the exact tip point */}
    <path d="M25,24 L34.1,40.8 L41.9,33.2 Z" fill={INK} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
    {/* the one accent-coloured element on the whole hand */}
    <path
      d="M70.6,79.3 L95.6,105.1 L104.4,97.2 L79.4,71.4 Z"
      fill={accent}
      stroke={INK}
      strokeWidth={2.6}
      strokeLinejoin="round"
    />

    {/* --- hand --- */}
    <path d={HAND_SILHOUETTE} fill={PAPER} stroke={INK} strokeWidth={3.4} strokeLinejoin="round" />

    {/* middle finger, hinted under the index rather than drawn in full */}
    <path
      d="M158,124 C150,136 146,149 148,161"
      fill="none"
      stroke={INK}
      strokeWidth={2.6}
      strokeLinecap="round"
    />
    {/* knuckle crease across the back of the hand */}
    <path
      d="M170,140 C179,152 184,167 182,181"
      fill="none"
      stroke={INK}
      strokeWidth={2.6}
      strokeLinecap="round"
    />
    {/* thumb joint */}
    <path
      d="M92,112 C99,116 106,123 111,130"
      fill="none"
      stroke={INK}
      strokeWidth={2.4}
      strokeLinecap="round"
    />
  </svg>
);

interface AnimatedHandProps {
  tipX: number;
  tipY: number;
  angle?: number;
  size?: number;
  visible: boolean;
  accent?: string;
}

export const AnimatedHand: React.FC<AnimatedHandProps> = ({
  tipX,
  tipY,
  angle = 0,
  size = 300,
  visible,
  accent = "#E4572E",
}) => {
  if (!visible) return null;
  const offsetX = (HAND_TIP.x / VIEWBOX_SIZE) * size;
  const offsetY = (HAND_TIP.y / VIEWBOX_SIZE) * size;
  return (
    <div
      style={{
        position: "absolute",
        left: tipX - offsetX,
        top: tipY - offsetY,
        width: size,
        height: size,
        transform: `rotate(${angle}deg)`,
        transformOrigin: `${offsetX}px ${offsetY}px`,
        pointerEvents: "none",
      }}
    >
      <HandSVG accent={accent} />
    </div>
  );
};
