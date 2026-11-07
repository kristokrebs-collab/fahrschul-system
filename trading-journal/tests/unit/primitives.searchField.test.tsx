/**
 * `SearchField`: the shared clay search field. Plain mode (searchbox, clear, status, chips) and combobox mode (answers in a
 * listbox, ↑ ↓ Enter Esc, `aria-activedescendant`, live status, honest empty state). The look and the motion are in `controls.css`
 * and measured in the e2e specs; here: roles, keys and states.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchField, type SearchChip, type SearchFieldProps, type SearchOption } from "@/primitives/SearchField";
import { installDomPolyfills } from "./views.overview.harness";

installDomPolyfills();

const OPTIONS: SearchOption[] = [
  { id: "a", label: "Alpha", description: "erste", meta: "Gruppe · Ort", attrs: { "data-feature": "a" } },
  { id: "b", label: "Beta", description: "zweite" },
  { id: "c", label: "Gamma" },
];

function Harness({ start = "", options, ...rest }: Partial<SearchFieldProps> & { start?: string }) {
  const [v, setV] = useState(start);
  return <SearchField label="Suche" value={v} onChange={setV} options={options} {...rest} />;
}

describe("plain field", () => {
  it("is a searchbox with a label; the clear button is out of reach until there is text, then clears and keeps the focus", () => {
    render(<Harness placeholder="Suchen …" />);
    const input = screen.getByRole("searchbox", { name: "Suche" });
    const clear = screen.getByTestId("search-field-clear");
    expect(clear).toHaveAttribute("tabindex", "-1");
    expect(clear).toHaveAttribute("aria-hidden", "true");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(clear).toHaveAttribute("tabindex", "0");
    expect(clear).not.toHaveAttribute("aria-hidden");
    expect(screen.getByTestId("search-field")).toHaveAttribute("data-has-value");
    fireEvent.click(screen.getByRole("button", { name: "Suche leeren" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("the status line is a polite live region (not a toast: no role=status) and shows what the caller says", () => {
    render(<Harness status="3 Funde" />);
    const status = screen.getByTestId("search-field-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).not.toHaveAttribute("role");
    expect(status).toHaveTextContent("3 Funde");
  });

  it("Enter hands the text to onSubmit; Escape clears first (and is consumed), the next one bubbles", () => {
    const onSubmit = vi.fn();
    const parentKey = vi.fn();
    render(
      <div onKeyDown={parentKey}>
        <Harness start="Wort" onSubmit={onSubmit} />
      </div>,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Wort");
    parentKey.mockClear();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(parentKey).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(parentKey).toHaveBeenCalledTimes(1);
  });

  it("chips are a labelled group of toggle buttons with counts", () => {
    const onChip = vi.fn();
    const chips: SearchChip[] = [
      { id: "all", label: "Alles", count: 5 },
      { id: "page", label: "Seiten", count: 2 },
    ];
    render(<Harness chips={chips} chipValue="all" onChipChange={onChip} chipsLabel="Eingrenzen" />);
    const group = screen.getByRole("group", { name: "Eingrenzen" });
    const [all, pages] = within(group).getAllByRole("button");
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(pages).toHaveAttribute("aria-pressed", "false");
    expect(pages).toHaveTextContent("Seiten2");
    fireEvent.click(pages!);
    expect(onChip).toHaveBeenCalledWith("page");
  });

  it("sizes: lg / md / sm (sm is 44 px on touch, see controls.css)", () => {
    const { rerender } = render(<Harness size="sm" />);
    expect(screen.getByTestId("search-field")).toHaveAttribute("data-size", "sm");
    rerender(<Harness size="lg" />);
    expect(screen.getByTestId("search-field")).toHaveAttribute("data-size", "lg");
  });
});

describe("combobox", () => {
  it("is a combobox that points at its listbox; closed while empty, open with answers, the first one active", () => {
    render(<Harness options={OPTIONS} />);
    const input = screen.getByRole("combobox", { name: "Suche" });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("search-field-panel")).not.toHaveAttribute("data-open");
    fireEvent.change(input, { target: { value: "a" } });
    expect(input).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox", { name: "Suche" });
    expect(input).toHaveAttribute("aria-controls", list.id);
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["AlphaersteGruppe · Ort", "Betazweite", "Gamma"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("data-feature", "a");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(screen.getByTestId("search-field-status")).toHaveTextContent("3 Treffer");
  });

  it("↓ ↑ move the active answer and wrap; the keys are consumed so a surrounding menu keeps its own", () => {
    const parentKey = vi.fn();
    render(
      <div onKeyDown={parentKey}>
        <Harness options={OPTIONS} start="x" />
      </div>,
    );
    const input = screen.getByRole("combobox");
    const active = () => document.getElementById(input.getAttribute("aria-activedescendant")!)!.textContent;
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()).toMatch(/^Beta/);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()).toMatch(/^Alpha/);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(active()).toMatch(/^Gamma/);
    expect(parentKey).not.toHaveBeenCalled();
  });

  it("without answers the arrows are not consumed – the menu around may use them", () => {
    const parentKey = vi.fn();
    render(
      <div onKeyDown={parentKey}>
        <Harness options={[]} start="zzz" />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(parentKey).toHaveBeenCalledTimes(1);
  });

  it("Enter chooses the active answer (the first when none was moved to); a click chooses the clicked one", () => {
    const onSelect = vi.fn();
    render(<Harness options={OPTIONS} start="x" onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("a", "enter");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("b", "enter");
    fireEvent.click(screen.getAllByRole("option")[2]!);
    expect(onSelect).toHaveBeenLastCalledWith("c", "click");
  });

  it("a pointer move over an answer makes it the active one (a touch tap does not)", () => {
    render(<Harness options={OPTIONS} start="x" />);
    const input = screen.getByRole("combobox");
    const opts = screen.getAllByRole("option");
    fireEvent.pointerMove(opts[1]!, { pointerType: "mouse" });
    expect(input).toHaveAttribute("aria-activedescendant", opts[1]!.id);
    fireEvent.pointerMove(opts[2]!, { pointerType: "touch" });
    expect(input).toHaveAttribute("aria-activedescendant", opts[1]!.id);
  });

  it("no answer is said, not hidden: status 'Kein Treffer' and the caller's empty state; Enter does nothing", () => {
    const onSelect = vi.fn();
    render(<Harness options={[]} start="zzz" onSelect={onSelect} empty={<p>Nichts gefunden. Alle ansehen</p>} />);
    expect(screen.getByTestId("search-field-status")).toHaveTextContent("Kein Treffer");
    expect(screen.getByTestId("search-field-empty")).toHaveTextContent("Nichts gefunden");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("emptying the field folds the box shut (inert) but keeps the last answers inside while it does", () => {
    render(<Harness options={OPTIONS} start="x" />);
    const input = screen.getByRole("combobox");
    const panelIn = document.querySelector<HTMLElement>(".sf-panel-in")!;
    expect(panelIn.hasAttribute("inert")).toBe(false);
    fireEvent.change(input, { target: { value: "" } });
    expect(panelIn.hasAttribute("inert")).toBe(true);
    expect(screen.queryAllByRole("option", { hidden: true })).toHaveLength(3);
  });

  it("a status given by the caller wins ('Suche …'); popover mode puts the answers next to the field, not after the chips", () => {
    render(<Harness options={OPTIONS} start="x" status="Suche …" listMode="popover" />);
    expect(screen.getByTestId("search-field-status")).toHaveTextContent("Suche …");
    expect(screen.getByTestId("search-field-panel")).toHaveAttribute("data-mode", "popover");
    expect(document.querySelector(".sf-anchor")!.contains(screen.getByTestId("search-field-panel"))).toBe(true);
  });
});
