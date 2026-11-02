import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button, Card } from '../../components/ui';
import { cn, usd } from '../../lib/utils';
import { headers, type SellerProduct } from './api';

export interface PersonaInfo { key: string; label: string; emoji: string; blurb: string; progress: number[]; sample: string; opening: string; ladder?: number[] }

// A tiny chart of how much of the discount range the assistant gives up each round (0 = list price, 100 = your lowest price).
function Pace({ progress }: { progress: number[] }) {
  const w = 120, h = 36, pts = progress.map((p, i) => `${(i / (progress.length - 1)) * (w - 8) + 4},${h - 4 - p * (h - 8)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-[120px]" role="img" aria-label={`Share of the discount range given up each round: ${progress.map((p) => Math.round(p * 100) + '%').join(', ')}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Choose how the assistant talks and how quickly it comes down. Your lowest acceptable price is enforced in code either way.
export default function PersonaPicker({ products, sellerKey, onChanged }: { products: SellerProduct[]; sellerKey: string; onChanged: () => void }) {
  const [pid, setPid] = useState(products[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const product = products.find((p) => p.id === pid) ?? products[0];
  const { data } = useQuery({
    queryKey: ['personas', sellerKey, product?.id, product?.listCents, product?.floorCents],
    queryFn: () => api<{ default: string; rangePct?: number; personas: PersonaInfo[] }>(`/api/seller/personas?productId=${encodeURIComponent(product!.id)}`, { headers: headers(sellerKey) }),
    enabled: !!product, staleTime: 60_000,
  });
  if (!data || !product) return null;
  const current = product.persona ?? data.default;

  async function choose(key: string, all = false) {
    setBusy(true);
    try {
      for (const p of all ? products : [product]) await api(`/api/seller/products/${p.id}`, { method: 'PUT', headers: headers(sellerKey), body: { persona: key } });
      toast.success(all ? 'Personality applied to every product' : `Personality set for ${product.name}`);
      onChanged();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Card id="personas" className="mb-5">
      <h2 className="mb-1 text-xl font-semibold tracking-tight">Haggler personality</h2>
      <p className="mb-3 max-w-[70ch] text-sm text-mute">Pick how your assistant talks and how quickly it lowers the price. The AI only words the reply: your lowest acceptable price is enforced in code for every personality. A chat keeps the personality it started with.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="personaProduct" className="text-sm font-semibold">Product</label>
        <select id="personaProduct" value={pid} onChange={(e) => setPid(e.target.value)} className="min-h-11 rounded-xl border border-line bg-card px-3 py-2">
          {products.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
        </select>
        <Button variant="ghost" disabled={busy} onClick={() => void choose(current, true)}>Use this personality for all products</Button>
      </div>
      {data.rangePct !== undefined && data.rangePct < 12 && (
        <p id="personaNarrow" className="mb-3 rounded-lg bg-warn-soft p-2.5 text-[13px] text-warn">This product only allows about {data.rangePct}% off, so personalities change the tone far more than the price. Try the tote to see the pace clearly.</p>
      )}
      <div role="radiogroup" aria-label={`Personality for ${product.name}`} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-3">
        {data.personas.map((p) => {
          const on = p.key === current;
          return (
            <button key={p.key} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => void choose(p.key)}
              className={cn('flex min-h-[44px] flex-col gap-1.5 rounded-xl border-2 p-3 text-left transition', on ? 'border-brand bg-brand-soft' : 'border-line bg-card hover:border-brand')}>
              <span className="flex items-center justify-between gap-2"><span className="text-base font-bold"><span aria-hidden>{p.emoji}</span> {p.label}</span>{on && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-brand-ink">Selected</span>}</span>
              <span className="text-[13px] text-mute">{p.blurb}</span>
              <span className="flex items-center gap-2 text-brand"><span className="text-xs font-semibold text-mute">Pace</span><Pace progress={p.progress} /></span>
              {p.ladder && <span className="text-[12px] text-mute"><span className="font-semibold">Asks by round: </span><span className="num">{p.ladder.map((c) => usd(c)).join(' → ')}</span></span>}
              <span className="text-[13px] italic"><span className="not-italic text-xs font-semibold text-mute">Sample reply: </span>&ldquo;{p.sample}&rdquo;</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
