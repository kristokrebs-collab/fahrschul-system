import React from "react";

// Warm off-white paper with a subtle grain (tiled radial-gradient dots) and
// a light vignette — see channel-bible/visual-style.md. No external texture
// asset needed.
export const Paper: React.FC = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      backgroundColor: "#F5F0E6",
      backgroundImage: [
        "radial-gradient(circle at 1px 1px, rgba(26,26,26,0.05) 1px, transparent 0)",
        "radial-gradient(circle at 65% 35%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.05) 100%)",
      ].join(", "),
      backgroundSize: "14px 14px, cover",
    }}
  />
);
