/**
 * F43 – the event filter row of the Labor's Filtervergleich: switch, minutes, kinds (the last kind cannot be switched off), the
 * stored choice, and the reason why FOMC and own appointments are not offered.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installDomPolyfills } from "./views.overview.harness";

const { EventFilterRow } = await import("@/views/labor/EventFilter");
const { useExtras } = await import("@/views/labor/extrasStore");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { sanitizeFilters } = await import("@/domain/lab/filters/types");

const wrap = () =>
  render(
    <MotionRoot>
      <ul>
        <EventFilterRow />
      </ul>
    </MotionRoot>,
  );

beforeAll(() => installDomPolyfills());
beforeEach(() => {
  localStorage.clear();
  useExtras.setState({ selection: sanitizeFilters(null) });
});

describe("Labor – Keine Einstiege rund um Termine", () => {
  it("is off by default and shows its sentence; switching it on offers minutes and kinds", () => {
    wrap();
    const row = screen.getByTestId("labor-filter");
    expect(row).toHaveAttribute("data-filter", "event");
    expect(row).toHaveTextContent("Kein Einstieg X Minuten vor oder nach einem Termin");
    expect(screen.queryByTestId("labor-filter-event-kind-funding")).toBeNull();
    fireEvent.click(screen.getByTestId("labor-filter-switch-event"));
    expect(useExtras.getState().selection.on).toEqual(["event"]);
    expect(screen.getByTestId("labor-filter-event-kind-funding")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "60" })).toHaveAttribute("aria-checked", "true");
  });

  it("stores the minutes and keeps at least one kind", () => {
    wrap();
    fireEvent.click(screen.getByTestId("labor-filter-switch-event"));
    fireEvent.click(screen.getByRole("radio", { name: "120" }));
    expect(useExtras.getState().selection.eventMinutes).toBe(120);
    fireEvent.click(screen.getByTestId("labor-filter-event-kind-funding"));
    fireEvent.click(screen.getByTestId("labor-filter-event-kind-expiry"));
    expect(useExtras.getState().selection.eventKinds).toEqual(["usOpen"]);
    // the last kind stays on: the filter would do nothing without one
    fireEvent.click(screen.getByTestId("labor-filter-event-kind-usOpen"));
    expect(useExtras.getState().selection.eventKinds).toEqual(["usOpen"]);
    expect(screen.getByTestId("labor-filter-event-kind-usOpen")).toHaveAttribute("aria-pressed", "true");
    // the choice survives a reload of the store from localStorage
    expect(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith("labor-filters"))!)!)).toMatchObject({ on: ["event"], eventMinutes: 120, eventKinds: ["usOpen"] });
  });

  it("says why FOMC dates and own appointments are not offered", () => {
    wrap();
    const d = within(screen.getByTestId("labor-filter")).getByText("Warum nicht FOMC und eigene Termine?");
    fireEvent.click(d);
    expect(screen.getByTestId("labor-filter-event-reason")).toHaveTextContent("FOMC-Termine liegen nur für 2021–2027 vor");
  });
});
