import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button, Card } from '../../components/ui';
import { usd } from '../../lib/utils';
import { headers, type SellerProduct } from './api';

type Fields = { listPrice: string; costPrice: string; minMarginPct: string; maxDiscountPct: string; stock: string };

function Row({ p, sellerKey, onSaved }: { p: SellerProduct; sellerKey: string; onSaved: () => void }) {
  const [f, setF] = useState<Fields>({
    listPrice: String(p.listCents / 100), costPrice: String(p.costCents / 100), minMarginPct: String(p.minMarginPct),
    maxDiscountPct: String(p.maxDiscountPct), stock: String(p.stock),
  });
  const input = (k: keyof Fields, w = 'w-20') => (
    <input type="number" step="any" value={f[k]} aria-label={`${p.name} ${k}`} onChange={(e) => setF({ ...f, [k]: e.target.value })}
      className={`${w} min-h-11 rounded-xl border border-line bg-card px-2.5 py-2 text-ink`} />
  );
  async function save() {
    try {
      await api(`/api/seller/products/${p.id}`, { method: 'PUT', headers: headers(sellerKey), body: f });
      toast.success(`Saved rules for ${p.name}`);
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <tr className="border-b border-line">
      <td className="p-2.5 align-top">{p.name}</td>
      <td className="p-2.5">{input('listPrice')}</td>
      <td className="p-2.5">{input('costPrice')}</td>
      <td className="p-2.5">{input('minMarginPct')}</td>
      <td className="p-2.5">{input('maxDiscountPct')}</td>
      <td className="p-2.5">{input('stock', 'w-16')}</td>
      <td className="num p-2.5 align-top">{usd(p.floorCents)}</td>
      <td className="p-2.5"><Button variant="ghost" onClick={() => void save()}>Save</Button></td>
    </tr>
  );
}

export default function RulesTable({ products, sellerKey, onSaved }: { products: SellerProduct[]; sellerKey: string; onSaved: () => void }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table id="products" className="w-full border-collapse text-sm">
          <thead>
            <tr>{['Product', 'List $', 'Cost $', 'Min margin %', 'Max discount %', 'Stock', 'Floor', ''].map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-line p-2.5 text-left text-xs font-bold uppercase tracking-wider text-mute">{h}</th>))}</tr>
          </thead>
          <tbody>{products.map((p) => <Row key={`${p.id}-${p.floorCents}-${p.listCents}`} p={p} sellerKey={sellerKey} onSaved={onSaved} />)}</tbody>
        </table>
      </div>
      <p className="mt-2 text-[13px] text-mute">Floor = the highest of: cost plus minimum margin, or list price minus max discount. Low stock tightens it further.</p>
    </Card>
  );
}
