import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { fmt, stats, useCap, useJournal, useMarket, type Account, type AccountFilter, type ETrade, type Setup, type Settings, type Trade } from './lib';
import { Dock, DockItem, Icon, RevealText, ShinyButton, TextHoverEffect, TransitionPanel } from './ui';
import { Overview } from './overview';
import { NO_FILTER, SettingsView, SetupsView, TradesView, type Filters } from './pages';
import { SetupSheet, TradeSheet } from './forms';
import { IslandProvider, ProgressiveBlur, TradeQuickView, type IslandNote } from './island';

const VIEWS = ['overview', 'trades', 'setups', 'settings'] as const;
type View = (typeof VIEWS)[number];
const LABEL: Record<View, string> = { overview: 'Übersicht', trades: 'Trades', setups: 'Entscheidungsgrundlagen', settings: 'Einstellungen' };

function App() {
  const j = useJournal();
  const market = useMarket(j.settings.market.symbol);
  const [view, setView] = useState<View>(() => { const h = location.hash.slice(1) as View; return VIEWS.includes(h) ? h : 'overview'; });
  const [acc, setAcc] = useState<AccountFilter>('all');
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [tradeOpen, setTradeOpen] = useState<{ open: boolean; trade: Trade | null }>({ open: false, trade: null });
  const [setupOpen, setSetupOpen] = useState<{ open: boolean; setup: Setup | null; fromTrade?: boolean }>({ open: false, setup: null });
  const [downloads, setDownloads] = useState<any>(null);
  const [quick, setQuick] = useState<ETrade | null>(null);
  const notifyRef = useRef<(n: Omit<IslandNote, 'id'>) => void>(() => {});
  const notify = (n: Omit<IslandNote, 'id'>) => notifyRef.current(n);
  useEffect(() => { useCap('downloads').then(setDownloads); }, []);

  const st = useMemo(() => stats(j.enriched, j.settings, acc), [j.enriched, j.settings, acc]);
  const go = useCallback((v: View) => {
    setView(v);
    try { history.replaceState(null, '', '#' + v); } catch { /* egal */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const saveTrade = async (t: Trade) => {
    const isNew = !t.id;
    try {
      await j.api.current!.saveTrade(t);
      notify({ kind: 'success', title: isNew ? 'Trade gespeichert' : 'Trade aktualisiert', value: t.pnl != null ? fmt.signed(t.pnl) : 'offen', valueTone: t.pnl != null ? (t.pnl >= 0 ? 'win' : 'loss') : undefined });
    } catch (e) { notify({ kind: 'error', title: 'Speichern fehlgeschlagen' }); throw e; }
  };
  const deleteTrade = async (id: string) => { await j.api.current!.deleteTrade(id); notify({ kind: 'info', title: 'Trade gelöscht' }); };
  const saveSettings = (s: Settings) => j.api.current!.saveSettings(s);
  const saveSetup = async (s: Setup) => {
    const exists = j.settings.setups.some((x) => x.id === s.id);
    const next = { ...j.settings, setups: exists ? j.settings.setups.map((x) => (x.id === s.id ? s : x)) : [...j.settings.setups, s] };
    await saveSettings(next);
    notify({ kind: 'success', title: exists ? 'Grundlage aktualisiert' : 'Grundlage angelegt' });
  };
  const deleteSetup = async (id: string) => { await saveSettings({ ...j.settings, setups: j.settings.setups.filter((x) => x.id !== id) }); notify({ kind: 'info', title: 'Grundlage gelöscht' }); };
  const openNew = () => setTradeOpen({ open: true, trade: null });
  const openEdit = (t: ETrade) => setTradeOpen({ open: true, trade: j.trades.find((x) => x.id === t.id) || null });
  const showSetupTrades = (id: string) => { setFilters({ ...NO_FILTER, setup: id }); go('trades'); };
  const defaultAccount: Account = acc === 'makro' ? 'makro' : 'scalp';
  const usedBy = setupOpen.setup ? j.trades.filter((t) => (t.setups || []).includes(setupOpen.setup!.id)).length : 0;

  const sync = { cloud: ['Synchronisiert', 'bg-win'], local: ['Nur dieser Browser', 'bg-warn'], error: ['Offline', 'bg-loss'], connecting: ['Verbinde …', 'bg-faint'] }[j.mode];

  return (
    <MotionConfig reducedMotion="user">
    <IslandProvider market={market} settings={j.settings} onNew={openNew} bind={(fn) => { notifyRef.current = fn; }}>
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b border-line/80 bg-ink-900/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
          <button type="button" onClick={() => go('overview')} className="flex min-w-0 items-center gap-3 text-left">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold text-fg">₿</span>
            <span className="min-w-0">
              <RevealText text="Trade Journal" className="hidden text-[15px] font-semibold tracking-tight sm:inline-flex" />
              <span className="hidden truncate text-[11px] text-faint sm:block">Makro & Scalp · Entscheidungen, Win-Rate, Backtest</span>
            </span>
          </button>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[11.5px] text-mute" title={sync[0]}>
              <span className={`size-1.5 rounded-full ${sync[1]}`} /><span className="hidden sm:inline">{sync[0]}</span>
            </span>
            <ShinyButton onClick={openNew} className="max-sm:!px-3"><span className="size-3.5 [&>svg]:size-full">{Icon.plus}</span><span className="max-sm:sr-only">Trade eintragen</span></ShinyButton>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-40 pt-6 sm:px-6">
        {j.mode === 'local' && (
          <div className="mb-5 rounded-2xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13px] text-warn">
            <strong className="font-semibold">Lokaler Modus.</strong> Die Datenbank ist hier nicht erreichbar, Trades bleiben nur in diesem Browser. Öffne das Journal über claude.ai, damit es auf allen Geräten synchron ist.
          </div>
        )}
        <TransitionPanel activeIndex={VIEWS.indexOf(view)}>
          {[
            <Overview key="o" st={st} settings={j.settings} acc={acc} setAcc={setAcc} market={market} loaded={j.loaded}
              onNew={openNew} onEdit={setQuick} onSetup={showSetupTrades} goTrades={() => go('trades')} />,
            <TradesView key="t" all={j.enriched} settings={j.settings} f={filters} setF={setFilters} onEdit={setQuick} onNew={openNew} />,
            <SetupsView key="s" st={stats(j.enriched, j.settings, 'all')} settings={j.settings} onEdit={(s) => setSetupOpen({ open: true, setup: s })} onNew={() => setSetupOpen({ open: true, setup: null })} onTrades={showSetupTrades} />,
            <SettingsView key="e" settings={j.settings} trades={j.enriched} onSave={saveSettings} downloads={downloads} />,
          ]}
        </TransitionPanel>

        <footer className="mt-16 h-28 sm:h-36">
          <TextHoverEffect text="TRADE JOURNAL" />
        </footer>
      </main>

      <ProgressiveBlur />
      <nav className="fixed inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom,0px))] z-50 flex justify-center" aria-label="Navigation">
        <Dock className="border border-line-2 bg-ink-850/85 shadow-[0_18px_40px_rgb(0_0_0/0.5)] backdrop-blur-xl">
          {VIEWS.map((v) => (
            <DockItem key={v} label={LABEL[v]} active={view === v} onClick={() => go(v)}
              className={view === v ? 'bg-white text-ink-950' : 'bg-white/[0.05] text-mute hover:text-fg'}>
              {{ overview: Icon.grid, trades: Icon.list, setups: Icon.target, settings: Icon.sliders }[v]}
            </DockItem>
          ))}
          <span className="mb-2.5 h-7 w-px self-end bg-line-2" aria-hidden="true" />
          <DockItem label="Trade eintragen" onClick={openNew} className="bg-signal text-white">{Icon.plus}</DockItem>
        </Dock>
      </nav>

      <TradeSheet open={tradeOpen.open} trade={tradeOpen.trade} settings={j.settings} defaultAccount={defaultAccount}
        onClose={() => setTradeOpen({ open: false, trade: null })} onSave={saveTrade} onDelete={deleteTrade}
        onNewSetup={() => setSetupOpen({ open: true, setup: null, fromTrade: true })} />
      <SetupSheet open={setupOpen.open} setup={setupOpen.setup} settings={j.settings} usedBy={usedBy}
        onClose={() => setSetupOpen({ open: false, setup: null })} onSave={saveSetup} onDelete={deleteSetup} />
      <TradeQuickView trade={quick} settings={j.settings} onClose={() => setQuick(null)} onEdit={(t) => { setQuick(null); openEdit(t); }} />
    </IslandProvider>
    </MotionConfig>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
