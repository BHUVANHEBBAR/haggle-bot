import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, PackageCheck, Printer, RotateCcw, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { Product, PublicDeal } from '../../api/types';
import { Button, Card, Notice, StatusPill } from '../../components/ui';
import { usd } from '../../lib/utils';
import { buyNow } from './api';
import DealCard from './DealCard';
import ProductArt from './ProductArt';

// One page for every moment after a price is agreed: review and pay, paid, on hold, refunded, expired.
export default function OrderPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data: d, isLoading, isError } = useQuery({ queryKey: ['deal', id], queryFn: () => api<{ deal: PublicDeal }>(`/api/deals/${id}`).then((r) => r.deal), retry: false,
    refetchInterval: (q) => (q.state.data?.pending || q.state.data?.status === 'invoiced' ? 5000 : false) }); // a pending PayPal capture finishes on its own
  const { data: prods } = useQuery({ queryKey: ['products'], queryFn: () => api<{ products: Product[] }>('/api/products') });

  if (isLoading) return <div className="h-60 animate-pulse rounded-2xl border border-line bg-card" aria-label="Loading your order" />;
  if (isError || !d) return (
    <Card className="mx-auto max-w-xl text-center"><h1 className="mt-0 text-2xl font-extrabold">We could not find that order</h1>
      <p className="text-mute">The link may be wrong, or the shop was restarted. Nothing was charged.</p><Link to="/" className="font-bold text-brand">Back to the shop</Link></Card>
  );

  const product = prods?.products.find((p) => p.id === d.productId);
  const pending = !!d.pending && d.status === 'order_created'; // PayPal accepted the payment but has not completed it yet
  const unpaid = (d.status === 'agreed' || d.status === 'order_created') && !pending;
  const live = unpaid && Date.parse(d.expiresAt) > Date.now();
  const expired = d.status === 'expired' || (unpaid && !live);
  const paid = d.status === 'captured', held = d.status === 'authorized', invoiced = d.status === 'invoiced';

  async function buyAgain() {
    try { const r = await buyNow(d!.productId, d!.qty); nav(`/order/${r.deal.id}`); } catch (e) { toast.error((e as Error).message); }
  }

  const headline = invoiced ? 'Pay your PayPal invoice' : pending ? 'PayPal is confirming your payment' : paid ? 'Thank you! Payment received' : held ? 'Payment is on hold' : d.status === 'refunded' ? 'This order was refunded' : d.status === 'voided' ? 'The hold was released' : expired ? 'This price has expired' : 'Review and pay';
  const sub = invoiced ? 'The seller sent you a PayPal invoice for the price you agreed. Pay it on PayPal; this page updates once PayPal confirms.' : pending ? 'Your payment is pending at PayPal. This page updates by itself when PayPal confirms it. Please do not pay again.' : paid ? (product?.physical ? 'The seller will ship your order. You will get PayPal\'s receipt by email.' : 'The designer will start on your brief.')
    : held ? 'You are charged only if the designer accepts your brief; otherwise the hold is released.'
    : d.status === 'refunded' ? 'The money is on its way back to your PayPal account.' : d.status === 'voided' ? 'You were not charged.'
    : expired ? 'No problem: you can get a fresh price.' : 'Your price is saved. Check out before the timer ends.';

  return (
    <div className="mx-auto max-w-3xl">
      <div id="notice" role="status">
        {paid && <Notice kind="ok">{`Paid ${usd(d.totalCents)} for "${d.productName}". Order reference: ${d.id}`}</Notice>}
        {held && <Notice kind="ok">{`Payment of ${usd(d.totalCents)} is on hold for "${d.productName}". It is charged only when the seller accepts. Order reference: ${d.id}`}</Notice>}
      </div>
      <div className="mb-1 flex items-center gap-2.5 text-sm font-semibold text-mute no-print">
        <Link to="/" className="text-brand no-underline">Shop</Link> / <span>Order {d.id.slice(0, 8)}</span> <StatusPill status={d.status} />
      </div>
      <h1 className="mb-1 mt-1 flex items-center gap-2.5 text-[clamp(24px,5vw,34px)] font-extrabold leading-tight tracking-tight">
        {paid || held ? <CheckCircle2 className="text-ok" size={30} aria-hidden /> : expired ? <Clock className="text-accent" size={30} aria-hidden /> : <PackageCheck className="text-brand" size={30} aria-hidden />}{headline}
      </h1>
      <p className="mb-4 mt-0 text-mute">{sub}</p>
      {['agreed', 'order_created', 'authorized', 'captured', 'invoiced'].includes(d.status) && (() => {
        // done steps are filled; "current" is what is happening now: paying, or (after payment) the seller's turn
        const at = paid ? 2 : 1;
        const steps = ['Price agreed', held ? 'Payment on hold' : invoiced ? 'Invoice sent' : pending ? 'PayPal confirming' : 'Pay with PayPal', product?.physical ? 'Seller ships' : 'Work starts'];
        return (
          <ol aria-label="Order progress" className="no-print mb-4 grid list-none grid-cols-3 gap-2 p-0">
            {steps.map((s, i) => (
              <li key={s} aria-current={i === at ? 'step' : undefined}
                className={`rounded-xl border px-3 py-2 text-center text-[13px] font-semibold ${i < at ? 'border-ok bg-ok-soft text-ink' : i === at ? 'border-brand border-2 bg-brand-soft text-ink' : 'border-line text-mute'}`}>
                {i < at ? <CheckCircle2 size={14} className="mr-1 inline text-ok" aria-hidden /> : <span className="num mr-1">{i + 1}.</span>}{s}
                {i < at && <span className="sr"> (done)</span>}{i === at && <span className="sr"> (current step)</span>}
              </li>
            ))}
          </ol>
        );
      })()}

      <Card className="mb-4">
        <div className="flex gap-4">
          <ProductArt id={d.productId} className="size-24 shrink-0 rounded-xl sm:size-28" />
          <div className="min-w-0">
            <h2 className="m-0 text-lg font-semibold leading-snug">{d.productName}</h2>
            <div className="num mt-1 text-sm text-mute">{d.qty} x {usd(d.unitCents)}{d.listTotalCents > d.totalCents ? <> · list <s>{usd(d.listTotalCents / d.qty)}</s></> : null}</div>
            <div className="num mt-1 text-2xl font-extrabold">{usd(d.totalCents)} <span className="text-sm font-semibold text-mute">USD</span></div>
            <div className="mt-1 text-xs text-mute">{d.source === 'buy_now' ? 'Bought at list price' : 'Price agreed by haggling'}</div>
            {product?.shipping && <div className="mt-1 text-xs text-mute">{product.shipping}</div>}
          </div>
        </div>
      </Card>

      {live && <div id="dealBox"><DealCard productName={d.productName} shipping={product?.shipping}
        deal={{ id: d.id, unitCents: d.unitCents, totalCents: d.totalCents, listTotalCents: d.listTotalCents, qty: d.qty, expiresAt: d.expiresAt, payMode: d.payMode }}
        onRenegotiate={() => nav('/')} onBuyAtList={() => void buyAgain()} /></div>}

      {expired && (
        <div className="flex flex-wrap gap-2.5">
          <Button onClick={() => nav('/')}><ShoppingBag size={16} aria-hidden /> Negotiate again</Button>
          <Button variant="ghost" onClick={() => void buyAgain()}>Buy at list price</Button>
        </div>
      )}

      {invoiced && d.invoice?.url && (
        <div className="mb-4"><a className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 py-2.5 font-bold text-white no-underline" href={d.invoice.url} target="_blank" rel="noreferrer">Open the PayPal invoice</a></div>
      )}

      {(paid || held) && (
        <div className="no-print flex flex-wrap gap-2.5">
          <Button onClick={() => nav('/')}><ShoppingBag size={16} aria-hidden /> Continue shopping</Button>
          <Button variant="ghost" onClick={() => window.print()}><Printer size={16} aria-hidden /> Print receipt</Button>
        </div>
      )}
      {(d.status === 'refunded' || d.status === 'voided') && <Button variant="ghost" onClick={() => nav('/')}><RotateCcw size={16} aria-hidden /> Back to the shop</Button>}

      <p className="mt-6 text-xs text-mute">{product?.returns} Reference {d.id}. Sandbox store: no real money moves.</p>
    </div>
  );
}
