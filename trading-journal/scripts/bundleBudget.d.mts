export interface Budgets {
  initialJs: number;
  initialCss: number;
  chunk: number;
  named: Record<string, number>;
}
export interface MeasuredFile {
  file: string;
  gzip: number;
  initial: boolean;
  raw?: number;
}
export declare const BUDGETS: Budgets;
export declare const LAZY_P13: readonly string[];
export declare function kib(bytes: number): number;
export declare function initialAssets(html: string): { js: string[]; css: string[] };
export declare function chunkName(file: string): string;
export declare function checkBudgets(files: readonly MeasuredFile[], budgets?: Budgets): { breaches: string[]; initialJs: number; initialCss: number };
export declare function measure(dist: string): (MeasuredFile & { raw: number })[];
