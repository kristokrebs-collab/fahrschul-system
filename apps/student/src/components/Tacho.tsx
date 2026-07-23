import { useReducedMotion } from "../state/useReducedMotion.js";

export interface TachoProps {
  /** 0..1 */
  value: number;
  label: string;
  sublabel?: string;
}

/**
 * 240°-SVG-Gauge, gestalterisch aus app.html/react-zentrale portiert (siehe
 * docs/prototype-audit.md "Tacho-Gauge-Komponente ... gut isolierbar").
 * WICHTIG: anders als im Prototyp zeigt diese Instanz NIE eine
 * zusammengesetzte "Prüfungsreife"-Kennzahl (Non-Negotiable) – nur einzelne,
 * für sich genommen faktische Verhältnisse (z.B. "Pflichtfahrten absolviert
 * / gefordert"), die der Aufrufer explizit übergibt.
 * Die Nadel-Animation wird bei `prefers-reduced-motion: reduce` deaktiviert.
 */
export function Tacho({ value, label, sublabel }: TachoProps) {
  const reducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, value));
  const angle = -120 + clamped * 240;

  const radius = 70;
  const cx = 90;
  const cy = 90;
  const startAngle = -210;
  const endAngle = 30;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const arcStart = { x: cx + radius * Math.cos(toRad(startAngle)), y: cy + radius * Math.sin(toRad(startAngle)) };
  const arcEnd = { x: cx + radius * Math.cos(toRad(endAngle)), y: cy + radius * Math.sin(toRad(endAngle)) };

  return (
    <div role="img" aria-label={`${label}: ${Math.round(clamped * 100)} Prozent, ${sublabel ?? ""}`} className="tacho">
      <svg width="180" height="140" viewBox="0 0 180 140">
        <path
          d={`M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 1 1 ${arcEnd.x} ${arcEnd.y}`}
          fill="none"
          stroke="var(--border-strong, #333)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d={`M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 1 1 ${arcEnd.x} ${arcEnd.y}`}
          fill="none"
          stroke="var(--emerald, #10B981)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${clamped * 314} 314`}
        />
        <g
          style={{
            transform: `rotate(${angle}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transition: reducedMotion ? "none" : "transform .6s cubic-bezier(.34,1.56,.64,1)",
          }}
        >
          <line x1={cx} y1={cy} x2={cx} y2={cy - radius + 14} stroke="var(--accent, #E11D48)" strokeWidth="4" strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r="5" fill="var(--accent, #E11D48)" />
      </svg>
      <div className="tacho__label">{label}</div>
      {sublabel ? <div className="tacho__sublabel">{sublabel}</div> : null}
    </div>
  );
}
