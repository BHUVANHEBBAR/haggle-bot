import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Lock, MessageCircle, Minus, Plus, RotateCcw, ShieldCheck, ShoppingBag, Truck, Wallet } from 'lucide-react';
import { api } from '../../api/client';
import type { ChatStart, Product, PublicDeal, SessionState } from '../../api/types';
import { Button, Card, Notice } from '../../components/ui';
import { cn, usd } from '../../lib/utils';
import { toast } from 'sonner';
import { buyNow, forgetChat, getSession, recallChat } from './api';
import ChatRoom from './ChatRoom';
import DealCard from './DealCard';
import ProductArt from './ProductArt';

type NoticeState = { kind: 'ok' | 'bad' | 'info'; text: string } | null;
interface Room { product: Product; session: { sessionId: string; message?: string }; qty: number; restored?: SessionState }

function Badge({ p }: { p: Product }) {
  const base = 'absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold shadow-sm';
  if (!p.inStock && p.reserved) return <span className={cn(base, 'bg-warn-soft text-warn')}>Being checked out by another buyer</span>;
  if (!p.inStock) return <span className={cn(base, 'bg-chip text-mute')}>Sold out</span>;
  if (p.stock) return <span className={cn(base, 'tag low bg-warn-soft text-warn')}>Only {p.stock} left</span>;
  return null;
}

function QtyStepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  if (max <= 1) return null;
  const b = 'grid size-9 place-items-center rounded-lg bg-chip text-ink hover:bg-brand-soft disabled:opacity-40';
  return (
    <div className="flex items-center gap-2 text-sm" role="group" aria-label="Quantity">
      <button type="button" className={b} aria-label="One fewer" disabled={value <= 1} onClick={() => onChange(value - 1)}><Minus size={16} aria-hidden /></button>
      <span className="num w-6 text-center font-bold" aria-live="polite">{value}</span>
      <button type="button" className={b} aria-label="One more" disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={16} aria-hidden /></button>
    </div>
  );
}

function ProductCard({ p, onHaggle, onBuy, busy }: { p: Product; onHaggle: (p: Product, qty: number) => void; onBuy: (p: Product, qty: number) => void; busy: boolean }) {
  const maxQty = !p.physical ? 1 : Math.min(10, p.stock ?? 10);
  const [qty, setQty] = useState(1);
  return (
    <article className="pcard group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative">
        <ProductArt id={p.id} emoji={p.emoji} className="h-44" />
        <Badge p={p} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-[18px]">
        <h3 className="m-0 text-lg font-semibold leading-snug tracking-tight">{p.name}</h3>
        <p className="m-0 line-clamp-2 text-sm text-mute">{p.description}</p>
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {p.highlights.map((h) => <li key={h} className="inline-flex items-center gap-1 rounded-full bg-chip px-2.5 py-0.5 text-xs font-semibold"><Check size={12} className="text-ok" aria-hidden />{h}</li>)}
        </ul>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-1">
          <div>
            <div className="price num text-[28px] font-extrabold leading-none tracking-tight">{usd(p.listCents)}</div>
            <div className="mt-1 text-xs text-mute">list price, USD</div>
          </div>
          <QtyStepper value={qty} max={maxQty} onChange={setQty} />
        </div>
        {p.bulkQty && p.physical ? <div className="text-xs text-mute">Buying {p.bulkQty} or more? Haggle for a better price.</div> : null}
        {p.inStock ? (
          <div className="mt-1 grid grid-cols-[1.4fr_1fr] gap-2">
            <Button className="whitespace-nowrap px-3" disabled={busy} onClick={() => onHaggle(p, qty)}><MessageCircle size={16} aria-hidden /> Make an offer</Button>
            <Button variant="ghost" className="whitespace-nowrap px-3" disabled={busy} onClick={() => onBuy(p, qty)}><ShoppingBag size={16} aria-hidden /> Buy now</Button>
          </div>
        ) : (
          <Button variant="ghost" disabled className="mt-1">{p.reserved ? 'Back in a few minutes if the checkout is abandoned' : 'Sold out'}</Button>
        )}
        <div className="flex flex-col gap-1 border-t border-line pt-2 text-xs text-mute">
          {p.shipping && <span className="flex items-start gap-1.5"><Truck size={13} className="mt-px shrink-0" aria-hidden />{p.shipping}</span>}
          {p.returns && <span className="flex items-start gap-1.5"><RotateCcw size={13} className="mt-px shrink-0" aria-hidden />{p.returns}</span>}
        </div>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card" aria-hidden>
      <div className="h-44 animate-pulse bg-chip" />
      <div className="flex flex-col gap-2.5 p-[18px]">
        <div className="h-5 w-3/4 animate-pulse rounded bg-chip" /><div className="h-4 w-full animate-pulse rounded bg-chip" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-chip" /><div className="mt-2 h-10 animate-pulse rounded-xl bg-chip" />
      </div>
    </div>
  );
}

