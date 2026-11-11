import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { cn, usd } from '../../lib/utils';
import type { SellerDeal, TrailStep } from './api';

// Everything behind a deal, for the seller: the PayPal money trail (real ids and debug_ids) and the chat.
// Native <dialog>: focus trap, Esc to close, no extra dependency.
const stepTitle = (t: TrailStep): string => ({
  agreed: `Price agreed (${t.source === 'buy_now' ? 'bought at list price' : 'haggled'})`,
  order_created: 'PayPal order created',
  buyer_approved: 'Buyer approved on PayPal',
  authorized: 'Payment authorized (held, not charged)',
  captured: t.by === 'seller' ? 'Payment captured by you' : 'Payment captured',
  refunded: 'Payment refunded',
  voided: 'Hold released',
  tracking_added: `Tracking added (${t.carrier ?? ''} ${t.trackingNumber ?? ''}) ${t.sentToPayPal ? 'and sent to PayPal' : 'on your side only: invoice payments have no PayPal order to attach it to'}`,
  invoice_sent: 'PayPal invoice sent to the buyer',
  invoice_paid: 'Buyer paid the PayPal invoice',
  invoice_cancelled: `PayPal invoice ${t.invoiceStatus ?? 'cancelled'}`,
  payment_declined: 'Payment declined by the card or bank',
  reconciled: `Checked against PayPal: ${t.result ?? ''}`,
  capture_pending: 'Capture is PENDING at PayPal (money not moved yet)',
  webhook: `PayPal webhook: ${t.eventType ?? ''}`,
  dispute: `Dispute ${t.disputeStatus ?? ''}: ${t.reason ?? 'see PayPal'} (review it in PayPal; never auto-accepted)`,
}[t.step] ?? t.step);

function Ids({ t }: { t: TrailStep }) {
  const ids = [['order', t.orderId], ['invoice', t.invoiceId], ['capture', t.captureId], ['authorization', t.authorizationId], ['refund', t.refundId], ['dispute', t.disputeId], ['event', t.eventId], ['debug_id', t.debugId], ['PayPal status', t.paypalStatus]].filter(([, v]) => v) as [string, string][];
  if (!ids.length && !t.issue) return null;
  return <div className="num mt-0.5 break-all text-xs text-mute">{ids.map(([k, v]) => `${k}: ${v}`).join(' · ')}{t.issue ? ` · ${t.issue}` : ''}</div>;
}

export default function TranscriptDialog({ deal, onClose }: { deal: SellerDeal | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'trail' | 'chat'>('trail');
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (deal && !d.open) { setTab('trail'); d.showModal(); }
    if (!deal && d.open) d.close();
  }, [deal]);
  const tabBtn = (id: 'trail' | 'chat', text: string) => (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('rounded-full px-3.5 py-1.5 text-sm font-semibold', tab === id ? 'bg-brand text-brand-ink' : 'bg-chip text-ink hover:bg-brand-soft')}>{text}</button>
  );
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label="Deal details"
      className="m-auto w-[min(600px,calc(100vw-24px))] rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/50">
      {deal && (
        <div className="flex max-h-[82vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line p-4">
            <div className="min-w-0">
              <h2 className="m-0 text-lg font-semibold">{deal.productName}{deal.qty > 1 ? ` x${deal.qty}` : ''}</h2>
              <div className="num text-sm text-mute">{usd(deal.totalCents)} · {deal.source === 'buy_now' ? 'bought at list price' : `haggled from ${usd(deal.listTotalCents)}`} · floor {usd(deal.floorTotalCents)}</div>
              <div className="num break-all text-xs text-mute">deal {deal.id}</div>
            </div>
            <button onClick={onClose} aria-label="Close details" className="grid size-9 shrink-0 place-items-center rounded-full bg-chip hover:bg-brand-soft"><X size={18} aria-hidden /></button>
          </div>
          <div role="tablist" aria-label="Deal details" className="flex gap-2 px-4 pt-3">{tabBtn('trail', `PayPal money trail (${deal.trail?.length ?? 0})`)}{tabBtn('chat', 'Chat')}</div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-4" tabIndex={0}>
            {tab === 'trail' ? (
              <ol id="moneyTrail" className="m-0 list-none border-l-2 border-line p-0 pl-4">
                {(deal.trail ?? []).map((t, i) => (
                  <li key={i} className="trail-step relative pb-3">
                    <span className={cn('absolute -left-[23px] top-1 size-3 rounded-full border-2 border-card', t.step === 'webhook' ? 'bg-brand' : t.step === 'refunded' || t.step === 'voided' || t.step === 'payment_declined' ? 'bg-bad' : 'bg-ok')} aria-hidden />
                    <div className="text-sm font-semibold">{stepTitle(t)}{t.step === 'webhook' && t.verified && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-bold text-[#166534] dark:text-ok"><ShieldCheck size={12} aria-hidden /> signature verified</span>}</div>
                    <div className="text-xs text-mute">{new Date(t.ts).toLocaleString()}</div>
                    <Ids t={t} />
                  </li>
                ))}
                {(deal.trail ?? []).length === 0 && <li className="text-sm text-mute">No PayPal steps recorded for this deal.</li>}
              </ol>
            ) : deal.transcript.length === 0 ? <p className="m-0 text-sm text-mute">No chat: the buyer used Buy now.</p> : deal.transcript.map((t, i) => (
              <div key={i} className={cn('max-w-[86%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm', t.role === 'seller' ? 'self-start bg-bubble' : 'self-end bg-brand text-brand-ink')}>{t.text}</div>
            ))}
          </div>
        </div>
      )}
    </dialog>
  );
}
