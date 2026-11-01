import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Link2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button } from '../../components/ui';
import { cn, fmtLeft, usd } from '../../lib/utils';

export interface DealView { id: string; unitCents: number; totalCents: number; listTotalCents: number; qty: number; expiresAt: string; payMode: 'full' | 'authorize' }

// Order summary, price-hold countdown and the checkout button. When the hold runs out it offers a way forward instead of a dead end.
export default function DealCard({ deal, productName, newTab, shipping, onRenegotiate, onBuyAtList }: {
  deal: DealView; productName?: string; newTab?: boolean; shipping?: string; onRenegotiate?: () => void; onBuyAtList?: () => void;
}) {
  const [total] = useState(() => Math.max(1000, Date.parse(deal.expiresAt) - Date.now())); // the hold we started watching = 100%
  const [left, setLeft] = useState(() => Date.parse(deal.expiresAt) - Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setLeft(Date.parse(deal.expiresAt) - Date.now()), 1000);
    return () => clearInterval(t);
  }, [deal.expiresAt]);
  const saved = deal.listTotalCents - deal.totalCents;
  const expired = left <= 0;
  const pct = Math.min(100, Math.max(0, (left / total) * 100));

  async function checkout() {
    setBusy(true);
    // inside an embedded iframe PayPal cannot be framed, so open it in a new tab (opened now so popup blockers allow it)
    const popup = newTab ? window.open('', '_blank') : null;
    try {
      const r = await api<{ approveUrl: string }>('/api/checkout', { method: 'POST', body: { dealId: deal.id } });
      if (popup) { popup.location.href = r.approveUrl; setBusy(false); } else window.location.href = r.approveUrl;
    } catch (e) {
      popup?.close();
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}/app/order/${deal.id}`);
    toast.success('Link copied. Your price stays saved until the timer ends.');
  };

  return (
    <div className="deal mt-2.5 rounded-2xl border-2 border-ok bg-gradient-to-b from-ok-soft to-card p-4">
      <div className="inline-flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider text-ok">
        <CheckCircle2 size={16} aria-hidden /> {saved > 0 ? 'Deal closed' : 'Order ready'}
      </div>
      <div className="big num text-[clamp(34px,9vw,48px)] font-extrabold leading-[1.1] tracking-tight">
        {usd(deal.totalCents)}
        {saved > 0 && <span className="num ml-2.5 align-middle text-[0.45em] font-semibold text-mute line-through">{usd(deal.listTotalCents)}</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2.5">
        {saved > 0 && <span className="num rounded-full bg-ok px-3 py-0.5 text-sm font-bold text-white dark:text-[#04210f]">You save {usd(saved)}</span>}
        <span id="hold" className={cn('num inline-flex items-center gap-1.5 text-sm font-bold', expired ? 'text-bad' : 'text-accent')}>
          <Clock size={16} aria-hidden />
          {expired ? 'Price hold ended' : `Price held for ${fmtLeft(left)}`}
        </span>
      </div>
      {!expired && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden><div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} /></div>}

      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
        <dt className="text-mute">{productName ?? 'Item'}{deal.qty > 1 ? ` x ${deal.qty}` : ''}</dt><dd className="num">{usd(deal.unitCents)}{deal.qty > 1 ? ' each' : ''}</dd>
        <dt className="text-mute">Subtotal</dt><dd className="num">{usd(deal.totalCents)}</dd>
        <dt className="font-bold">Total (USD)</dt><dd className="num font-bold">{usd(deal.totalCents)}</dd>
      </dl>
      {shipping && <div className="mt-2 flex items-start gap-1.5 text-[13px] text-mute"><Truck size={14} className="mt-0.5 shrink-0" aria-hidden />{shipping}</div>}

      {expired ? (
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {onRenegotiate && <Button onClick={onRenegotiate}>Negotiate again</Button>}
          {onBuyAtList && <Button variant="ghost" onClick={onBuyAtList}>Buy at list price</Button>}
          {!onRenegotiate && !onBuyAtList && <span className="text-sm text-mute">Start a new chat to get a fresh price.</span>}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Button id="pay" variant="success" className="px-[22px] py-[13px] text-[17px]" disabled={busy} onClick={checkout}>
            Checkout with PayPal
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={copyLink} title="Copy a link to your saved price"><Link2 size={16} aria-hidden /> Save price link</Button>
        </div>
      )}
      <p className="mb-0 mt-2 text-[13px] text-mute">
        {deal.payMode === 'authorize' ? 'Your payment is only held until the designer accepts the brief. You are not charged yet.' : 'Secure checkout with PayPal. Sandbox only: no real money moves.'}
      </p>
    </div>
  );
}