const steps = [
  { icon: MessageCircle, title: 'Make an offer', text: 'Tell the shop what you would pay. Or buy at list price, no haggling needed.' },
  { icon: ShieldCheck, title: 'The AI counters inside the seller\'s limits', text: 'It words the replies. Plain code decides the price and can never go below the seller\'s minimum.' },
  { icon: Wallet, title: 'Pay with PayPal', text: 'Your agreed price is held for a few minutes while you check out. Sandbox only: no real money moves.' },
];

export default function Shop() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [notice, setNotice] = useState<NoticeState>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [resume, setResume] = useState<PublicDeal | null>(null);
  const [saved, setSaved] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['products'], queryFn: () => api<{ products: Product[] }>('/api/products') });

  // PayPal sends the buyer back to /app/?deal=<id>&error=declined|cancelled|failed (a successful payment goes to the order page)
  useEffect(() => {
    const id = params.get('deal');
    if (!id) return;
    const err = params.get('error');
    nav('/', { replace: true });
    (async () => {
      let deal: PublicDeal | null = null;
      try { deal = (await api<{ deal: PublicDeal }>(`/api/deals/${id}`)).deal; } catch { /* ignore */ }
      if (err === 'declined') setNotice({ kind: 'bad', text: 'Your payment method was declined. Your negotiated price is still held, so you can try again.' });
      else if (err === 'cancelled') setNotice({ kind: 'info', text: 'Checkout cancelled. Your negotiated price is held for a few minutes.' });
      else if (err) setNotice({ kind: 'bad', text: 'Something went wrong with the payment. You have not been charged.' });
      else if (deal?.status === 'authorized') setNotice({ kind: 'ok', text: `Payment of ${usd(deal.totalCents)} is on hold for "${deal.productName}". It is charged only when the seller accepts. Order reference: ${deal.id}` });
      else if (deal?.status === 'captured') setNotice({ kind: 'ok', text: `Paid ${usd(deal.totalCents)} for "${deal.productName}". Thank you! Order reference: ${deal.id}` });
      if (err && deal && ['agreed', 'order_created'].includes(deal.status)) setResume(deal);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // an unfinished negotiation survives a refresh
  useEffect(() => {
    const sid = recallChat();
    if (!sid || params.get('deal')) return;
    getSession(sid).then((s) => { if (s.status === 'open' || (s.status === 'agreed' && s.deal)) setSaved(s); else forgetChat(); }).catch(() => forgetChat());
  }, [params]);

  async function haggle(p: Product, qty: number) {
    setNotice(null); setBusy(true);
    try {
      const session = await api<ChatStart>('/api/chat/start', { method: 'POST', body: { productId: p.id, qty } });
      if (session.qty < qty) toast.info(`Only ${session.qty} available right now, so we set the quantity to ${session.qty}.`);
      setRoom({ product: p, session, qty: session.qty }); setSaved(null);
    } catch (e) { toast.error((e as Error).message); void refetch(); }
    setBusy(false);
  }

  async function buy(p: Product, qty: number) {
    setNotice(null); setBusy(true);
    try {
      const r = await buyNow(p.id, qty);
      if (r.deal.qty < qty) toast.info(`Only ${r.deal.qty} available right now, so we set the quantity to ${r.deal.qty}.`);
      nav(`/order/${r.deal.id}`);
    } catch (e) { toast.error((e as Error).message); void refetch(); }
    setBusy(false);
  }

  const back = () => { setRoom(null); setResume(null); void refetch(); };
  const products = data?.products ?? [];

  return (
    <>
      <div id="notice" role="status">{notice && <Notice kind={notice.kind}>{notice.text}</Notice>}</div>

      {room ? <ChatRoom product={room.product} session={room.session} qty={room.qty} restored={room.restored} onBack={back} /> : resume ? (
        <section id="room">
          <div className="mb-3"><Button id="back" variant="ghost" onClick={back}>&larr; All products</Button></div>
          <Card>
            <div className="msg seller mb-2 max-w-[86%] rounded-[18px] rounded-bl-[5px] bg-bubble px-3.5 py-2.5">Your deal is still available. Pay below when you are ready.</div>
            <div id="dealBox">
              <DealCard productName={resume.productName} deal={{ id: resume.id, unitCents: resume.unitCents, totalCents: resume.totalCents, listTotalCents: resume.listTotalCents, qty: resume.qty, expiresAt: resume.expiresAt, payMode: resume.payMode }}
                onRenegotiate={back} onBuyAtList={() => void buy(products.find((p) => p.id === resume.productId) ?? ({ id: resume.productId } as Product), resume.qty)} />
            </div>
          </Card>
        </section>
      ) : (
        <section id="shop">
          <div className="hero mb-5 rounded-[20px] bg-gradient-to-br from-navy to-[#123a7a] px-[22px] py-7 text-white shadow-card">
            <h1 className="mb-2 mt-0 text-[clamp(26px,5vw,38px)] font-extrabold leading-[1.15] tracking-tight">Haggle for a better price, or just buy.</h1>
            <p className="mb-[18px] max-w-[62ch] text-[#c8d6ef]">Make an offer and our AI haggles with you, or skip straight to checkout at list price. Either way you pay with PayPal.</p>
            <ul className="trust m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5 p-0">
              {[[Lock, 'Price held on the server'], [ShieldCheck, 'Seller limits enforced in code'], [Wallet, 'PayPal checkout, sandbox only']].map(([Icon, t]) => {
                const I = Icon as typeof Lock;
                return <li key={t as string} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-semibold"><I size={20} className="shrink-0 text-green-300" aria-hidden />{t as string}</li>;
              })}
            </ul>
          </div>

          {saved && (
            <Notice kind="info">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <span id="resumeBanner">You have an unfinished {saved.status === 'agreed' ? 'order' : 'negotiation'} for <b>{saved.product.name}</b> at <b className="num">{usd(saved.askCents)}</b>.</span>
                <span className="flex gap-2">
                  <Button className="min-h-9 px-3 py-1.5 text-sm" onClick={() => { setRoom({ product: saved.product, session: { sessionId: saved.sessionId }, qty: saved.qty, restored: saved }); setSaved(null); }}>Resume</Button>
                  <Button variant="ghost" className="min-h-9 px-3 py-1.5 text-sm" onClick={() => { forgetChat(); setSaved(null); }}>Dismiss</Button>
                </span>
              </div>
            </Notice>
          )}

          {isError ? (
            <Notice kind="bad"><div className="flex flex-wrap items-center justify-between gap-2.5">The shop could not load the products. Check your connection and try again.<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div></Notice>
          ) : (
            <div id="products" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
              {isLoading ? [0, 1, 2].map((i) => <SkeletonCard key={i} />) : products.map((p) => <ProductCard key={p.id} p={p} busy={busy} onHaggle={(x, q) => void haggle(x, q)} onBuy={(x, q) => void buy(x, q)} />)}
            </div>
          )}

          <h2 className="mb-3 mt-9 text-xl font-semibold tracking-tight">How it works</h2>
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-3 p-0">
            {steps.map(({ icon: I, title, text }, i) => (
              <li key={title}><Card className="h-full">
                <div className="mb-2 flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-[10px] bg-brand-soft text-brand"><I size={18} aria-hidden /></span><span className="text-xs font-bold uppercase tracking-wider text-mute">Step {i + 1}</span></div>
                <strong>{title}</strong><p className="m-0 mt-1 text-sm text-mute">{text}</p>
              </Card></li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
