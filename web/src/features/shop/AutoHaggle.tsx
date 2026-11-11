import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Bot, ShieldCheck, User } from 'lucide-react';
import { api } from '../../api/client';
import type { Product } from '../../api/types';
import { Button, Card, Notice } from '../../components/ui';
import { celebrate, usd } from '../../lib/utils';
import DealCard, { type DealView } from './DealCard';

interface Line { role: 'agent' | 'seller'; text: string; action?: string; priceCents?: number }
interface Result { status: string; maxCents: number; transcript: Line[]; deal: DealView | null }

// The buyer sets a hard maximum; their AI agent haggles with the shop's AI. The shop's limits and the buyer's maximum are both enforced in code.
export default function AutoHaggle() {
  const [params] = useSearchParams();
  const { data } = useQuery({ queryKey: ['products'], queryFn: () => api<{ products: Product[] }>('/api/products') });
  const products = (data?.products ?? []).filter((p) => p.inStock);
  const [productId, setProductId] = useState(params.get('product') ?? '');
  const [max, setMax] = useState('');
  const [style, setStyle] = useState<'fair' | 'tough'>('fair');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const pid = productId || products[0]?.id || '';
  const product = products.find((p) => p.id === pid);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await api<Result>('/api/auto-haggle', { method: 'POST', body: { productId: pid, maxDollars: Number(max), style } });
      setRes(r); if (r.deal) celebrate();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }

  const sel = 'min-h-11 w-full min-w-0 rounded-xl border border-line bg-card px-3 py-2.5 text-ink';
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 mt-2 text-[clamp(26px,5vw,38px)] font-extrabold leading-[1.15] tracking-tight">Let my AI haggle for me</h1>
      <p className="mb-5 max-w-[62ch] text-mute">Tell your agent the most you would pay. It haggles with the shop and comes back with a price you can pay with PayPal, or tells you there was no deal. It never goes above your maximum, and the shop's own limits still hold.</p>

      <Card className="mb-4">
        <form id="autoCfg" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] items-end gap-3" onSubmit={(e) => void go(e)}>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Product
            <select id="autoProduct" className={sel} value={pid} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({usd(p.listCents)})</option>)}
            </select></label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Most I would pay (USD)
            <input id="autoMax" className={`${sel} num`} type="number" inputMode="decimal" min={1} max={product ? product.listCents / 100 : undefined} step="0.01" required value={max} onChange={(e) => setMax(e.target.value)} placeholder={product ? `up to ${(product.listCents / 100).toFixed(2)}` : ''} /></label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Agent style
            <select id="autoStyle" className={sel} value={style} onChange={(e) => setStyle(e.target.value as 'fair' | 'tough')}>
              <option value="fair">Fair: polite, wants a fair price</option><option value="tough">Tough: starts low, concedes slowly</option>
            </select></label>
          <Button id="autoGo" disabled={busy || !product}>{busy ? 'Haggling...' : 'Start haggling'}</Button>
        </form>
        <p className="mb-0 mt-3 flex items-start gap-2 text-xs text-mute"><ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden />Your maximum stays on your side: the agent is told never to reveal it, and the server throws away any deal above it.</p>
      </Card>

      <div role="status">{err && <Notice kind="bad">{err}</Notice>}</div>

      {res && (
        <>
          <Card className="mb-4" >
            <h2 className="mb-2 mt-0 text-base font-semibold">What your agent said</h2>
            <ol id="autoLog" aria-label="Negotiation" className="m-0 flex list-none flex-col gap-2 p-0">
              {res.transcript.map((t, i) => (
                <li key={i} className={`flex max-w-[92%] items-start gap-2 rounded-2xl px-3.5 py-2.5 ${t.role === 'agent' ? 'self-end bg-brand text-brand-ink' : 'self-start bg-bubble'}`}>
                  {t.role === 'agent' ? <User size={16} className="mt-1 shrink-0" aria-hidden /> : <Bot size={16} className="mt-1 shrink-0" aria-hidden />}
                  <span><span className="sr">{t.role === 'agent' ? 'Your agent: ' : 'The shop: '}</span>{t.text}</span>
                </li>
              ))}
            </ol>
          </Card>
          <div id="autoResult">
            {res.deal
              ? <><p className="mb-1 text-sm text-mute">Deal reached at {usd(res.deal.unitCents)}, within your {usd(res.maxCents)} maximum.</p>
                  <DealCard deal={res.deal} productName={product?.name} shipping={product?.shipping} /></>
              : <Notice kind="info">No deal. Your maximum ({usd(res.maxCents)}) did not meet the shop's limits, so nothing was sold. You can raise it, or buy at list price from the shop.</Notice>}
          </div>
        </>
      )}
    </div>
  );
}
