import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, RotateCcw, RotateCw, Send, ShieldCheck, Truck } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { ChatReply, Guard, Product, SessionState } from '../../api/types';
import Chips from '../../components/Chips';
import { Button, Notice } from '../../components/ui';
import { useHealth } from '../../hooks/useHealth';
import { celebrate, cn, providerLabel, usd } from '../../lib/utils';
import { buyAtCurrent, buyNow, rememberChat } from './api';
import DealCard, { type DealView } from './DealCard';
import ProductArt from './ProductArt';

const MAX_ROUNDS = 6;
interface Msg { id: number; role: 'seller' | 'buyer'; text: string; typing?: boolean; error?: boolean; retry?: string; guard?: Guard; action?: string }

// Product summary next to the chat (desktop) so the buyer never loses sight of what they are buying.
function ProductPanel({ product, price, qty, closed, onTake }: { product: Product; price: number; qty: number; closed: boolean; onTake: () => void }) {
  return (
    <aside className="sticky top-20 hidden min-w-0 flex-col gap-3 rounded-2xl border border-line bg-card p-4 shadow-card lg:flex" aria-label="Product summary">
      <ProductArt id={product.id} emoji={product.emoji} className="h-40 rounded-xl" />
      <div>
        <h2 className="m-0 text-lg font-semibold leading-snug tracking-tight">{product.name}</h2>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="num text-2xl font-extrabold">{usd(price)}</span>
          {price < product.listCents && <span className="num text-sm text-mute line-through">{usd(product.listCents)}</span>}
          {qty > 1 && <span className="text-sm text-mute">each, x{qty}</span>}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {product.highlights.map((h) => <li key={h} className="flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />{h}</li>)}
      </ul>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-[13px] text-mute">
        {product.shipping && <div className="flex items-start gap-2"><Truck size={15} className="mt-0.5 shrink-0" aria-hidden />{product.shipping}</div>}
        {product.returns && <div className="flex items-start gap-2"><RotateCcw size={15} className="mt-0.5 shrink-0" aria-hidden />{product.returns}</div>}
        <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden />Sellers' limits are enforced in code, not by the AI.</div>
      </div>
      <Button id="skipHaggle" variant="ghost" disabled={closed} onClick={onTake}>Skip haggling: buy at {usd(price)}</Button>
    </aside>
  );
}

export default function ChatRoom({ product, session, qty = 1, restored, onBack, embedded }: {
  product: Product; session: { sessionId: string; message?: string }; qty?: number; restored?: SessionState; onBack: () => void; embedded?: boolean;
}) {
  const qc = useQueryClient();
  const { data: health } = useHealth();
  const nextId = useRef(1000);
  const asDeal = (d: NonNullable<SessionState['deal']>): DealView => ({ ...d, listTotalCents: product.listCents * d.qty, payMode: product.payMode });
  const [msgs, setMsgs] = useState<Msg[]>(() => restored
    ? restored.history.map((h, i) => ({ id: i + 1, role: h.role, text: h.text, guard: h.meta?.guard, action: h.meta?.action }))
    : [{ id: 1, role: 'seller', text: session.message ?? '' }]);
  const [price, setPrice] = useState(restored ? restored.askCents : product.listCents);
  const [round, setRound] = useState(restored?.round ?? 0);
  const [counter, setCounter] = useState<number | null>(null);
  const [deal, setDeal] = useState<DealView | null>(restored?.deal ? asDeal(restored.deal) : null);
  const [closed, setClosed] = useState(restored ? restored.status !== 'open' : false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [expired, setExpired] = useState(false);
  const [text, setText] = useState('');
  const q = restored?.qty ?? qty;
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); if (!embedded) rememberChat(session.sessionId); }, [embedded, session.sessionId]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs, deal]);
  useEffect(() => { // a gentle hint if the AI is slow (the server falls back to the offline brain by itself)
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, [busy]);

  function applyReply(r: ChatReply, typingId?: number) {
    const msg: Msg = { id: typingId ?? nextId.current++, role: 'seller', text: r.message, guard: r.guard, action: r.action };
    setMsgs((m) => (typingId ? m.map((x) => (x.id === typingId ? msg : x)) : [...m, msg]));
    setPrice(r.priceCents); setRound(r.round);
    void qc.invalidateQueries({ queryKey: ['health'] });
    if (r.deal) { setDeal({ ...r.deal, listTotalCents: product.listCents * r.deal.qty, payMode: product.payMode }); setClosed(true); setCounter(null); celebrate(); }
    else if (r.status !== 'open') { setClosed(true); setCounter(null); setMsgs((m) => [...m, { id: nextId.current++, role: 'seller', text: 'This negotiation has ended.' }]); }
    else setCounter(r.action === 'counter' ? r.priceCents : null);
  }

  async function send(raw: string, retry = false) {
    const t = raw.trim();
    if (!t || busy || closed) return;
    setBusy(true); setText(''); setCounter(null);
    const typingId = nextId.current++;
    setMsgs((m) => [...m.filter((x) => !x.error), ...(retry ? [] : [{ id: nextId.current++, role: 'buyer' as const, text: t }]), { id: typingId, role: 'seller', text: '', typing: true }]);
    try {
      applyReply(await api<ChatReply>('/api/chat/message', { method: 'POST', body: { sessionId: session.sessionId, text: t } }), typingId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setExpired(true); setMsgs((m) => m.filter((x) => x.id !== typingId)); }
      else setMsgs((m) => m.map((x) => (x.id === typingId ? { id: typingId, role: 'seller', text: `${(e as Error).message}`, error: true, retry: t } : x)));
    }
    setBusy(false);
    input.current?.focus();
  }

  async function takeCurrent() {
    if (busy || deal) return; // allowed after a walk-away too: only an already-closed deal blocks it
    setBusy(true); setCounter(null);
    try { applyReply(await buyAtCurrent(session.sessionId)); }
    catch (e) {
      if (e instanceof ApiError && e.status === 404) setExpired(true);
      else setMsgs((m) => [...m, { id: nextId.current++, role: 'seller', text: (e as Error).message, error: true }]);
    }
    setBusy(false);
  }

  async function buyAtList() { // the hold ran out: a fresh deal at the stored list price
    setBusy(true);
    try { const r = await buyNow(product.id, q); setDeal({ ...r.deal }); setClosed(true); setPrice(product.listCents); }
    catch (e) { setMsgs((m) => [...m, { id: nextId.current++, role: 'seller', text: (e as Error).message, error: true }]); }
    setBusy(false);
  }

  const label = (g?: Guard) => (g ? providerLabel(g, health?.ai ?? null) : '');
  const quick = [10, 20, 30].map((pct) => ({ pct, cents: Math.round((price * (100 - pct)) / 100) }));
  const typed = Number((text.match(/\$?\s*(\d+(?:\.\d{1,2})?)/) ?? [])[1]);
  const gap = Number.isFinite(typed) && typed > 0 ? price - Math.round(typed * 100) : null;

  if (expired) {
    return (
      <section id="room"><Notice kind="info">This negotiation has expired (chats are kept for an hour). Nothing was charged.</Notice>
        <Button onClick={onBack}><ArrowLeft size={16} aria-hidden /> Back to the shop</Button></section>
    );
  }

  return (
    <section id="room">
      <div className="roombar mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        {!embedded && <Button id="back" variant="ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All products</Button>}
        <div id="curPill" className="inline-flex items-baseline gap-2 rounded-full bg-navy px-4 py-1.5 text-sm text-white" aria-live="polite">
          Current price <b id="curPrice" className="num text-xl tracking-tight">{usd(price)}</b>
        </div>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-mute">
          <span id="roundText">Offer round {Math.min(round, MAX_ROUNDS)} of {MAX_ROUNDS}</span>
          <span className="flex gap-1" aria-hidden>
            {Array.from({ length: MAX_ROUNDS }, (_, i) => <i key={i} className={cn('block h-1.5 w-[22px] rounded-sm', i < round ? 'bg-brand' : 'bg-line')} />)}
          </span>
        </div>
        {/* phones and the embedded widget have no product panel, so the way to skip haggling lives here */}
        <div className={cn('flex w-full items-center justify-between gap-2', !embedded && 'lg:hidden')}>
          <span className="min-w-0 truncate text-[13px] text-mute">{product.name}</span>
          <Button id="skipHaggleCompact" variant="ghost" className="min-h-9 shrink-0 px-3 py-1 text-xs" disabled={!!deal || busy} onClick={() => void takeCurrent()}>Skip haggling: buy at {usd(price)}</Button>
        </div>
      </div>

      <div className={cn('grid gap-4', !embedded && 'lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start')}>
        {!embedded && <ProductPanel product={product} price={price} qty={q} closed={!!deal || busy} onTake={() => void takeCurrent()} />}

        <div className={cn('chat flex min-w-0 flex-col rounded-2xl border border-line bg-card p-[18px] shadow-card', embedded ? 'h-[calc(100vh-110px)]' : 'h-[min(74vh,680px)]')}>
          <div id="msgs" ref={box} role="log" aria-label="Conversation" tabIndex={0} className="msgs flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-0.5 py-1.5">
            <AnimatePresence initial={false}>
              {msgs.map((m) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                  className={cn('msg max-w-[min(86%,520px)] whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2.5',
                    m.role === 'seller' ? 'seller self-start rounded-bl-[5px] bg-bubble' : 'buyer self-end rounded-br-[5px] bg-brand text-brand-ink',
                    m.error && 'border border-bad bg-bad-soft text-bad', m.typing && 'typing inline-flex gap-1.5 px-4 py-3.5')}
                  {...(m.typing ? { role: 'status', 'aria-label': 'The assistant is typing' } : {})}>
                  {m.typing ? <><i /><i /><i /></> : (
                    <>
                      {m.text}
                      {m.error && m.retry && <button type="button" onClick={() => void send(m.retry!, true)} className="ml-2 inline-flex items-center gap-1 rounded-lg bg-bad px-2 py-0.5 text-xs font-bold text-white"><RotateCw size={12} aria-hidden /> Retry</button>}
                      {m.guard && <Chips guard={m.guard} action={m.action} />}
                      {m.guard && <small className="who mt-1 block text-xs text-mute">{label(m.guard)}</small>}
                    </>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {slow && <div className="self-start text-xs text-mute" role="status">Taking longer than usual. The shop falls back to its offline assistant if the AI does not answer.</div>}
          </div>

          <div id="dealBox">
            {deal ? <DealCard deal={deal} productName={product.name} shipping={product.shipping} newTab={embedded} onRenegotiate={onBack} onBuyAtList={() => void buyAtList()} />
              : closed ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="success" disabled={busy} onClick={() => void takeCurrent()}>Buy at the last price {usd(price)}</Button>
                  <Button variant="ghost" onClick={onBack}>Start over</Button>
                </div>
              ) : counter !== null && !busy ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => void takeCurrent()}>Accept {usd(counter)}</Button>
                </div>
              ) : null}
          </div>

          {!closed && (
            <div className="no-print mt-2 flex flex-wrap items-center gap-1.5" aria-label="Quick offers">
              <span className="text-xs text-mute">Quick offer:</span>
              {quick.map((x) => (
                <button key={x.pct} type="button" onClick={() => { setText(`I can pay ${usd(x.cents)}`); input.current?.focus(); }}
                  className="num rounded-full bg-chip px-3 py-1 text-xs font-semibold text-ink hover:bg-brand-soft">
                  {x.pct}% off ({usd(x.cents)})
                </button>
              ))}
            </div>
          )}

          {!closed && gap !== null && (
            <div className="mt-1.5 text-xs text-mute" aria-live="polite">
              Your offer <b className="num text-ink">{usd(Math.round(typed * 100))}</b> · seller's price <b className="num text-ink">{usd(price)}</b>
              {gap > 0 ? <> · <span className="num">{usd(gap)}</span> apart</> : <> · at or above the seller's price: you can just accept it</>}
            </div>
          )}

          <form id="form" autoComplete="off" className="composer mt-2.5 flex gap-2 pb-[env(safe-area-inset-bottom)]" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <label className="sr" htmlFor="text">Your message or offer</label>
            <input id="text" ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} required disabled={closed}
              placeholder={closed ? 'This negotiation is closed' : 'Try: I can pay $40'} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-base text-ink" />
            <Button id="send" disabled={busy || closed}><Send size={16} aria-hidden /> Send</Button>
          </form>
        </div>
      </div>
    </section>
  );
}
