import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/heute", label: "Heute", icon: "🏠" },
  { to: "/ausbildung", label: "Ausbildung", icon: "🎓" },
  { to: "/termine", label: "Termine", icon: "📅" },
  { to: "/lernen", label: "Lernen", icon: "📘" },
  { to: "/mehr", label: "Mehr", icon: "⋯" },
] as const;

/** Bottom-Nav-Pattern aus app.html (siehe docs/prototype-audit.md). */
export function BottomNav() {
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
