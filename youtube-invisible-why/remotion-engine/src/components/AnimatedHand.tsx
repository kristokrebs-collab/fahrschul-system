import React from "react";

// Tip lands at (25, 24) in this 200x200 viewBox — see HAND_TIP below. The
// forearm/palm mass extends toward the bottom-right, matching the channel's
// fixed "hand enters from lower-right" rule (visual-style.md).
export const HAND_TIP = { x: 25, y: 24 };
const VIEWBOX_SIZE = 200;

const HandSVG: React.FC = () => (
  <svg viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} width="100%" height="100%">
    <path
      d="M200,200 L112,112 L132,90 L200,158 Z"
      fill="#F5F0E6"
      stroke="#1A1A1A"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path
      d="M95,145 C75,150 55,135 58,112 C45,105 45,85 62,80 C60,65 75,52 92,58 C100,45 120,45 128,58 C142,52 155,65 148,80 C160,88 158,105 145,110 C150,125 138,140 120,138 Z"
      fill="#F5F0E6"
      stroke="#1A1A1A"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path d="M100,95 L30,28" stroke="#1A1A1A" strokeWidth="6" strokeLinecap="round" />
    <path d="M80,75 L58,52" stroke="#E4572E" strokeWidth="6" strokeLinecap="round" />
    <circle cx="25" cy="24" r="3.2" fill="#1A1A1A" />
  </svg>
);

interface AnimatedHandProps {
  tipX: number;
  tipY: number;
  angle?: number;
  size?: number;
  visible: boolean;
}

export const AnimatedHand: React.FC<AnimatedHandProps> = ({
  tipX,
  tipY,
  angle = -38,
  size = 260,
  visible,
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
      <HandSVG />
    </div>
  );
};
