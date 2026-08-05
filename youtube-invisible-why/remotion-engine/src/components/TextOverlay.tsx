import React from "react";
import { interpolate, spring, useVideoConfig } from "remotion";

interface TextOverlayProps {
  text: string;
  localFrame: number; // frames since this overlay should start appearing
  accentColor: string;
}

// 2-5 word, ALL CAPS key-term callouts only (visual-style.md) — this is not
// a subtitle system.
export const TextOverlay: React.FC<TextOverlayProps> = ({ text, localFrame, accentColor }) => {
  const { fps } = useVideoConfig();
  if (localFrame < 0) return null;

  const s = spring({ frame: localFrame, fps, config: { damping: 14, mass: 0.6 } });
  const translateY = interpolate(s, [0, 1], [24, 0]);
  const opacity = interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 90,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          background: "#1A1A1A",
          color: "#F5F0E6",
          padding: "16px 38px",
          fontSize: 54,
          fontWeight: 800,
          letterSpacing: 1,
          borderRadius: 6,
          fontFamily: "Arial, Helvetica, sans-serif",
          borderBottom: `6px solid ${accentColor}`,
        }}
      >
        {text}
      </div>
    </div>
  );
};
