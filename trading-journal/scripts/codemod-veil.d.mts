export declare const TOKEN_OF_HEX: Record<string, string>;
export interface VeilChange {
  from: string;
  to: string;
}
export interface VeilLeft {
  kind: "class" | "string" | "rgb-class";
  text: string;
}
export declare function transform(src: string): { text: string; changes: VeilChange[]; left: VeilLeft[]; veils: number };
