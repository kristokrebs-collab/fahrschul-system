import { NavLink } from "react-router-dom";
import { useDriveLock } from "../state/DriveLockContext.js";

const TABS = [
  { to: "/heute", label: "Heute", icon: "🏠" },
  { to: "/schueler", label: "Schüler", icon: "🧑‍🎓" },
  { to: "/dokumentieren", label: "Dokumentieren", icon: "🎙️" },
  { to: "/fahrzeug", label: "Fahrzeug", icon: "🚗" },
  { to: "/mehr", label: "Mehr", icon: "⋯" },
] as const;

/**
 * Bottom-Nav-Pattern aus apps/student portiert. Rendert wortwörtlich NICHTS
 * (kein `<nav>`-Element, keine Links im DOM), solange Drive Lock Mode aktiv
 * ist – kein per CSS verstecktes/deaktiviertes Element, das theoretisch
 * noch anklickbar wäre.
 */
export function BottomNav() {
  const { locked } = useDriveLock();
  if (locked) return null;

  return (
    <nav className="bottom-nav" aria-label="Hauptnavigation">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => "bottom-nav__item" + (isActive ? " bottom-nav__item--active" : "")}
          aria-label={tab.label}
        >
          <span aria-hidden="true">{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
