import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AgCharts } from 'ag-charts-react';
import type { AgChartOptions } from 'ag-charts-community';
import { Bot, TriangleAlert, User } from 'lucide-react';
import { api } from '../../api/client';
import type { Guard, Product } from '../../api/types';
import Chips from '../../components/Chips';
import { Button, Card, Notice } from '../../components/ui';
import { useHealth } from '../../hooks/useHealth';
import { useChartTheme } from '../../lib/ag';
import { celebrate, providerLabel, usd } from '../../lib/utils';
import DealCard, { type DealView } from '../shop/DealCard';

interface PaneMsg { id: number; text: string; guard?: Guard; action?: string; note?: string; who?: string }
interface Point { x: number; y: number }
type Persona = 'fair' | 'tough' | 'manipulator';
type BattleEvent =
  | { type: 'start'; opening: string }
  | { type: 'buyer'; text: string; provider: string }
  | { type: 'seller'; text: string; action: string; priceCents: number; guard: Guard }
  | { type: 'end'; deal: { id: string; unitCents: number; totalCents: number; expiresAt: string; qty: number } | null; budgetCents: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// the buyer's offer as a number, from its message (last "$" amount; none for a manipulation attempt)
function offerFrom(text: string, listCents: number): number | null {
  const m = [...text.matchAll(/\$\s?(\d+(?:[.,]\d{1,2})?)/g)].pop();
  if (!m) return null;
  const c = Math.round(Number(m[1].replace(',', '.')) * 100);
  return c > 0 && c <= listCents * 1.2 ? c : null;
}

function PriceChart({ buyer, seller }: { buyer: Point[]; seller: Point[] }) {
  const theme = useChartTheme();
  const rounds = Math.max(1, ...buyer.map((p) => p.x), ...seller.map((p) => p.x));
  const data = Array.from({ length: rounds + 1 }, (_, x) => ({
    round: x === 0 ? 'Start' : `R${x}`,
    buyer: buyer.find((p) => p.x === x)?.y,
    seller: seller.filter((p) => p.x === x).pop()?.y,
  })).map((d) => ({ ...d, buyer: d.buyer != null ? d.buyer / 100 : null, seller: d.seller != null ? d.seller / 100 : null }));
  const options = {
    data, theme, height: 280, background: { visible: false }, legend: { enabled: false },
    series: [
      { type: 'line', xKey: 'round', yKey: 'buyer', yName: "Buyer's offer", stroke: '#2563eb', strokeWidth: 3, connectMissingData: true, marker: { fill: '#2563eb', size: 8 } },
      { type: 'line', xKey: 'round', yKey: 'seller', yName: "Seller's ask", stroke: '#15803d', strokeWidth: 3, marker: { fill: '#15803d', size: 8 } },
    ],
    axes: { x: { type: 'category', position: 'bottom' }, y: { type: 'number', position: 'left', label: { formatter: (p: { value: number }) => `$${p.value}` } } },
  } as AgChartOptions;
  return (
    <Card id="chartCard" className="mt-4">
      <strong>Price over time</strong>
      <div id="chart" className="min-w-0 overflow-hidden"><AgCharts options={options} /></div>
      <div className="mt-1.5 flex flex-wrap gap-3.5 text-[13px] text-mute">
        <span><i className="mr-1.5 inline-block size-3 rounded-[3px] bg-brand align-[-1px]" />Buyer's offer</span>
        <span><i className="mr-1.5 inline-block size-3 rounded-[3px] bg-ok align-[-1px]" />Seller's ask</span>
      </div>
    </Card>
  );
}

function Pane({ id, role, title, icon, msgs }: { id: string; role: 'buyer' | 'seller'; title: string; icon: React.ReactNode; msgs: PaneMsg[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs]);
  return (
    <Card className="pane flex min-h-[340px] flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <div className={`avatar grid size-11 shrink-0 place-items-center rounded-full ${role === 'buyer' ? 'bg-brand-soft text-brand' : 'bg-ok-soft text-ok'}`}>{icon}</div>
        <div><div className="text-xs font-bold uppercase tracking-wider text-mute">{role}</div><h3 className="m-0 text-base font-semibold">{title}</h3></div>
      </div>
      <div id={id} ref={box} tabIndex={0} role="log" aria-label={`${title} messages`} className="msgs flex min-h-60 flex-1 flex-col gap-2.5 overflow-auto">
        {msgs.map((m) => (
          <div key={m.id} className={`msg max-w-[88%] whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2.5 ${role === 'buyer' ? 'buyer self-end rounded-br-[5px] bg-brand text-brand-ink' : 'seller self-start rounded-bl-[5px] bg-bubble'}`}>
            {m.text}
            {m.guard && <><Chips guard={m.guard} action={m.action} />{m.note && <small className="mt-1 block text-xs opacity-80">{m.note}</small>}</>}
            {m.who && <small className="who mt-1 block text-xs opacity-90">{m.who}</small>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Battle() {
  const qc = useQueryClient();
  const { data: health } = useHealth();
  const { data: pd } = useQuery({ queryKey: ['products'], queryFn: () => api<{ products: Product[] }>('/api/products') });
  const products = pd?.products ?? [];
  const [productId, setProductId] = useState('');
  const [persona, setPersona] = useState<Persona>('fair');
  const [budget, setBudget] = useState('85');
  const [running, setRunning] = useState(false);
  const [buyerMsgs, setBuyerMsgs] = useState<PaneMsg[]>([]);
  const [sellerMsgs, setSellerMsgs] = useState<PaneMsg[]>([]);
  const [buyerPts, setBuyerPts] = useState<Point[]>([]);
  const [sellerPts, setSellerPts] = useState<Point[]>([]);
  const [injected, setInjected] = useState(false);
  const [result, setResult] = useState<React.ReactNode>(null);
  const [showChart, setShowChart] = useState(false);
  const pid = productId || products[0]?.id || '';
  const configured = health?.ai ?? null;

  async function start(ev: React.FormEvent) {
    ev.preventDefault();
    const product = products.find((p) => p.id === pid);
    if (!product) return;
    setRunning(true); setResult(null); setBuyerMsgs([]); setSellerMsgs([]); setBuyerPts([]); setSellerPts([]); setInjected(false); setShowChart(false);
    let id = 0; let turn = 0; let lastOffer: number | null = null;
    try {
      const res = await fetch('/api/battle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: pid, persona, budgetPct: Number(budget) }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'Could not start');
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as BattleEvent;
          if (e.type === 'start') {
            setSellerMsgs([{ id: id++, text: e.opening }]); setSellerPts([{ x: 0, y: product.listCents }]); setShowChart(true);
          } else if (e.type === 'buyer') {
            turn++;
            const who = e.provider === 'script' ? 'scripted attacker (no AI, repeatable demo)' : providerLabel({ provider: e.provider, fellBack: e.provider !== configured } as Guard, configured);
            setBuyerMsgs((m) => [...m, { id: id++, text: e.text, who }]);
            lastOffer = offerFrom(e.text, product.listCents);
            await sleep(500);
          } else if (e.type === 'seller') {
            const t = turn; const offer = lastOffer;
            setSellerMsgs((m) => [...m, { id: id++, text: e.text, guard: e.guard, action: e.action, note: `Decision: ${e.action}, price ${usd(e.priceCents)}`, who: providerLabel(e.guard, configured) }]);
            if (e.guard.injection) setInjected(true); else if (offer != null) setBuyerPts((p) => [...p, { x: t, y: offer }]);
            setSellerPts((p) => [...p, { x: t, y: e.priceCents }]);
            void qc.invalidateQueries({ queryKey: ['health'] });
            await sleep(700);
          } else if (e.type === 'end') {
            if (e.deal) {
              celebrate();
              const dv: DealView = { id: e.deal.id, unitCents: e.deal.unitCents, totalCents: e.deal.totalCents, listTotalCents: product.listCents, qty: 1, expiresAt: e.deal.expiresAt, payMode: product.payMode };
              setResult(<><p className="mb-1 text-sm text-mute">The buyer's secret budget was {usd(e.budgetCents)}.</p><DealCard deal={dv} /></>);
            } else {
              setResult(<Notice kind="info">No deal. The buyer's budget ({usd(e.budgetCents)}) did not meet the seller's limits, or the buyer gave up. Nothing was sold below the seller's rules.</Notice>);
            }
          }
        }
      }
    } catch (e) { setResult(<Notice kind="bad">{(e as Error).message}</Notice>); }
    setRunning(false);
  }

  const sel = 'min-h-11 w-full min-w-0 rounded-xl border border-line bg-card px-3 py-2.5 text-ink';
  return (
    <>
      <h1 className="mb-2 mt-2 text-[clamp(26px,5vw,38px)] font-extrabold leading-[1.15] tracking-tight">Agent vs agent</h1>
      <p className="mb-5 max-w-[62ch] text-mute">A buyer's AI agent with a secret budget negotiates with the shop's AI agent. Watch the seller's guardrails hold. Pick the "manipulator" to see it try to trick the seller and fail.</p>

      <Card className="mb-4">
        <form id="cfg" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] items-end gap-3" onSubmit={(e) => void start(e)}>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Product
            <select id="product" className={sel} value={pid} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({usd(p.listCents)})</option>)}
            </select></label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Buyer agent
            <select id="persona" className={sel} value={persona} onChange={(e) => setPersona(e.target.value as Persona)}>
              <option value="fair">Fair buyer</option><option value="tough">Tough lowballer</option><option value="manipulator">Manipulator (tries to hack the seller)</option>
            </select></label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Buyer's secret budget
            <select id="budget" className={sel} value={budget} onChange={(e) => setBudget(e.target.value)}>
              <option value="95">95% of list</option><option value="85">85% of list</option><option value="75">75% of list</option><option value="55">55% of list (too low)</option>
            </select></label>
          <Button id="go" disabled={running || !products.length}>{running ? 'Negotiating...' : 'Start negotiation'}</Button>
        </form>
      </Card>

      <div id="banner" role="alert">
        {injected && <div className="banner mb-3.5 flex items-center gap-2.5 rounded-xl border border-bad bg-bad-soft px-3.5 py-2.5 font-bold text-bad"><TriangleAlert size={22} className="shrink-0" aria-hidden />Manipulation attempt blocked. The seller ignored the instruction and kept its limits.</div>}
      </div>

      <div className="arena grid grid-cols-1 gap-4 md:grid-cols-2">
        <Pane id="buyerPane" role="buyer" title="Buyer's agent" icon={<User size={26} aria-hidden />} msgs={buyerMsgs} />
        <Pane id="sellerPane" role="seller" title="Seller's agent" icon={<Bot size={26} aria-hidden />} msgs={sellerMsgs} />
      </div>
      {showChart && <PriceChart buyer={buyerPts} seller={sellerPts} />}
      <div id="result" className="mt-4">{result}</div>
    </>
  );
}
