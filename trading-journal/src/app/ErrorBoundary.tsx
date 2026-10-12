import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/cloud";
import { cn } from "@/lib/cn";
import { DotMatrix, mulberry32, textFrame, type DotFrame } from "@/motion";
import { fxTiming } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";

/**
 * Error boundary in the Nothing look (P13). Three sizes:
 *   - `app`    whole shell (`App` → integrator): full-height ink stage, "Neu laden" reloads the page,
 *   - `page`   one page (around `renderPage`): the shell stays usable, "Erneut versuchen" re-mounts the page,
 *   - `widget` one cockpit widget / card: a compact tile, the rest of the dashboard keeps running.
 * The mark is a dot-matrix "ERR" that glitches ONCE (a few corrupted frames at `fxTiming.matrixFps`, then rests on the
 * clean word; reduced motion: the clean word). Every catch goes to `reportError` (P09: only sent with the trader's
 * opt-in, scrubbed, deduplicated). `resetKeys` re-arms the boundary when they change (e.g. the page key).
 */

export const ERROR_STRINGS = {
  title: "Hier ist etwas schiefgelaufen.",
  widgetTitle: "Dieses Widget hat einen Fehler.",
  lead: "Deine gespeicherten Daten bleiben erhalten. Lade neu – meistens ist der Fehler dann weg.",
  retry: "Erneut versuchen",
  reload: "Neu laden",
  details: "Technische Details",
} as const;

/** Glitch frames for `text` (seeded, so tests and replays are stable): corrupted variants, then the clean word. */
export function glitchFrames(text: string, count = 6, seed = 7): DotFrame[] {
  const clean = textFrame(text);
  const rand = mulberry32(seed);
  const frames: DotFrame[] = [];
  for (let k = 0; k < count; k++) {
    const shift = k % 3 === 1 ? 1 : k % 3 === 2 ? -1 : 0;
    frames.push(
      clean.map((row, r) =>
        row.map((_, c) => {
          const src = row[c - shift] ?? 0;
          const flip = rand() < 0.16 - k * 0.02;
          // a row band tears sideways on odd frames
          const torn = k % 2 === 1 && r === (k * 3) % 7 ? (row[c + 2] ?? 0) : src;
          return flip ? 1 - torn : torn;
        }),
      ),
    );
  }
  frames.push(clean);
  return frames;
}

export function GlitchMark({ text = "ERR", size = 5, className }: { text?: string; size?: number; className?: string }) {
  const reduced = useReducedFx();
  const frames = useMemo(() => glitchFrames(text), [text]);
  const clean = useMemo(() => [frames[frames.length - 1]!], [frames]);
  const [resting, setResting] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const id = setTimeout(() => setResting(true), ((frames.length - 1) * 1000) / fxTiming.matrixFps);
    return () => clearTimeout(id);
  }, [frames, reduced]);
  return <DotMatrix frames={resting || reduced ? clean : frames} fps={fxTiming.matrixFps} size={size} gap={Math.max(1, size / 2.5)} tone="signal" label={text} className={className} />;
}

export interface ErrorFallbackProps {
  error: Error;
  variant: "app" | "page" | "widget";
  /** what broke ("Widget Monte Carlo") for the widget tile */
  label?: string;
  onRetry?: () => void;
}

export function ErrorFallback({ error, variant, label, onRetry }: ErrorFallbackProps) {
  const reload = () => window.location.reload();
  if (variant === "widget") {
    return (
      <div role="alert" className="grid h-full min-h-[160px] content-center justify-items-center gap-3 rounded-2xl border border-line bg-ink-850 p-5 text-center" data-error-boundary="widget">
        <GlitchMark size={3} />
        <p className="text-[13px] font-medium text-fg">{label ? `${label}: ` : ""}{ERROR_STRINGS.widgetTitle}</p>
        {onRetry && (
          <Button size="sm" onClick={onRetry}>
            {ERROR_STRINGS.retry}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-error-boundary={variant}
      className={cn("grid content-center justify-items-center gap-5 px-6 text-center", variant === "app" ? "min-h-dvh bg-ink-900" : "min-h-[52vh] rounded-[28px] border border-line bg-ink-850 py-14")}
    >
      <GlitchMark size={variant === "app" ? 7 : 6} />
      <div className="grid max-w-[42ch] gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">{ERROR_STRINGS.title}</h1>
        <p className="text-[13.5px] leading-relaxed text-mute">{ERROR_STRINGS.lead}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        {variant === "page" && onRetry && <Button onClick={onRetry}>{ERROR_STRINGS.retry}</Button>}
        <Button variant="primary" onClick={reload}>
          {ERROR_STRINGS.reload}
        </Button>
      </div>
      <details className="max-w-[60ch] text-left text-[11.5px] text-mute">
        <summary className="cursor-pointer select-none text-center">{ERROR_STRINGS.details}</summary>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-ink-950 p-3 font-mono">{error.message || String(error)}</pre>
      </details>
    </div>
  );
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  variant?: "app" | "page" | "widget";
  label?: string;
  /** a change re-arms the boundary (e.g. the current page) */
  resetKeys?: readonly unknown[];
  /** custom fallback (still reported) */
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  keys: readonly unknown[] | undefined;
}

const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !!a && !!b && (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i])));

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null, keys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    if (changed(state.keys, props.resetKeys)) return { error: null, keys: props.resetKeys };
    if (state.keys !== props.resetKeys) return { keys: props.resetKeys };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError(error, { source: "boundary", componentStack: info.componentStack ?? undefined, extra: { variant: this.props.variant ?? "page" } });
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    return <ErrorFallback error={error} variant={this.props.variant ?? "page"} label={this.props.label} onRetry={this.retry} />;
  }
}
