import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BarChart3, CircleCheck, CircleDollarSign, Clock, Eye, EyeOff, LogOut, Percent, ShieldCheck, SlidersHorizontal, Store, type LucideIcon } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, Card } from '../../components/ui';
import { cn, usd } from '../../lib/utils';
import { SESSION, describeEvent, useDashboard, type Stats } from './api';
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
    <div id="tiles" className="tiles mb-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
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

const TABS = [
  ['overview', 'Overview'], ['deals', 'Deals'], ['money', 'Money & PayPal'], ['pricing', 'Pricing rules'], ['insights', 'Insights'], ['settings', 'Settings'],
] as const;
type TabId = (typeof TABS)[number][0];

// Only the open tab is mounted (the grid and charts size themselves when they appear). The tab is kept in the URL: /seller?tab=money
function Tabs({ children }: { children: Record<TabId, React.ReactNode> }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const active: TabId = TABS.some(([id]) => id === asked) ? (asked as TabId) : 'overview';
  const go = (id: TabId) => setParams(id === 'overview' ? {} : { tab: id }, { replace: true });
  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex(([id]) => id === active);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[(next + TABS.length) % TABS.length][0];
    go(id);
    requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
  };
  return (
    <>
      <div role="tablist" aria-label="Seller sections" onKeyDown={onKey} className="mb-5 flex gap-1 overflow-x-auto border-b border-line pb-px">
        {TABS.map(([id, text]) => (
          <button key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={active === id} aria-controls="tabpanel" tabIndex={active === id ? 0 : -1} onClick={() => go(id)}
            className={cn('min-h-11 shrink-0 whitespace-nowrap rounded-t-xl px-4 font-semibold', active === id ? 'border-b-2 border-brand bg-brand-soft text-ink' : 'text-mute hover:bg-chip')}>{text}</button>
        ))}
      </div>
      <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${active}`} tabIndex={0}>{children[active]}</div>
    </>
  );
}

// Shown until the first deal exists: what to do next, in order.
function GettingStarted() {
  return (
    <Card className="mb-5">
      <h2 className="mb-2 text-lg font-bold">Getting started</h2>
      <ol className="m-0 grid list-decimal gap-1.5 pl-5 text-[15px]">
        <li>Open <b>Pricing rules</b> and check each product's cost and the lowest price you will accept.</li>
        <li>Open the shop in another tab (<b>View shop as a buyer</b>) and haggle with your assistant, or use Buy now.</li>
        <li>Pay on PayPal's sandbox page, then come back to <b>Money &amp; PayPal</b> and press <b>Reconcile with PayPal</b>.</li>
      </ol>
    </Card>
  );
}

function Login({ onOpen, error, busy, defaultKey }: { onOpen: (k: string) => void; error: string; busy: boolean; defaultKey: boolean }) {
  const [v, setV] = useState('');
  const [show, setShow] = useState(false);
  return (
    <Card id="login" className="mx-auto mt-6 max-w-[440px]">
      <div className="mb-1 flex items-center gap-2 text-lg font-bold"><Store size={20} aria-hidden className="text-brand" /> Seller sign-in</div>
      <p className="mb-4 text-sm text-mute">Manage your prices, see every deal and check PayPal. Buyers do not sign in here.</p>
      <form id="loginForm" onSubmit={(e) => { e.preventDefault(); onOpen(v); }}>
        <label className="mb-1 block text-[13px] font-bold" htmlFor="key">Seller key</label>
        <div className="flex gap-2">
          <input id="key" type={show ? 'text' : 'password'} required value={v} onChange={(e) => setV(e.target.value)} autoComplete="current-password"
            aria-describedby="loginErr" placeholder="Your seller key" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2.5" />
          <button type="button" aria-pressed={show} aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(!show)}
            className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-line bg-card text-mute">{show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}</button>
        </div>
        <div id="loginErr" role="alert" className="mt-2 min-h-5 text-[13px] text-bad">{error}</div>
        <Button className="mt-2 w-full" disabled={busy}>{busy ? 'Checking...' : 'Open'}</Button>
      </form>
      {defaultKey && <p className="mt-3 rounded-lg bg-warn-soft p-2.5 text-[13px] text-warn">Demo notice: this server still uses the default key <b>change-me</b>. Set <code>SELLER_KEY</code> before sharing it.</p>}
    </Card>
  );
}

export default function Seller() {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<'checking' | 'out' | 'in'>('checking');
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api<{ sellerKeyIsDefault?: boolean }>('/api/health'), staleTime: 60_000 });
  // an existing session cookie signs the seller straight in
  useEffect(() => { api('/api/seller/me').then(() => setPhase('in')).catch(() => setPhase('out')); }, []);

  const key = phase === 'in' ? SESSION : '';
  const { data, error } = useDashboard(key);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  useEffect(() => {
    if (phase === 'in' && (error as { status?: number } | null)?.status === 401) { setPhase('out'); setLoginError('Your session ended. Please sign in again.'); }
  }, [error, phase]);

  async function open(k: string) {
    setBusy(true); setLoginError('');
    try { await api('/api/seller/login', { method: 'POST', body: { key: k } }); setPhase('in'); }
    catch (e) { setLoginError((e as Error).message === 'Wrong seller key' ? 'Wrong key.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() {
    await api('/api/seller/logout', { method: 'POST' }).catch(() => undefined);
    qc.removeQueries(); setPhase('out'); setLoginError('');
  }
  const authed = phase === 'in' && !!data;

  return (
    <>
      <div className="mb-2 mt-2 flex items-center justify-between gap-3">
        <h1 className="text-[clamp(24px,5vw,34px)] font-extrabold leading-[1.15] tracking-tight">Seller dashboard</h1>
        {authed && <Button variant="ghost" className="shrink-0" onClick={() => void logout()}><LogOut size={16} aria-hidden /> Sign out</Button>}
      </div>
      {phase === 'checking' ? <div role="status" className="text-mute">Checking your session...</div>
        : !authed && phase === 'out' ? <Login onOpen={(k) => void open(k)} error={loginError} busy={busy} defaultKey={!!health?.sellerKeyIsDefault} />
        : !authed ? <div role="status" className="text-mute">Loading your dashboard...</div> : (
        <div id="dash">
          <p className="mb-4 max-w-[62ch] text-mute">Your rules are enforced in code. The AI never sees your floor price and cannot go below it.</p>
          <Tabs>
            {{
              overview: <>
                {data.stats.dealsAgreed + data.stats.dealsPaid === 0 && <GettingStarted />}
                <Tiles s={data.stats} />
                <LiveFeed sellerKey={key} />
                <Charts deals={data.deals} />
              </>,
              deals: <>
                <h2 className="mb-2.5 text-xl font-semibold tracking-tight">Deals</h2>
                <Card><DealsGrid deals={data.deals} sellerKey={key} onChanged={refresh} /></Card>
              </>,
              money: <>
                <Reconcile sellerKey={key} />
                <Copilot sellerKey={key} onChanged={refresh} />
              </>,
              pricing: <>
                <h2 className="mb-2.5 text-xl font-semibold tracking-tight">Your rules (private)</h2>
                <RulesTable products={data.products} sellerKey={key} onSaved={refresh} />
                <h2 className="mb-2.5 mt-7 text-xl font-semibold tracking-tight">Rule playground</h2>
                <RulePlayground products={data.products} sellerKey={key} onApplied={refresh} />
                <SafetyCheck sellerKey={key} />
              </>,
              insights: <AnalyticsCards sellerKey={key} />,
              settings: <>
                <h2 className="mb-2.5 text-xl font-semibold tracking-tight">Sell on your own site</h2>
                <EmbedSnippet products={data.products} />
                <h2 className="mb-2.5 mt-7 text-xl font-semibold tracking-tight">Guardrail and payment log</h2>
                <Card>
                  <ul id="events" tabIndex={0} aria-label="Guardrail and payment log" className="m-0 max-h-[340px] list-none overflow-auto p-0">
                    {data.events.map((e) => (
                      <li key={e.id} className="break-words border-b border-line py-2 text-sm">{new Date(e.ts).toLocaleTimeString()}&nbsp;&nbsp;{describeEvent(e)}</li>
                    ))}
                  </ul>
                </Card>
              </>,
            }}
          </Tabs>
        </div>
      )}
    </>
  );
}
