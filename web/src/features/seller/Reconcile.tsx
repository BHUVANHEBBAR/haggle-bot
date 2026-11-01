import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button, Card } from '../../components/ui';
import { cn, usd } from '../../lib/utils';
import { headers } from './api';

interface Row { dealId: string; productName: string; ourStatus: string; ourCents: number; result: 'matched' | 'mismatch' | 'missing' | 'error' | 'skipped'; message: string; debugId?: string | null; paypal?: { kind: string; id: string; status: string; amountCents: number }; mismatches?: { field: string; ours: unknown; paypal: unknown }[] }
export interface ReconcileReport {
  at: string; mode: 'sandbox' | 'simulated';
  summary: { checked: number; matched: number; mismatched: number; missing: number; errors: number; confirmedReceivedCents: number; confirmedHeldCents: number; confirmedRefundedCents: number };
  results: Row[];
  account: { available: boolean; notes: string[]; balances: { currency: string; totalCents: number }[]; transactions: { id: string; amountCents: number; date: string | null; status: string }[]; totalTransactions?: number;
    unmatched?: { id: string; amountCents: number; date: string | null; status: string; eventCode: string | null }[]; missingFromPaypal?: { dealId: string; captureId: string }[] };
}

const tone: Record<string, string> = {
  matched: 'bg-ok-soft text-[#166534] dark:text-ok', mismatch: 'bg-bad-soft text-bad', missing: 'bg-warn-soft text-warn', error: 'bg-bad-soft text-bad', skipped: 'bg-chip text-mute',
};

// "PayPal confirms $X received": every paid deal is fetched from PayPal by its stored id and compared with our records.
export default function Reconcile({ sellerKey }: { sellerKey: string }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const { data } = useQuery({ queryKey: ['reconcile', sellerKey], queryFn: () => api<{ report: ReconcileReport | null }>('/api/seller/reconcile', { headers: headers(sellerKey) }) });
  const report = data?.report ?? null;

  async function run() {
    setRunning(true);
    try {
      const r = await api<{ report: ReconcileReport }>('/api/seller/reconcile', { method: 'POST', headers: headers(sellerKey), body: {} });
      qc.setQueryData(['reconcile', sellerKey], r);
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) { toast.error((e as Error).message); }
    setRunning(false);
  }

  const s = report?.summary;
  return (
    <Card id="reconcilePanel" className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="inline-flex items-center gap-2"><BadgeCheck size={18} aria-hidden /> PayPal check</strong>
          <div className="text-[13px] text-mute">PayPal is the source of truth. Every payment is fetched from PayPal by its ID and compared with your records (amount, currency, status).</div>
        </div>
        <Button id="reconcileBtn" variant="ghost" disabled={running} onClick={() => void run()}><RefreshCw size={16} className={cn(running && 'animate-spin')} aria-hidden /> {running ? 'Asking PayPal...' : report ? 'Check again' : 'Reconcile with PayPal'}</Button>
      </div>

      {report && s && (
        <div className="mt-3" aria-live="polite">
          <div id="reconcileSummary" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-bold text-[#166534] dark:text-ok">PayPal confirms <span className="num">{usd(s.confirmedReceivedCents)}</span> received</span>
            {s.confirmedHeldCents > 0 && <span><span className="num font-bold">{usd(s.confirmedHeldCents)}</span> on hold</span>}
            {s.confirmedRefundedCents > 0 && <span><span className="num font-bold">{usd(s.confirmedRefundedCents)}</span> refunded</span>}
            <span className="text-mute">{s.matched} of {s.checked} payments match{s.mismatched + s.missing + s.errors > 0 ? `, ${s.mismatched + s.missing + s.errors} need attention` : ''}</span>
            <span className="rounded-full bg-chip px-2 py-0.5 text-xs font-semibold text-mute">{report.mode === 'sandbox' ? 'live PayPal sandbox' : 'simulated PayPal'}</span>
          </div>
          {report.results.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table id="reconcileRows" className="w-full border-collapse text-sm">
                <thead><tr>{['Deal', 'Our record', 'PayPal says', 'Result'].map((h) => <th key={h} className="whitespace-nowrap border-b border-line p-2 text-left text-xs font-bold uppercase tracking-wider text-mute">{h}</th>)}</tr></thead>
                <tbody>
                  {report.results.map((r) => (
                    <tr key={r.dealId} className="border-b border-line align-top">
                      <td className="p-2">{r.productName}<div className="text-xs text-mute">{r.dealId.slice(0, 8)}</div></td>
                      <td className="num p-2">{usd(r.ourCents)}<div className="text-xs text-mute">{r.ourStatus}</div></td>
                      <td className="num p-2">{r.paypal ? <>{usd(r.paypal.amountCents)}<div className="text-xs text-mute">{r.paypal.kind} {r.paypal.status}</div></> : <span className="text-mute">-</span>}</td>
                      <td className="p-2"><span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-bold', tone[r.result])}>{r.result}</span>
                        <div className="mt-0.5 text-xs text-mute">{r.message}{r.mismatches?.length ? ` (${r.mismatches.map((m) => `${m.field}: ours ${String(m.ours)}, PayPal ${String(m.paypal)}`).join('; ')})` : ''}{r.debugId ? ` · debug_id ${r.debugId}` : ''}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 text-[13px] text-mute">
            {report.account.available
              ? <>Account view: {report.account.balances.map((b) => `${b.currency} balance ${usd(b.totalCents)}`).join(', ') || 'no balance data'}{report.account.transactions.length ? `, ${report.account.transactions.length} recent transactions` : ''}.</>
              : report.account.notes.map((n) => <div key={n}>{n}</div>)}
            {report.account.available && report.account.notes.map((n) => <div key={n}>{n}</div>)}
          </div>
          {report.account.available && (
            <div className="mt-2 rounded-xl border border-line p-3 text-[13px]" data-testid="two-way">
              <b>PayPal has {report.account.unmatched?.length ?? 0} transaction(s) that no HaggleBot deal explains</b>
              <span className="text-mute"> (sandbox test funding and other apps show up here; each should be something you recognise).</span>
              {!!report.account.unmatched?.length && (
                <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0 text-mute">
                  {report.account.unmatched.slice(0, 5).map((t) => <li key={t.id}><code>{t.id}</code> · {usd(t.amountCents)} · {t.status}{t.eventCode ? ` · ${t.eventCode}` : ''}</li>)}
                </ul>
              )}
              {!!report.account.missingFromPaypal?.length && <div className="mt-1.5">{report.account.missingFromPaypal.length} paid deal(s) are not in PayPal's report yet (reports lag).</div>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
