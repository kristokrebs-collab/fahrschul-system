// Komponenten aus 21st.dev. Quellen: Original-Code aus den Open-Source-Repos
// (ibelick/motion-primitives, magicuidesign/magicui, paper-design/shaders)
// bzw. aus 21st.dev geladen (Shiny Button, Gradient Selector). Farben auf die matte Ink-Palette angepasst.
import {
  AnimatePresence, motion, useInView, useMotionTemplate, useMotionValue, useSpring, useTransform,
  motionValue, type MotionValue, type SpringOptions, type Transition, type Variants,
} from 'motion/react';
import {
  Children, cloneElement, createContext, useContext, useEffect, useId, useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react';
import useMeasure from 'react-use-measure';
import { cn } from './lib';
import { contextSpring, spring } from './physics';

// ── Dock (21st.dev · ibelick / motion-primitives) ──────
type DockCtx = { mouseX: MotionValue<number>; spring: SpringOptions; magnification: number; distance: number; base: number };
const DockContext = createContext<DockCtx | undefined>(undefined);
const useDock = () => { const c = useContext(DockContext); if (!c) throw new Error('useDock outside Dock'); return c; };

export function Dock({ children, className, spring = { mass: 0.1, stiffness: 150, damping: 12 }, magnification = 64, distance = 140, panelHeight = 60, base = 44 }:
  { children: ReactNode; className?: string; spring?: SpringOptions; magnification?: number; distance?: number; panelHeight?: number; base?: number }) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);
  const maxHeight = useMemo(() => Math.max(96, magnification + magnification / 2 + 4), [magnification]);
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);
  return (
    <motion.div style={{ height, scrollbarWidth: 'none' }} className="mx-2 flex max-w-full items-end">
      <motion.div
        onMouseMove={({ pageX }) => { isHovered.set(1); mouseX.set(pageX); }}
        onMouseLeave={() => { isHovered.set(0); mouseX.set(Infinity); }}
        className={cn('mx-auto flex w-fit items-end gap-3 rounded-2xl px-3 pb-2', className)}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="Navigation"
      >
        <DockContext.Provider value={{ mouseX, spring, distance, magnification, base }}>{children}</DockContext.Provider>
      </motion.div>
    </motion.div>
  );
}

