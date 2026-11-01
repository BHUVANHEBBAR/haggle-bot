import { useMemo } from 'react';
import { AgCharts } from 'ag-charts-react';
import type { AgChartOptions } from 'ag-charts-community';
import { Card } from '../../components/ui';
import { useChartTheme } from '../../lib/ag';
import type { SellerDeal } from './api';

const STATUS_COLORS: Record<string, string> = {
  agreed: '#2563eb', order_created: '#2563eb', authorized: '#d97706', captured: '#15803d', refunded: '#7c3aed', voided: '#64748b', invoiced: '#b45309', expired: '#94a3b8',
};

// Deal status mix and average discount per product (AG Charts Community).
export default function Charts({ deals }: { deals: SellerDeal[] }) {
  const theme = useChartTheme();
  const { status, discount } = useMemo(() => {
    const by: Record<string, number> = {};
    const prod: Record<string, number[]> = {};
    for (const x of deals) {
      by[x.status] = (by[x.status] || 0) + 1;
      if (x.listTotalCents) (prod[x.productName] ||= []).push((1 - x.totalCents / x.listTotalCents) * 100);
    }
    return {
      status: Object.entries(by).map(([name, count]) => ({ status: name, count })),
      discount: Object.entries(prod).map(([name, v]) => ({ product: name.split(' ').slice(0, 2).join(' '), discount: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 })),
    };
  }, [deals]);

  const common = { background: { visible: false }, theme, height: 240 } as const;
  const donut: AgChartOptions = {
    ...common, data: status, legend: { position: 'bottom' },
    series: [{ type: 'donut', calloutLabelKey: 'status', angleKey: 'count', innerRadiusRatio: 0.6, itemStyler: (p: { datum: { status: string } }) => ({ fill: STATUS_COLORS[p.datum.status] || '#64748b' }) }],
  } as AgChartOptions;
  const bars: AgChartOptions = {
    ...common, data: discount, legend: { enabled: false },
    series: [{ type: 'bar', xKey: 'product', yKey: 'discount', yName: 'Average discount %', fill: '#2563eb' }],
    axes: { x: { type: 'category', position: 'bottom' }, y: { type: 'number', position: 'left', title: { text: '% off list' } } },
  } as AgChartOptions;

  return (
    <div className="mb-1.5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
      <Card><strong>Deal status</strong><div id="chartStatus" className="min-h-60 min-w-0 overflow-hidden"><AgCharts options={donut} /></div></Card>
      <Card><strong>Average discount by product</strong><div id="chartDiscount" className="min-h-60 min-w-0 overflow-hidden"><AgCharts options={bars} /></div></Card>
    </div>
  );
}
