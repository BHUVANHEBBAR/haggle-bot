import { useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button, StatusPill } from '../../components/ui';
import { gridTheme } from '../../lib/ag';
import { usd } from '../../lib/utils';
import { headers, type SellerDeal } from './api';
import TranscriptDialog from './TranscriptDialog';

// Phones get a card list: a six-column grid would hide the money buttons off screen.
function useNarrow() {
  const q = '(max-width: 719px)';
  const [n, setN] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const h = () => setN(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);
  return n;
}

// Deals table (AG Grid Community): sorting, filtering, pagination, CSV export, and the money actions.
export default function DealsGrid({ deals, sellerKey, onChanged }: { deals: SellerDeal[]; sellerKey: string; onChanged: () => void }) {
  const ref = useRef<AgGridReact<SellerDeal>>(null);
  const [filter, setFilter] = useState('');
  const [viewing, setViewing] = useState<SellerDeal | null>(null);
  const [invoicing, setInvoicing] = useState<SellerDeal | null>(null);
  const [email, setEmail] = useState('');

  async function sendInvoice() {
    if (!invoicing) return;
    try {
      await api(`/api/seller/deals/${invoicing.id}/invoice`, { method: 'POST', headers: headers(sellerKey), body: { email } });
      toast.success('PayPal invoice sent');
      setInvoicing(null); setEmail(''); onChanged();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function invoiceAction(id: string, what: 'refresh' | 'cancel') {
    try {
      await api(`/api/seller/deals/${id}/invoice/${what}`, { method: 'POST', headers: headers(sellerKey) });
      toast.success(what === 'refresh' ? 'Invoice checked with PayPal' : 'Invoice cancelled');
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
  }

  async function act(id: string, what: 'capture' | 'void' | 'refund') {
    try {
      await api(`/api/seller/deals/${id}/${what}`, { method: 'POST', headers: headers(sellerKey) });
      toast.success(what === 'capture' ? 'Payment captured' : what === 'void' ? 'Hold released' : 'Refund issued');
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
  }

  const actions = (x: SellerDeal, wrap: boolean) => {
    return (
      <div className={wrap ? 'flex flex-wrap items-center gap-1.5' : 'flex flex-nowrap items-center gap-1.5'}>
          <Button variant="ghost" className="min-h-[34px] whitespace-nowrap px-3 py-1.5 text-[13px]" onClick={() => setViewing(x)}>Details</Button>
          {x.status === 'authorized' && <>
            <Button className="min-h-[34px] whitespace-nowrap px-3 py-1.5 text-[13px]" onClick={() => void act(x.id, 'capture')}>Accept job (capture)</Button>
            <Button variant="ghost" className="min-h-[34px] whitespace-nowrap px-3 py-1.5 text-[13px]" onClick={() => void act(x.id, 'void')}>Decline (release hold)</Button>
          </>}
          {x.status === 'captured' && <Button variant="ghost" className="min-h-[34px] px-3 py-1.5 text-[13px]" onClick={() => void act(x.id, 'refund')}>Refund</Button>}
          {(x.status === 'agreed' || x.status === 'expired') && <Button variant="ghost" className="min-h-[34px] whitespace-nowrap px-3 py-1.5 text-[13px]" onClick={() => { setEmail(''); setInvoicing(x); }}>Send PayPal invoice</Button>}
          {x.status === 'invoiced' && <>
            {x.invoice?.url && <a className="whitespace-nowrap text-[13px] font-bold text-brand" href={x.invoice.url} target="_blank" rel="noreferrer">Open invoice</a>}
            <Button variant="ghost" className="min-h-[34px] whitespace-nowrap px-3 py-1.5 text-[13px]" onClick={() => void invoiceAction(x.id, 'refresh')}>Check with PayPal</Button>
            <Button variant="ghost" className="min-h-[34px] whitespace-nowrap px-3 py-1.5 text-[13px]" onClick={() => void invoiceAction(x.id, 'cancel')}>Cancel invoice</Button>
          </>}
      </div>
    );
  };

  const narrow = useNarrow();
  const cols = useMemo<ColDef<SellerDeal>[]>(() => [
    { headerName: 'Product', flex: 2, minWidth: 190, valueGetter: (p) => (p.data ? p.data.productName + (p.data.qty > 1 ? ` x${p.data.qty}` : '') : '') },
    { headerName: 'Price', field: 'totalCents', width: 130, cellRenderer: (p: { data?: SellerDeal }) => p.data && (
      <div><div className="num">{usd(p.data.totalCents)}</div><div className="text-[13px] leading-tight text-mute">list {usd(p.data.listTotalCents)}</div></div>) },
    { headerName: 'Your floor', field: 'floorTotalCents', width: 130, valueFormatter: (p) => usd(p.value as number) },
    { headerName: 'Source', field: 'source', width: 120, valueFormatter: (p) => (p.value === 'buy_now' ? 'Bought' : 'Haggled') },
    { headerName: 'Status', field: 'status', width: 140, cellRenderer: (p: { value: string }) => <StatusPill status={p.value} /> },
    { headerName: 'Actions', colId: 'actions', flex: 2, minWidth: 440, sortable: false, filter: false, cellRenderer: (p: { data?: SellerDeal }) => {
      const x = p.data; if (!x) return null;
      return actions(x, false);
    } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sellerKey]);

  if (!deals.length) return <div className="text-sm text-mute">No deals yet. Negotiate one in the shop.</div>;
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <label className="sr" htmlFor="dealFilter">Filter deals</label>
        <input id="dealFilter" type="search" value={filter} onChange={(e) => { setFilter(e.target.value); ref.current?.api.setGridOption('quickFilterText', e.target.value); }}
          placeholder="Filter deals (product, status)..." className="min-h-11 w-full max-w-[340px] rounded-xl border border-line bg-card px-3 py-2.5" />
        <Button variant="ghost" onClick={() => ref.current?.api.exportDataAsCsv({ fileName: 'haggle-deals.csv', columnKeys: ['totalCents', 'floorTotalCents', 'status'] })}>
          <Download size={16} aria-hidden /> Export CSV
        </Button>
      </div>
      <TranscriptDialog deal={viewing} onClose={() => setViewing(null)} />
      {invoicing && (
        <form className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-card p-3" aria-label="Send a PayPal invoice"
          onSubmit={(e) => { e.preventDefault(); void sendInvoice(); }}>
          <div className="min-w-[240px] flex-1">
            <label htmlFor="invEmail" className="block text-[13px] font-bold">Buyer's email for the {usd(invoicing.totalCents)} PayPal invoice ({invoicing.productName})</label>
            <input id="invEmail" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="buyer@example.com"
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-card px-3 py-2.5" />
            <div className="mt-1 text-xs text-mute">In the sandbox no email is delivered: use the invoice link shown in this table.</div>
          </div>
          <Button type="submit">Send invoice</Button>
          <Button type="button" variant="ghost" onClick={() => setInvoicing(null)}>Cancel</Button>
        </form>
      )}
      {narrow ? (
        <ul id="dealsList" aria-label="Deals" className="m-0 grid list-none gap-2.5 p-0">
          {deals.filter((d) => !filter || `${d.productName} ${d.status}`.toLowerCase().includes(filter.toLowerCase())).map((d) => (
            <li key={d.id} className="rounded-xl border border-line bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="font-semibold">{d.productName}{d.qty > 1 ? ` x${d.qty}` : ''}</div>
                  <div className="text-sm text-mute"><span className="num font-bold text-ink">{usd(d.totalCents)}</span> · list {usd(d.listTotalCents)} · {d.source === 'buy_now' ? 'Bought' : 'Haggled'}</div></div>
                <StatusPill status={d.status} />
              </div>
              <div className="mt-2.5">{actions(d, true)}</div>
            </li>
          ))}
        </ul>
      ) : (
      <div id="dealsGrid" className="min-w-0">
        <AgGridReact<SellerDeal> ref={ref} theme={gridTheme} rowData={deals} columnDefs={cols} getRowId={(p) => p.data.id} domLayout="autoHeight"
          rowHeight={64} headerHeight={42} pagination paginationPageSize={8} paginationPageSizeSelector={false} suppressCellFocus
          defaultColDef={{ sortable: true, filter: true, resizable: true, cellStyle: { display: 'flex', alignItems: 'center' } }} />
      </div>
      )}
    </>
  );
}
