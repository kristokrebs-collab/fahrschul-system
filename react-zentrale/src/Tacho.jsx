import { useEffect, useRef, useState } from 'react'

const CX = 100, CY = 104, RAD = 78
const pt = (deg, r) => {
  const a = (deg * Math.PI) / 180
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)]
}
const [SX, SY] = pt(150, RAD)
const [EX, EY] = pt(390, RAD)
const ARC = `M ${SX.toFixed(1)} ${SY.toFixed(1)} A ${RAD} ${RAD} 0 1 1 ${EX.toFixed(1)} ${EY.toFixed(1)}`

const TICKS = Array.from({ length: 13 }, (_, i) => {
  const deg = 150 + i * 20, major = i % 3 === 0
  const [x1, y1] = pt(deg, RAD - (major ? 13 : 9))
  const [x2, y2] = pt(deg, RAD - 4)
  return { x1, y1, x2, y2, major }
})

/* 240°-Tacho · Signature-Element „Prüfungsreife als Geschwindigkeit" */
export default function Tacho({ pct, color }) {
  const [shown, setShown] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    const from = shown, delta = pct - from
    if (!delta) return
    const t0 = performance.now(), dur = 1100
    const step = now => {
      const f = Math.min(1, (now - t0) / dur)
      const e = 1 - Math.pow(1 - f, 3)
      setShown(Math.round(from + delta * e))
      if (f < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [pct]) // eslint-disable-line react-hooks/exhaustive-deps

  const [nx1, ny1] = pt(150, 40)
  const [nx2, ny2] = pt(150, 62)
  const [zx0, zy0] = pt(150, RAD + 13)
  const [zx1, zy1] = pt(390, RAD + 13)

  return (
    <div className="tacho">
      <svg viewBox="0 0 200 132" aria-label={`Gesamt-Prüfungsreife ${pct} Prozent`}>
        <defs>
          <linearGradient id="tgrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent-hi)" />
            <stop offset="50%" stopColor="var(--amber)" />
            <stop offset="100%" stopColor="var(--emerald-hi)" />
          </linearGradient>
        </defs>
        <path className="t-track" d={ARC} fill="none" strokeWidth="9" strokeLinecap="round" />
        <path
          className="t-arc" d={ARC} fill="none" stroke="url(#tgrad)" strokeWidth="9"
          strokeLinecap="round" pathLength="100" strokeDasharray="100"
          strokeDashoffset={100 - pct} style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
        {TICKS.map((t, i) => (
          <line
            key={i} className={t.major ? 't-tick major' : 't-tick'}
            x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth={t.major ? 2 : 1}
          />
        ))}
        <g className="t-needle" style={{ transformOrigin: `${CX}px ${CY}px`, transform: `rotate(${(pct * 2.4).toFixed(1)}deg)` }}>
          <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} stroke={color} strokeWidth="3.5" strokeLinecap="round" />
          <circle cx={nx1} cy={ny1} r="3" fill={color} />
        </g>
        <text className="t-zone" x={zx0} y={zy0 + 8} textAnchor="middle">0</text>
        <text className="t-zone" x={zx1} y={zy1 + 8} textAnchor="middle">100</text>
        <text className="t-num" x={CX} y={CY - 6} textAnchor="middle">
          {shown}<tspan fontSize="16" fill="var(--text-dim)"> %</tspan>
        </text>
        <text className="t-lab" x={CX} y={CY + 24} textAnchor="middle">Prüfungsreife</text>
      </svg>
    </div>
  )
}

export function Ring({ pct, color }) {
  return (
    <div
      className="card-ring" title={`Gesamt-Prüfungsreife ${pct} %`}
      style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, var(--surface-3) 0)` }}
    >
      <b>{pct}</b><span>%</span>
    </div>
  )
}
