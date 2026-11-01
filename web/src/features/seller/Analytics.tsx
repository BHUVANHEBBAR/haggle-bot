import { useQuery } from '@tanstack/react-query';
import { AgCharts } from 'ag-charts-react';
import type { AgChartOptions } from 'ag-charts-community';
import { api } from '../../api/client';
import { Card } from '../../components/ui';
import { useChartTheme } from '../../lib/ag';
import { headers } from './api';

interface Analytics {
  funnel: { chats: number; offered: number; agreed: number; paid: number };
  buyNow: { deals: number; paid: number };
  offersPerChat: number;
  avgMessagesToClose: number;
  revenueByDay: { date: string; cents: number }[];
  byPersona?: { key: string; label: string; emoji: string; deals: number; paid: number; avgDiscountPct: number }[];
}

// Buyer funnel (chats > offers > deals agreed > paid) and revenue per day.
export default function AnalyticsCards({ sellerKey }: { sellerKey: string }) {
  const theme = useChartTheme();
  const { data } = useQuery({
    queryKey: ['analytics', sellerKey],
    queryFn: () => api<Analytics>('/api/seller/analytics', { headers: headers(sellerKey) }),
    refetchInterval: 8000,
  });
  if (!data) return null;
  const f = data.funnel;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');
  const common = { background: { visible: false }, theme, height: 240, legend: { enabled: false } } as const;
  const funnel = {
    ...common,
    data: [{ step: 'Chats', n: f.chats }, { step: 'Made an offer', n: f.offered }, { step: 'Deals agreed', n: f.agreed }, { step: 'Paid', n: f.paid }],
    series: [{ type: 'bar', direction: 'horizontal', xKey: 'step', yKey: 'n', yName: 'Count', fill: '#2563eb' }],
  } as AgChartOptions;
  const revenue = {
    ...common,
    data: data.revenueByDay.map((d) => ({ day: d.date.slice(5), revenue: d.cents / 100 })),
    series: [{ type: 'bar', xKey: 'day', yKey: 'revenue', yName: 'Revenue ($)', fill: '#15803d' }],
    axes: { x: { type: 'category', position: 'bottom' }, y: { type: 'number', position: 'left', label: { formatter: (p: { value: number }) => `$${p.value}` } } },
  } as AgChartOptions;

  return (
    <div id="analytics" className="mb-1.5 mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
      <Card>
        <strong>Buyer funnel</strong>
        <div className="text-[13px] text-mute">{pct(f.offered, f.chats)} of chats make an offer, {pct(f.agreed, f.offered)} of those end in a deal, {pct(f.paid, f.agreed)} of deals are paid. About {data.offersPerChat} offers per chat and {data.avgMessagesToClose} messages to close. {data.buyNow.deals} buyers skipped haggling and bought at list price ({data.buyNow.paid} paid).</div>
        <div className="min-w-0 overflow-hidden"><AgCharts options={funnel} /></div>
      </Card>
      {data.byPersona && data.byPersona.some((r) => r.deals > 0) && (
        <Card>
          <strong>Haggler personalities</strong>
          <div className="mb-2 text-[13px] text-mute">Haggled deals by the personality that closed them. A bigger average discount means more revenue given up.</div>
          <table className="w-full border-collapse text-sm"><thead><tr className="text-left text-mute"><th className="py-1 font-semibold">Personality</th><th className="py-1 font-semibold">Deals</th><th className="py-1 font-semibold">Paid</th><th className="py-1 font-semibold">Avg discount</th></tr></thead>
            <tbody>{data.byPersona.filter((r) => r.deals > 0).map((r) => <tr key={r.key} className="border-t border-line"><td className="py-1.5"><span aria-hidden>{r.emoji}</span> {r.label}</td><td className="num">{r.deals}</td><td className="num">{r.paid}</td><td className="num">{r.avgDiscountPct}%</td></tr>)}</tbody></table>
        </Card>
      )}
      <Card>
        <strong>Revenue by day</strong>
        <div className="text-[13px] text-mute">Paid and held payments, last 14 days with sales.</div>
        <div className="min-w-0 overflow-hidden">{data.revenueByDay.length ? <AgCharts options={revenue} /> : <div className="grid h-[200px] place-items-center text-sm text-mute">No paid deals yet.</div>}</div>
      </Card>
    </div>
  );
}
