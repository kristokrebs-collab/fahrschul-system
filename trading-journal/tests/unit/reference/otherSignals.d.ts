// Types of the verbatim reference copy (`otherSignals.js`), expressed with our structurally identical types.
import type { Bar, BarsByTf, BestVerdict, Side, SignalCfg, SignalSnap, Signals, TfCheck, Verdict, WtSignal, ZoneInfo } from "@/domain/signals";

export const DEFAULT_SIGNAL_CFG: SignalCfg;
export const SIGNAL_TFS: string[];
export const STRENGTH_LABEL: string[];
export function tfSeconds(tf: string): number;
export function withLivePrice(bars: Bar[], sec: number, price: number, atMs: number): Bar[];
export function ema(src: number[], len: number): number[];
export function sma(src: number[], len: number): number[];
export function rma(src: number[], len: number): number[];
export function rsi(close: number[], len?: number): number[];
export function waveTrend(bars: Bar[], cfg: Pick<SignalCfg, "wtSource" | "wtChannel" | "wtAverage" | "wtSignal">): { wt1: number[]; wt2: number[] };
export function wtSignal(wt1: number[], wt2: number[], cfg: SignalCfg, close?: number[]): WtSignal;
export function pdZone(bars: Bar[], lookback: number): ZoneInfo;
export function luxZone(bars: Bar[], size?: number): ZoneInfo | null;
export function checkTf(tf: string, bars: Bar[], cfg: SignalCfg): TfCheck | null;
export function verdict(side: Side, checks: (TfCheck | null)[], cfg: SignalCfg, zoneCheck?: TfCheck | null): Verdict;
export function bestVerdict(checks: (TfCheck | null)[], cfg: SignalCfg, zoneCheck?: TfCheck | null): BestVerdict;
export function computeSignals(bars: BarsByTf | undefined, cfg: SignalCfg): Signals | null;
export function signalsAt(bars: BarsByTf | undefined, cfg: SignalCfg, atMs: number): Signals | null;
export function snapshot(sig: Signals, side: Side): SignalSnap;
