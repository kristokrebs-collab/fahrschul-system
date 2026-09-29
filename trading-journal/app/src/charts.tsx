import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt, tDate, type Stats } from './lib';
import { Empty } from './ui';

const axis = { fill: '#5d6c7f', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' };
const tipBox = 'rounded-xl border border-line-2 bg-ink-850/95 px-3 py-2 text-xs shadow-[0_12px_32px_rgb(0_0_0/0.45)] backdrop-blur-sm';
const axNum = (v: number) => Math.abs(v) >= 1e6 ? fmt.n1(v / 1e6) + ' Mio' : fmt.n0(v);

function Row({ l, v, cls = '' }: { l: string; v: string; cls?: string }) {
  return <div className="flex justify-between gap-5"><span className="text-mute">{l}</span><span className={'num font-mono font-medium ' + cls}>{v}</span></div>;
}

export function EquityChart({ st, cur }: { st: Stats; cur: string }) {
  if (!st.closed.length) return <Empty title="Noch keine Kurve" text="Deine Equity-Kurve startet beim Startkapital und bewegt sich mit jedem abgeschlossenen Trade." />;
  const data = st.equity;
  const up = st.balance >= st.start;
  const c = up ? '#46a6a0' : '#d46c6a';
  return (
    <div className="h-[268px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.32} />
              <stop offset="100%" stopColor={c} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="eqStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4c7ba8" />
              <stop offset="100%" stopColor={c} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1a2634" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="i" tick={axis} tickLine={false} axisLine={false} tickFormatter={(i) => (i === 0 ? 'Start' : '#' + i)} minTickGap={28} />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={62} tickFormatter={axNum} domain={['auto', 'auto']} />
          <ReferenceLine y={st.start} stroke="#3a4b60" strokeDasharray="3 4" />
          <Tooltip cursor={{ stroke: '#3a4b60', strokeWidth: 1 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as Stats['equity'][number];
            return (
              <div className={tipBox}>
                <div className="mb-1 font-semibold text-mute">{p.t ? `Trade #${p.i} · ${fmt.date(tDate(p.t))}` : 'Start'}</div>
                {p.t && <Row l="P&L" v={fmt.signed(p.t.pnl) + ' ' + cur} cls={(p.t.pnl || 0) >= 0 ? 'text-win' : 'text-loss'} />}
                <Row l="Kontostand" v={fmt.n0(p.v) + ' ' + cur} />
              </div>
            );
          }} />
          <Area type="linear" dataKey="v" stroke="url(#eqStroke)" strokeWidth={2} fill="url(#eqFill)" animationDuration={1100} animationEasing="ease-out"
            dot={false} activeDot={{ r: 5, fill: c, stroke: '#0d151f', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function roundedBar(props: any) {
  const { x, y, width, height, fill } = props;
  if (!height || Math.abs(height) < 0.5) return <g />;
  const r = Math.min(4, Math.abs(height), width / 2);
  const top = height >= 0 ? y : y + height, h = Math.abs(height);
  const neg = props.payload?.net < 0;
  const d = neg
    ? `M${x},${top}H${x + width}V${top + h - r}Q${x + width},${top + h} ${x + width - r},${top + h}H${x + r}Q${x},${top + h} ${x},${top + h - r}Z`
    : `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${top + h}Z`;
  return <path d={d} fill={fill} />;
}

export function MonthlyChart({ st, cur }: { st: Stats; cur: string }) {
  if (!st.months.length) return <Empty title="Noch keine Monate" text="Hier erscheint dein Netto-Ergebnis pro Monat, grün im Plus, rot im Minus." />;
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer>
        <BarChart data={st.months} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1a2634" vertical={false} />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={56} tickFormatter={axNum} />
          <ReferenceLine y={0} stroke="#2b3b4f" />
          <Tooltip cursor={{ fill: 'rgb(111 157 201 / 0.06)' }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const m = payload[0].payload as Stats['months'][number];
            return (
              <div className={tipBox}>
                <div className="mb-1 font-semibold text-mute">{m.label}</div>
                <Row l="Netto" v={fmt.signed(m.net) + ' ' + cur} cls={m.net >= 0 ? 'text-win' : 'text-loss'} />
                <Row l="Trades" v={String(m.n)} />
                <Row l="Win-Rate" v={fmt.pct0(m.winRate)} />
              </div>
            );
          }} />
          <Bar dataKey="net" shape={roundedBar} maxBarSize={36} animationDuration={900}>
            {st.months.map((m) => <Cell key={m.key} fill={m.net >= 0 ? '#55b68a' : '#d46c6a'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
