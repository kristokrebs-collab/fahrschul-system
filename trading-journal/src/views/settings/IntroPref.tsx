import { useState } from "react";
import { INTRO_PREF_KEY, replayIntro } from "@/intro/introStore";
import { Switch } from "@/motion/Switch";
import { Button } from "@/primitives/Button";

/** localStorage key read by the intro host: `"off"` disables the start intro, anything else (or nothing) keeps it on. */
export { INTRO_PREF_KEY };

export const INTRO_STRINGS = {
  label: "Intro beim Start abspielen",
  help: "Einmal pro Sitzung baut sich das Journal beim Öffnen auf.",
  replay: "Intro jetzt abspielen",
} as const;

export function readIntroEnabled(): boolean {
  try {
    return localStorage.getItem(INTRO_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeIntroEnabled(on: boolean): void {
  try {
    localStorage.setItem(INTRO_PREF_KEY, on ? "on" : "off");
  } catch {
    // storage blocked: the preference only lasts for this view
  }
}

/** Intro preference row (Daten card): elastic `Switch` for the start intro + `Intro jetzt abspielen` (`replayIntro()`). */
export function IntroPref() {
  const [on, setOn] = useState(readIntroEnabled);
  return (
    <div className="mt-5 grid gap-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-4">
        <span className="grid gap-0.5">
          <label htmlFor="s-intro" className="cursor-pointer text-[13px] text-fg">
            {INTRO_STRINGS.label}
          </label>
          <span id="s-intro-help" className="text-[11px] text-faint">
            {INTRO_STRINGS.help}
          </span>
        </span>
        <Switch
          id="s-intro"
          className="touch-hit shrink-0"
          checked={on}
          aria-describedby="s-intro-help"
          onCheckedChange={(next) => {
            setOn(next);
            writeIntroEnabled(next);
          }}
        />
      </div>
      <Button size="sm" className="justify-self-start" onClick={() => replayIntro()}>
        {INTRO_STRINGS.replay}
      </Button>
    </div>
  );
}
