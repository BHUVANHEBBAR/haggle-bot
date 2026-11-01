import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, BarChart3, CircleCheck, CircleDollarSign, Clock, Percent, ShieldCheck, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { Button, Card } from '../../components/ui';
import { usd } from '../../lib/utils';
import { describeEvent, getKey, setKey, useDashboard, type Stats } from './api';
import AnalyticsCards from './Analytics';
import Charts from './Charts';
import Copilot from './Copilot';
import Reconcile from './Reconcile';
import DealsGrid from './DealsGrid';
import EmbedSnippet from './EmbedSnippet';
import LiveFeed from './LiveFeed';
import RulePlayground from './RulePlayground';
import RulesTable from './RulesTable';
import SafetyCheck from './SafetyCheck';

function Tile({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="tile flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-card p-3.5 shadow-card">
      <div className="ico grid size-[38px] shrink-0 place-items-center rounded-[10px] bg-brand-soft text-brand"><Icon size={20} aria-hidden /></div>
      <div><div className="v num text-[26px] font-extrabold leading-[1.15] tracking-tight">{value}</div><div className="text-[13px] text-mute">{label}</div></div>
    </div>
  );
}

function Tiles({ s }: { s: Stats }) {
  return (
    <div id="tiles" className="tiles mb-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-3">
      <Tile icon={CircleCheck} value={String(s.dealsPaid)} label="Deals paid" />
      <Tile icon={CircleDollarSign} value={usd(s.revenueCents)} label="Revenue" />
      <Tile icon={Percent} value={`${s.avgDiscountPct}%`} label="Average discount given" />
      <Tile icon={BarChart3} value={`${s.marginPct}%`} label="Margin kept" />
      <Tile icon={ShieldCheck} value={String(s.belowFloorRefused)} label="Below-limit offers refused" />
      <Tile icon={SlidersHorizontal} value={String(s.priceClamped)} label="AI prices corrected" />
      <Tile icon={Ban} value={String(s.injectionsBlocked)} label="Manipulation attempts blocked" />
      <Tile icon={Clock} value={`${s.estMinutesSaved} min`} label="Est. chat time saved (0.75 min per message)" />
    </div>
  );
}

function Login({ onOpen, error }: { onOpen: (k: string) => void; error: string }) {
  const [v, setV] = useState('');
  return (
    <Card id="login" className="max-w-[420px]">
      <form id="loginForm" className="flex flex-wrap items-center gap-2.5" onSubmit={(e) => { e.preventDefault(); onOpen(v); }}>
        <label className="sr" htmlFor="key">Seller key</label>
        <input id="key" type="password" required value={v} onChange={(e) => setV(e.target.value)} autoComplete="current-password"
          placeholder="Seller key (SELLER_KEY in .env)" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2.5" />
        <Button>Open</Button>
      </form>
      <div id="loginErr" className="mt-2 text-[13px] text-bad">{error}</div>
    </Card>
  );
}

export default function Seller() {
  const qc = useQueryClient();
  const [key, setKeyState] = useState(getKey);
  const { data, error, isError } = useDashboard(key);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  const open = (k: string) => { setKeyState(k); };
  const authed = !!data;
  // remember the key only once it has worked
  if (authed && getKey() !== key) setKey(key);
  const loginError = isError ? ((error as { status?: number }).status === 401 ? 'Wrong key.' : (error as Error).message) : '';

  return (
    <>
      <h1 className="mb-2 mt-2 text-[clamp(26px,5vw,38px)] font-extrabold leading-[1.15] tracking-tight">Seller dashboard</h1>
      {!authed ? <Login onOpen={open} error={loginError} /> : (
        <div id="dash">
          <p className="mb-5 max-w-[62ch] text-mute">Your rules are enforced in code. The AI never sees your floor price and cannot go below it.</p>
          <Tiles s={data.stats} />
          <LiveFeed sellerKey={key} />
          <Reconcile sellerKey={key} />
          <Copilot sellerKey={key} onChanged={refresh} />
          <SafetyCheck sellerKey={key} />
          <Charts deals={data.deals} />
          <AnalyticsCards sellerKey={key} />
          <h2 className="mb-2.5 mt-7 text-xl font-semibold tracking-tight">Deals</h2>
          <Card><DealsGrid deals={data.deals} sellerKey={key} onChanged={refresh} /></Card>
          <h2 className="mb-2.5 mt-7 text-xl font-semibold tracking-tight">Rule playground</h2>
          <RulePlayground products={data.products} sellerKey={key} onApplied={refresh} />
          <h2 className="mb-2.5 mt-7 text-xl font-semibold tracking-tight">Sell on your own site</h2>
          <EmbedSnippet products={data.products} />
          <h2 className="mb-2.5 mt-7 text-xl font-semibold tracking-tight">Your rules (private)</h2>
          <RulesTable products={data.products} sellerKey={key} onSaved={refresh} />
          <h2 className="mb-2.5 mt-7 text-xl font-semibold tracking-tight">Guardrail and payment log</h2>
          <Card>
            <ul id="events" tabIndex={0} aria-label="Guardrail and payment log" className="m-0 max-h-[340px] list-none overflow-auto p-0">
              {data.events.map((e) => (
                <li key={e.id} className="break-words border-b border-line py-2 text-sm">{new Date(e.ts).toLocaleTimeString()}&nbsp;&nbsp;{describeEvent(e)}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
