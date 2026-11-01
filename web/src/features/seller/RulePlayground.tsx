import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AgCharts } from 'ag-charts-react';
import type { AgChartOptions } from 'ag-charts-community';
import { FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button, Card } from '../../components/ui';
import { useChartTheme } from '../../lib/ag';
import { usd } from '../../lib/utils';
import { headers, type SellerProduct } from './api';

interface Sim { floorCents: number; listCents: number; ladder: { round: number; askCents: number }[]; discountAtFloorPct: number; marginAtFloorPct: number }
interface Params { listPrice: number; costPrice: number; minMarginPct: number; maxDiscountPct: number; stock: number; qty: number }

const fromProduct = (p: SellerProduct): Params => ({ listPrice: p.listCents / 100, costPrice: p.costCents / 100, minMarginPct: p.minMarginPct, maxDiscountPct: p.maxDiscountPct, stock: p.stock, qty: 1 });
function useDebounced<T>(v: T, ms = 180) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

function Slider({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void }) {
  const id = `sl-${label.replace(/\W+/g, '')}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="flex justify-between text-sm font-semibold"><span>{label}</span><span className="num text-brand">{suffix === '$' ? `$${value}` : `${value}${suffix}`}</span></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-brand" />
    </div>
  );
}

// Move the sliders and see the floor and the seller's concession round by round. Nothing is saved until "Apply".
export default function RulePlayground({ products, sellerKey, onApplied }: { products: SellerProduct[]; sellerKey: string; onApplied: () => void }) {
  const theme = useChartTheme();
  const [pid, setPid] = useState(products[0]?.id ?? '');
  const product = products.find((p) => p.id === pid) ?? products[0];
  const [params, setParams] = useState<Params>(() => (product ? fromProduct(product) : { listPrice: 48, costPrice: 18, minMarginPct: 25, maxDiscountPct: 25, stock: 8, qty: 1 }));
  useEffect(() => { if (product) setParams(fromProduct(product)); }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps
  const dp = useDebounced(params);
  const { data: sim } = useQuery({
    queryKey: ['simulate', pid, dp],
    queryFn: () => api<Sim>('/api/seller/simulate', { method: 'POST', headers: headers(sellerKey), body: { productId: pid, ...dp } }),
    placeholderData: keepPreviousData, retry: false,
  });
  if (!product) return null;
  const set = (k: keyof Params) => (n: number) => setParams((p) => ({ ...p, [k]: n, ...(k === 'listPrice' && p.costPrice > n ? { costPrice: n } : {}) }));

  async function apply() {
    try {
      await api(`/api/seller/products/${pid}`, { method: 'PUT', headers: headers(sellerKey), body: { listPrice: params.listPrice, costPrice: params.costPrice, minMarginPct: params.minMarginPct, maxDiscountPct: params.maxDiscountPct, stock: params.stock } });
      toast.success(`Rules applied to ${product.name}`);
      onApplied();
    } catch (e) { toast.error((e as Error).message); }
  }

  const chart = sim && ({
    background: { visible: false }, theme, height: 260, legend: { position: 'bottom' },
    data: [{ round: 'List', ask: sim.listCents / 100, floor: sim.floorCents / 100 }, ...sim.ladder.map((l) => ({ round: `R${l.round}`, ask: l.askCents / 100, floor: sim.floorCents / 100 }))],
    series: [
      { type: 'line', xKey: 'round', yKey: 'ask', yName: "Seller's counter each round", stroke: '#2563eb', strokeWidth: 3, marker: { fill: '#2563eb', size: 8 } },
      { type: 'line', xKey: 'round', yKey: 'floor', yName: 'Your floor (never crossed)', stroke: '#c2410c', strokeWidth: 2, lineDash: [6, 4], marker: { enabled: false } },
    ],
    axes: { x: { type: 'category', position: 'bottom' }, y: { type: 'number', position: 'left', label: { formatter: (p: { value: number }) => `$${p.value}` } } },
  } as AgChartOptions);

  return (
    <Card id="playground">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <strong className="inline-flex items-center gap-2"><FlaskConical size={18} aria-hidden /> Rule playground</strong>
        <label className="flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold">Product
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="min-h-11 min-w-0 max-w-full rounded-xl border border-line bg-card px-3 py-2">
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Slider label="List price" value={params.listPrice} min={1} max={Math.max(500, Math.ceil(params.listPrice))} suffix="$" onChange={set('listPrice')} />
          <Slider label="Your cost" value={params.costPrice} min={0} max={params.listPrice} suffix="$" onChange={set('costPrice')} />
          <Slider label="Minimum margin" value={params.minMarginPct} min={0} max={100} suffix="%" onChange={set('minMarginPct')} />
          <Slider label="Maximum discount" value={params.maxDiscountPct} min={0} max={90} suffix="%" onChange={set('maxDiscountPct')} />
          <Slider label="Stock" value={params.stock} min={0} max={50} onChange={set('stock')} />
          <Slider label="Buyer quantity" value={params.qty} min={1} max={10} onChange={set('qty')} />
          <Button onClick={() => void apply()}>Apply these rules</Button>
        </div>
        <div className="min-w-0">
          {sim && (
            <div className="mb-2 grid grid-cols-3 gap-2 text-center" aria-live="polite">
              <div className="rounded-xl bg-chip p-2"><div data-testid="sim-floor" className="num text-xl font-extrabold">{usd(sim.floorCents)}</div><div className="text-xs text-mute">your floor</div></div>
              <div className="rounded-xl bg-chip p-2"><div className="num text-xl font-extrabold">{sim.discountAtFloorPct}%</div><div className="text-xs text-mute">max discount reached</div></div>
              <div className="rounded-xl bg-chip p-2"><div className="num text-xl font-extrabold">{sim.marginAtFloorPct}%</div><div className="text-xs text-mute">margin at the floor</div></div>
            </div>
          )}
          <div className="min-w-0 overflow-hidden">{chart ? <AgCharts options={chart} /> : null}</div>
          <p className="mt-1 text-[13px] text-mute">The AI can word each counter but can never go below the dashed line: the floor is computed by plain code from these rules.</p>
        </div>
      </div>
    </Card>
  );
}