export function DockItem({ children, className, onClick, active, label }: { children: ReactNode; className?: string; onClick?: () => void; active?: boolean; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { distance, magnification, mouseX, spring, base } = useDock();
  const isHovered = useMotionValue(0);
  const [show, setShow] = useState(false);
  useEffect(() => isHovered.on('change', (v) => setShow(v === 1)), [isHovered]);
  const mouseDistance = useTransform(mouseX, (val) => {
    const r = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - r.x - window.scrollX - r.width / 2;
  });
  const widthT = useTransform(mouseDistance, [-distance, 0, distance], [base, magnification, base]);
  const width = useSpring(widthT, spring);
  const iconW = useTransform(width, (v) => v / 2.2);
  return (
    <motion.button
      ref={ref}
      type="button"
      style={{ width, height: width }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full', className)}
    >
      <AnimatePresence>
        {show && (
          <motion.span
            initial={{ opacity: 0, y: 0 }} animate={{ opacity: 1, y: -10 }} exit={{ opacity: 0, y: 0 }} transition={{ duration: 0.2 }}
            className="pointer-events-none absolute -top-7 left-1/2 w-fit whitespace-pre rounded-md border border-line-2 bg-ink-800 px-2 py-0.5 text-xs text-fg"
            style={{ x: '-50%' }} role="tooltip"
          >{label}</motion.span>
        )}
      </AnimatePresence>
      <motion.span style={{ width: iconW }} className="relative z-10 flex items-center justify-center"><Magnetic intensity={0.5} range={60} className="size-full items-center justify-center [&_svg]:size-full">{children}</Magnetic></motion.span>
      {active && <motion.span layoutId="dock-dot" className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-signal" />}
    </motion.button>
  );
}

// ── Animated Tabs / AnimatedBackground (21st.dev · ibelick) ─
export function AnimatedBackground({ children, value, onValueChange, className, transition, enableHover = false }:
  { children: ReactElement<{ 'data-id': string; className?: string; children?: ReactNode }>[]; value?: string; onValueChange?: (id: string) => void; className?: string; transition?: Transition; enableHover?: boolean }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const uniqueId = useId();
  const activeId = enableHover ? hoverId : value ?? null;
  return (
    <>
      {Children.map(children, (child: any, index) => {
        const id = child.props['data-id'];
        const interaction = enableHover
          ? { onMouseEnter: () => setHoverId(id), onMouseLeave: () => setHoverId(null) }
          : { onClick: () => onValueChange?.(id) };
        return cloneElement(child, {
          key: index,
          className: cn('relative inline-flex', child.props.className),
          'data-checked': activeId === id ? 'true' : 'false',
          'aria-pressed': enableHover ? undefined : activeId === id,
          ...interaction,
        }, (
          <>
            <AnimatePresence initial={false}>
              {activeId === id && (
                <motion.span layoutId={`bg-${uniqueId}`} className={cn('absolute inset-0', className)} transition={transition}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              )}
            </AnimatePresence>
            <span className="relative z-10 inline-flex items-center gap-1.5">{child.props.children}</span>
          </>
        ));
      })}
    </>
  );
}

/** Segment-Umschalter auf Basis von AnimatedBackground. */
export function Segmented<T extends string>({ options, value, onChange, className, size = 'md', tones }:
  { options: { v: T; label: ReactNode }[]; value: T | null; onChange: (v: T) => void; className?: string; size?: 'sm' | 'md'; tones?: Partial<Record<T, string>> }) {
  return (
    <div className={cn('inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-ink-950/60 p-1', className)} role="group">
      <AnimatedBackground value={value ?? undefined} onValueChange={(id) => onChange(id as T)}
        className={cn('rounded-lg border border-line-2 bg-ink-750', value && tones?.[value])}
        transition={contextSpring({ bounce: 0.18, duration: 0.45 })}>
        {options.map((o) => (
          <button key={o.v} data-id={o.v} type="button"
            className={cn('rounded-lg font-medium text-mute transition-colors hover:text-fg data-[checked=true]:text-fg',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]')}>
            {o.label}
          </button>
        ))}
      </AnimatedBackground>
    </div>
  );
}

// ── Sliding Number (21st.dev · ibelick) ────────────────
const SLIDE: Transition = { type: 'spring', stiffness: 280, damping: 18, mass: 0.3 };
function Digit({ value, place }: { value: number; place: number }) {
  const v = Math.floor(value / place) % 10;
  const animated = useSpring(useMemo(() => motionValue(v), []), SLIDE as any);
  useEffect(() => { animated.set(v); }, [animated, v]);
  return (
    <span className="relative inline-block w-[1ch] overflow-y-clip leading-none tabular-nums">
      <span className="invisible">0</span>
      {Array.from({ length: 10 }, (_, i) => <DigitNum key={i} mv={animated} number={i} />)}
    </span>
  );
}
function DigitNum({ mv, number }: { mv: MotionValue<number>; number: number }) {
  const [ref, bounds] = useMeasure();
  const y = useTransform(mv, (latest) => {
    if (!bounds.height) return 0;
    const offset = (10 + number - (latest % 10)) % 10;
    let memo = offset * bounds.height;
    if (offset > 5) memo -= 10 * bounds.height;
    return memo;
  });
  if (!bounds.height) return <span ref={ref} className="invisible absolute">{number}</span>;
  return <motion.span style={{ y }} className="absolute inset-0 flex items-center justify-center" ref={ref}>{number}</motion.span>;
}
/** Deutsche Schreibweise mit Tausenderpunkt; jede Ziffer rollt einzeln. */
export function SlidingNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const abs = Math.abs(value);
  const [intPart, decPart = ''] = abs.toFixed(decimals).split('.');
  const digits = intPart.split('');
  const intVal = parseInt(intPart, 10);
  return (
    <span className="inline-flex items-center">
      {value < 0 && '−'}
      {digits.map((_, i) => {
        const place = Math.pow(10, digits.length - i - 1);
        const sep = (digits.length - i - 1) % 3 === 0 && i < digits.length - 1;
        return <span key={`p${place}`} className="inline-flex"><Digit value={intVal} place={place} />{sep && <span>.</span>}</span>;
      })}
      {decPart && <><span>,</span>{decPart.split('').map((_, i) => <Digit key={`d${i}`} value={parseInt(decPart, 10)} place={Math.pow(10, decPart.length - i - 1)} />)}</>}
    </span>
  );
}

// ── Number Ticker (21st.dev · magicui) ─────────────────
export function NumberTicker({ value, decimals = 0, className, prefix = '', signed = false }: { value: number; decimals?: number; className?: string; prefix?: string; signed?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { damping: 40, stiffness: 140 });
  const f = useMemo(() => new Intl.NumberFormat('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }), [decimals]);
  const render = (v: number) => { const n = Number(v.toFixed(decimals)); return prefix + (signed && n > 0 ? '+' : '') + f.format(n).replace('-', '−'); };
  useEffect(() => { mv.set(value); }, [mv, value]);
  useEffect(() => spring.on('change', (v) => { if (ref.current) ref.current.textContent = render(v); }), [spring, f]);
  return <span ref={ref} className={cn('inline-block tabular-nums', className)}>{render(value)}</span>;
}

// ── Border Beam (21st.dev · magicui) ───────────────────
export function BorderBeam({ size = 80, duration = 9, delay = 0, colorFrom = '#e5202e', colorTo = '#ffffff', borderWidth = 1, className }:
  { size?: number; duration?: number; delay?: number; colorFrom?: string; colorTo?: string; borderWidth?: number; className?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 rounded-[inherit] border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]"
      style={{ borderWidth, borderStyle: 'solid' }}>
      <motion.div
        className={cn('absolute aspect-square', className)}
        style={{ width: size, offsetPath: `rect(0 auto auto 0 round ${size}px)`, background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)` } as any}
        initial={{ offsetDistance: '0%' } as any}
        animate={{ offsetDistance: ['0%', '100%'] } as any}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay }}
      />
    </div>
  );
}

// ── Magic Card (21st.dev · magicui), Spotlight-Rand ────
export function MagicCard({ children, className, gradientSize = 240, gradientColor = 'rgba(255,255,255,0.045)', gradientFrom = '#9b9b9b', gradientTo = '#2c2c2c' }:
  { children?: ReactNode; className?: string; gradientSize?: number; gradientColor?: string; gradientFrom?: string; gradientTo?: string }) {
  const mouseX = useMotionValue(-gradientSize);
  const mouseY = useMotionValue(-gradientSize);
  const reset = () => { mouseX.set(-gradientSize); mouseY.set(-gradientSize); };
  const border = useMotionTemplate`linear-gradient(var(--color-background) 0 0) padding-box, radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientFrom}, ${gradientTo}, var(--color-border) 100%) border-box`;
  const glow = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientColor}, transparent 100%)`;
  return (
    <motion.div
      className={cn('group relative isolate overflow-hidden rounded-2xl border border-transparent transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgb(0_0_0/0.35)]', className)}
      onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); mouseX.set(e.clientX - r.left); mouseY.set(e.clientY - r.top); }}
      onPointerLeave={reset}
      style={{ background: border }}
    >
      <div className="pointer-events-none absolute inset-px z-0 rounded-[inherit] bg-gradient-to-b from-white/[0.035] via-white/[0.01] to-transparent" />
      <motion.div className="pointer-events-none absolute inset-px z-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: glow }} />
      <div className="relative z-10 h-full">{children}</div>
    </motion.div>
  );
}

// ── Blur Fade (21st.dev · magicui) ─────────────────────
export function BlurFade({ children, className }: { children: ReactNode; className?: string; delay?: number; duration?: number; offset?: number; blur?: string }) {
  return <div className={className}>{children}</div>;
}

// ── Transition Panel (21st.dev · ibelick) ──────────────
/** Ansichtswechsel mit Richtung: nach rechts im Dock → Inhalt kommt von rechts, mit Apple-Feder. */
export function TransitionPanel({ children, activeIndex, className }: { children: ReactNode[]; activeIndex: number; className?: string }) {
  const prev = useRef(activeIndex);
  const dir = activeIndex === prev.current ? 0 : activeIndex > prev.current ? 1 : -1;
  useEffect(() => { prev.current = activeIndex; }, [activeIndex]);
  return (
    <div className={cn('relative', className)}>
      <AnimatePresence initial={false} mode="popLayout" custom={dir}>
        <motion.div key={activeIndex} custom={dir}
          variants={{
            enter: (d: number) => ({ opacity: 0, y: 14, x: d * 14 }),
            center: { opacity: 1, y: 0, x: 0 },
            exit: (d: number) => ({ opacity: 0, y: -10, x: d * -10 }),
          }}
          initial="enter" animate="center" exit="exit"
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          {children[activeIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Circular Progress (21st.dev · magicui), mit Backtest-Marke ─
export function CircularProgress({ value, marker, size = 148, stroke = 9, color = '#46a6a0', track = '#1c2a3a', children }:
  { value: number | null; marker?: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = 45, c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value));
  const mAngle = marker != null ? marker * 360 - 90 : null;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      {mAngle != null && (
        <span className="pointer-events-none absolute inset-0" style={{ transform: `rotate(${mAngle + 90}deg)` }} aria-hidden="true">
          <span className="absolute left-1/2 top-0 h-[16px] w-[2px] -translate-x-1/2 rounded-full bg-fg/80" />
        </span>
      )}
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

// ── Shiny Button (21st.dev · designali-in) ─────────────
export function ShinyButton({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return <button type="button" className={cn('shiny-cta', className)} onClick={onClick}><span>{children}</span></button>;
}

// ── Gradient Selector (21st.dev · isaiahbjork) ─────────
export type GradOption = { v: number; label: string; color: string };
export function GradientSelector({ options, value, onChange }: { options: GradOption[]; value: number | null; onChange: (v: number | null) => void }) {
  const idx = options.findIndex((o) => o.v === value);
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const n = nodes.current[idx], b = box.current;
    if (idx < 0 || !n || !b) return setPos(null);
    const nr = n.getBoundingClientRect(), br = b.getBoundingClientRect();
    setPos({ x: nr.left + nr.width / 2 - br.left, y: nr.top + nr.height / 2 - br.top });
  }, [idx]);
  const sel = options[idx];
  return (
    <div ref={box} className="relative overflow-hidden rounded-2xl border border-line bg-ink-950/60 px-5 pb-11 pt-6">
      {sel && pos && (
        <div className="pointer-events-none absolute inset-0 transition-[background] duration-500"
          style={{ background: `radial-gradient(circle at ${pos.x}px ${pos.y + 160}px, ${sel.color}33 0%, ${sel.color}14 32%, transparent 70%)` }} />
      )}
      <div className="relative z-10 flex items-center" role="radiogroup" aria-label="Überzeugung">
        {options.map((o, i) => {
          const on = idx >= i, next = options[i + 1];
          return (
            <div key={o.v} className={cn('flex items-center', next && 'flex-1')}>
              <button ref={(el) => { nodes.current[i] = el; }} type="button" role="radio" aria-checked={value === o.v}
                onClick={() => onChange(value === o.v ? null : o.v)}
                className="relative grid size-7 shrink-0 place-items-center">
                <span className="rounded-full transition-all duration-300 hover:scale-110"
                  style={{ width: 11 + i * 1.5, height: 11 + i * 1.5, background: on ? o.color : 'rgb(255 255 255 / 0.16)', boxShadow: on ? `0 0 16px ${o.color}40` : 'none' }} />
                {value === o.v && Array.from({ length: 12 }, (_, k) => {
                  const a = (k / 12) * Math.PI * 2, x = Math.cos(a) * 16, y = Math.sin(a) * 16;
                  return (
                    <motion.span key={k} className="absolute left-1/2 top-1/2 size-1 rounded-full" style={{ background: o.color }}
                      initial={{ opacity: 0, scale: 0.3, rotate: -90, x: x - 2, y: y - 2 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0, x: x - 2, y: y - 2 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25, delay: k * 0.03 }} />
                  );
                })}
                <span className="absolute left-1/2 top-[calc(100%+10px)] -translate-x-1/2 whitespace-nowrap text-[11.5px] font-semibold transition-colors"
                  style={{ color: on ? o.color : '#5d6c7f' }}>{o.label}</span>
              </button>
              {next && (
                <span className="mx-2 h-1 flex-1 rounded-full transition-all duration-300"
                  style={{ background: idx > i ? `linear-gradient(to right, ${o.color}, ${next.color})` : 'rgb(255 255 255 / 0.10)' }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Hover Footer / Text Hover Effect (21st.dev · mdafsarx) ─
export function TextHoverEffect({ text }: { text: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const [mask, setMask] = useState({ cx: '50%', cy: '50%' });
  const id = useId().replace(/:/g, '');
  useEffect(() => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    setMask({ cx: `${((cursor.x - r.left) / r.width) * 100}%`, cy: `${((cursor.y - r.top) / r.height) * 100}%` });
  }, [cursor]);
  return (
    <svg ref={svgRef} width="100%" height="100%" viewBox="0 0 600 90" xmlns="http://www.w3.org/2000/svg" className="select-none"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })} aria-hidden="true">
      <defs>
        <linearGradient id={`tg${id}`} gradientUnits="userSpaceOnUse">
          {hovered && <><stop offset="0%" stopColor="#8a8a8a" /><stop offset="40%" stopColor="#ffffff" /><stop offset="65%" stopColor="#e5202e" /><stop offset="100%" stopColor="#8a8a8a" /></>}
        </linearGradient>
        <motion.radialGradient id={`rm${id}`} gradientUnits="userSpaceOnUse" r="22%" initial={{ cx: '50%', cy: '50%' }} animate={mask} transition={{ duration: 0.1, ease: 'easeOut' }}>
          <stop offset="0%" stopColor="white" /><stop offset="100%" stopColor="black" />
        </motion.radialGradient>
        <mask id={`m${id}`}><rect x="0" y="0" width="100%" height="100%" fill={`url(#rm${id})`} /></mask>
      </defs>
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" strokeWidth="0.4" className="fill-transparent stroke-line-2 font-sans text-[72px] font-bold" style={{ opacity: hovered ? 0.8 : 0 }}>{text}</text>
      <motion.text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" strokeWidth="0.4" className="fill-transparent stroke-line-2 font-sans text-[72px] font-bold"
        initial={{ strokeDashoffset: 1000, strokeDasharray: 1000 }} animate={{ strokeDashoffset: 0, strokeDasharray: 1000 }} transition={{ duration: 4, ease: 'easeInOut' }}>{text}</motion.text>
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" stroke={`url(#tg${id})`} strokeWidth="0.4" mask={`url(#m${id})`} className="fill-transparent font-sans text-[72px] font-bold">{text}</text>
    </svg>
  );
}

// ── Reveal Text (21st.dev · isaiahbjork) ───────────────
export function RevealText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('relative inline-flex overflow-hidden', className)} aria-label={text}>
      {text.split('').map((ch, i) => (
        <motion.span key={i} aria-hidden="true" className="inline-block whitespace-pre"
          initial={{ y: '110%', opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.1 + i * 0.035 }}>{ch}</motion.span>
      ))}
      <motion.span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-white/30 to-transparent"
        initial={{ left: '-20%' }} animate={{ left: '120%' }} transition={{ delay: 0.7, duration: 1.1, ease: 'easeInOut' }} />
    </span>
  );
}

// ── Mesh Gradient Hero-Hintergrund (21st.dev · paper-design) ─
export function MeshBackdrop({ className }: { className?: string }) {
  return (
    <div className={cn('absolute inset-0 overflow-hidden', className)} aria-hidden="true">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(110% 90% at 0% 0%, #2c2c2c 0%, transparent 55%), radial-gradient(80% 70% at 100% 100%, #222 0%, transparent 60%), linear-gradient(160deg, #151515, #0d0d0d)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.07) 1px, transparent 0) 0 0 / 18px 18px' }} />
    </div>
  );
}

// ── Kleine Bausteine ───────────────────────────────────
export function Card({ children, className, title, action, note }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; note?: ReactNode }) {
  return (
    <MagicCard className={cn('h-full', className)}>
      <div className="flex h-full flex-col p-5">
        {(title || action || note) && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {title && <h2 className="label flex items-center gap-2"><span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />{title}</h2>}
            {note && <span className="text-xs text-faint">{note}</span>}
            {action}
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </MagicCard>
  );
}

export function Pill({ children, tone = 'mute', className }: { children: ReactNode; tone?: 'win' | 'loss' | 'warn' | 'mute' | 'steel' | 'teal'; className?: string }) {
  const t = {
    win: 'bg-win/12 text-win border-win/25', loss: 'bg-loss/12 text-loss border-loss/25', warn: 'bg-warn/12 text-warn border-warn/25',
    mute: 'bg-white/[0.04] text-mute border-line-2', steel: 'bg-steel/12 text-steel border-steel/25', teal: 'bg-teal/12 text-aqua border-teal/25',
  }[tone];
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', t, className)}>{children}</span>;
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="grid h-full min-h-[180px] place-items-center rounded-xl border border-dashed border-line-2 p-6 text-center">
      <div className="grid justify-items-center gap-2">
        <strong className="text-[14px] font-semibold text-fg">{title}</strong>
        <span className="max-w-[38ch] text-[13px] text-mute">{text}</span>
        {action}
      </div>
    </div>
  );
}

export function Btn({ children, onClick, variant = 'ghost', size = 'md', className, type = 'button', disabled }:
  { children: ReactNode; onClick?: () => void; variant?: 'ghost' | 'primary' | 'danger'; size?: 'sm' | 'md'; className?: string; type?: 'button' | 'submit'; disabled?: boolean }) {
  const v = {
    ghost: 'border-line-2 bg-white/[0.03] text-fg hover:bg-white/[0.07] hover:border-steel/40',
    primary: 'border-transparent bg-gradient-to-b from-white to-[#d6d6d6] text-ink-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)] hover:to-white',
    danger: 'border-signal/40 bg-signal/10 text-[#ff8a90] hover:bg-signal/20',
  }[variant];
  return (
    <motion.button type={type} disabled={disabled} onClick={onClick} whileTap={disabled ? undefined : { scale: 0.96 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-[13px]', v, className)}>
      {children}
    </motion.button>
  );
}

/** Animierte Checkbox-Zeile für Checklisten. */
export function CheckRow({ checked, onToggle, children, sub }: { checked: boolean; onToggle: () => void; children: ReactNode; sub?: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onToggle}
      className={cn('flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors duration-200',
        checked ? 'border-teal/35 bg-teal/[0.07]' : 'border-line bg-ink-950/40 hover:border-line-2')}>
      <span className={cn('mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-md border transition-colors duration-200', checked ? 'border-teal bg-teal' : 'border-line-2')}>
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="#0a1018" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M3.5 8.5l3 3 6-7" initial={false} animate={{ pathLength: checked ? 1 : 0 }} transition={{ duration: 0.25 }} />
        </svg>
      </span>
      <span className="grid gap-0.5">
        <span className={cn('text-[13px]', checked ? 'text-fg' : 'text-mute')}>{children}</span>
        {sub && <span className="text-[11px] text-faint">{sub}</span>}
      </span>
    </button>
  );
}

export function Field({ label, children, help, className, htmlFor }: { label: ReactNode; children: ReactNode; help?: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1.5', className)}>
      <label htmlFor={htmlFor} className="label">{label}</label>
      {children}
      {help && <span className="text-[11px] text-faint">{help}</span>}
    </div>
  );
}
export const inputCls = 'w-full rounded-xl border border-line bg-ink-950/70 px-3 py-2 text-[13.5px] text-fg outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-faint focus:border-white/40 focus:shadow-[0_0_0_3px_rgb(255_255_255/0.07)] disabled:opacity-40';

export const Icon = {
  grid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>,
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>,
  target: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></svg>,
  sliders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
};

// ── Aufklappbare Statistik-Details (21st.dev · ibelick / motion-primitives Disclosure) ─
/** Runder Plus-Knopf, der sich beim Öffnen zum Kreuz dreht. */
export function InfoToggle({ open, onClick, label, className }: { open: boolean; onClick: () => void; label: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={`${open ? 'Details schließen' : 'Details zeigen'}: ${label}`}
      className={cn('grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-200',
        open ? 'border-white bg-white text-ink-950' : 'border-line-2 text-mute hover:border-white/50 hover:text-fg', className)}>
      <motion.svg viewBox="0 0 12 12" className="size-2.5" animate={{ rotate: open ? 45 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 26 }}
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 1.5v9M1.5 6h9" /></motion.svg>
    </button>
  );
}

export function Expand({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="x" className={cn('overflow-hidden', className)}
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type DetailData = {
  title: string;
  what: string;
  formula?: ReactNode;
  rows?: [string, ReactNode, string?][];
  verdict?: { tone: 'win' | 'loss' | 'warn' | 'mute'; text: string };
};
/** Einheitlicher Erklär-Block: was misst die Zahl, wie wird sie berechnet, deine Werte, Einordnung. */
export function Detail({ d, bare }: { d: DetailData; bare?: boolean }) {
  const vt = d.verdict && { win: 'border-win/30 text-win', loss: 'border-loss/30 text-loss', warn: 'border-warn/30 text-warn', mute: 'border-line-2 text-mute' }[d.verdict.tone];
  return (
    <div className={cn('grid gap-3', !bare && 'mt-3 rounded-2xl border border-line-2 bg-gradient-to-b from-ink-750 to-ink-850 p-4')}>
      {!bare && <div className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-signal" /><span className="label !text-fg">{d.title}</span></div>}
      <p className="max-w-[70ch] text-[13px] leading-relaxed text-mute">{d.what}</p>
      {d.formula && <div className="rounded-xl border border-line bg-ink-950/70 px-3 py-2 font-mono text-[12px] leading-relaxed text-fg/90">{d.formula}</div>}
      {d.rows && d.rows.length > 0 && (
        <dl className="grid gap-x-6 sm:grid-cols-2">
          {d.rows.map(([l, v, c]) => (
            <div key={l} className="flex justify-between gap-3 border-t border-line py-1.5 text-[12.5px]">
              <dt className="text-mute">{l}</dt><dd className={cn('num text-right font-mono', c || 'text-fg')}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.verdict && <p className={cn('rounded-xl border px-3 py-2 text-[12.5px]', vt)}>{d.verdict.text}</p>}
    </div>
  );
}

// ── Hover Effect (21st.dev · serafimcloud / Aceternity) ─
/** Hervorhebung, die per layoutId zur gerade gehoverten Zeile gleitet. */
export function useHoverSlide() {
  const [hovered, setHovered] = useState<number | null>(null);
  const bind = (i: number) => ({ onMouseEnter: () => setHovered(i), onMouseLeave: () => setHovered((h) => (h === i ? null : h)) });
  return { hovered, bind };
}
export function HoverSlide({ show, group, className }: { show: boolean; group: string; className?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span layoutId={`hover-${group}`} aria-hidden="true"
          className={cn('pointer-events-none absolute inset-0 -z-0 rounded-xl bg-white/[0.055] ring-1 ring-white/[0.08]', className)}
          initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.15 } }} exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.15 } }}
          transition={contextSpring()} />
      )}
    </AnimatePresence>
  );
}

// ── Magnetic (21st.dev · ibelick / motion-primitives) ──
/** Element folgt dem Cursor mit weicher, nachschwingender Feder (Wassertropfen-Gefühl). Nur bei Hover aktiv. */
export function Magnetic({ children, intensity = 0.35, range = 90, className }: { children: ReactNode; intensity?: number; range?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 26.7, damping: 4.1, mass: 0.2 }), sy = useSpring(y, { stiffness: 26.7, damping: 4.1, mass: 0.2 });
  const move = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const k = Math.max(0, 1 - Math.hypot(dx, dy) / range);
    x.set(dx * intensity * k); y.set(dy * intensity * k);
  };
  return (
    <motion.span ref={ref} className={cn('inline-flex', className)} style={{ x: sx, y: sy }}
      onPointerMove={(e) => e.pointerType === 'mouse' && move(e)} onPointerLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.span>
  );
}

// ── Tilt (21st.dev · ibelick / motion-primitives) ──────
/** Leichte 3D-Neigung zur Maus, federnd zurück beim Verlassen. */
export function Tilt({ children, className, factor = 6 }: { children: ReactNode; className?: string; factor?: number }) {
  const x = useMotionValue(0.5), y = useMotionValue(0.5);
  const sx = useSpring(x, { stiffness: 220, damping: 18 }), sy = useSpring(y, { stiffness: 220, damping: 18 });
  const rx = useTransform(sy, [0, 1], [factor, -factor]), ry = useTransform(sx, [0, 1], [-factor, factor]);
  return (
    <motion.div className={cn('[transform-style:preserve-3d]', className)} style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => { if (e.pointerType !== 'mouse') return; const r = e.currentTarget.getBoundingClientRect(); x.set((e.clientX - r.left) / r.width); y.set((e.clientY - r.top) / r.height); }}
      onPointerLeave={() => { x.set(0.5); y.set(0.5); }}>
      {children}
    </motion.div>
  );
}
