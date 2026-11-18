import { memo, type ReactNode } from "react";
import { Autocomplete, matchRange, type AutocompleteItem } from "@/motion/pulse/Autocomplete";
import { Field } from "@/primitives/Field";
import type { DraftTextKey } from "./draft";
import { ChangedDot } from "./fx";

const PREFIX = "BINANCE:";

/**
 * Common Binance USDⓈ-M perpetuals in the stored TradingView format (`BINANCE:<SYMBOL>`). Only suggestions: any other
 * value stays allowed and is validated by the market layer exactly as before (`resolveSymbol` + REST probe).
 */
export const BINANCE_FUTURES_SYMBOLS: readonly AutocompleteItem[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "TRXUSDT",
  "TONUSDT",
  "SUIUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "NEARUSDT",
  "ATOMUSDT",
  "ETCUSDT",
  "FILUSDT",
  "INJUSDT",
  "AAVEUSDT",
  "UNIUSDT",
  "WIFUSDT",
  "1000PEPEUSDT",
  "BTCUSDC",
  "ETHUSDC",
].map((s) => ({ value: `${PREFIX}${s}`, label: s }));

/** Rows show the bare symbol (fits a narrow column); typing with or without the `BINANCE:` prefix matches. */
export function symbolFilter(item: AutocompleteItem, query: string): boolean {
  return matchRange(item.label, query.trim().replace(/^binance:/i, "")) !== null;
}

export interface SymbolFieldProps {
  label: ReactNode;
  help?: ReactNode;
  value: string;
  onChange: (key: DraftTextKey, value: string) => void;
  changed?: boolean;
}

/**
 * `TradingView-Symbol` (`#s-symbol`) as a pulse `Autocomplete` over the common futures symbols; choosing one stores
 * `BINANCE:<SYMBOL>`, free text stays allowed (fallback `BINANCE:BTCUSDT` on save, unchanged).
 */
export const SymbolField = memo(function SymbolField({ label, help, value, onChange, changed = false }: SymbolFieldProps) {
  return (
    <Field
      label={
        <>
          {label}
          <ChangedDot show={changed} />
        </>
      }
      htmlFor="s-symbol"
      help={help}
    >
      <Autocomplete
        id="s-symbol"
        value={value}
        onChange={(v) => onChange("symbol", v)}
        suggestions={BINANCE_FUTURES_SYMBOLS}
        filter={symbolFilter}
        // the row shows the bare symbol; the draft always gets the stored `BINANCE:` format
        onSelect={(it) => onChange("symbol", it.value)}
      />
    </Field>
  );
});
