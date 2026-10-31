/** One labelled switch row of the Alarme card (and its e-mail section): label, one help line, the elastic `Switch`. */
import { cn } from "@/lib/cn";
import { Switch } from "@/motion/Switch";

export function SwitchRow({ id, label, help, checked, onChange, disabled }: { id: string; label: string; help: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 transition-opacity duration-200", disabled && "opacity-50")}>
      <span className="grid min-w-0 gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-[13px] text-fg">
          {label}
        </label>
        <span id={`${id}-help`} className="text-[11px] text-faint">
          {help}
        </span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-help`} disabled={disabled} className="touch-hit mt-0.5 shrink-0" />
    </div>
  );
}
