import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { PublicDeal } from '../../api/types';
import { usd } from '../../lib/utils';

export interface Stats {
  dealsPaid: number; dealsAgreed: number; revenueCents: number; avgDiscountPct: number; marginPct: number;
  belowFloorRefused: number; priceClamped: number; injectionsBlocked: number; estMinutesSaved: number; closedCount: number;
}
export interface TrailStep { ts: string; step: string; orderId?: string; captureId?: string; authorizationId?: string; refundId?: string; debugId?: string | null; eventId?: string; eventType?: string; verified?: boolean; invoiceId?: string | null; invoiceStatus?: string | null; carrier?: string; trackingNumber?: string; sentToPayPal?: boolean; disputeId?: string | null; disputeStatus?: string | null; reason?: string | null; by?: string; source?: string; totalCents?: number; issue?: string; result?: string; paypalStatus?: string | null; attempt?: number; intent?: string }
export interface SellerDeal extends PublicDeal { floorTotalCents: number; costTotalCents: number; createdAt: string; captureId: string | null; authorizationId?: string | null; paypalOrderId?: string | null; invoiceId?: string | null; invoiceEmail?: string | null; physical?: boolean; shipmentOnPayPal?: boolean | null; trail: TrailStep[]; messages: number; transcript: { role: 'seller' | 'buyer'; text: string }[] }
export interface SellerProduct {
  id: string; name: string; emoji: string; listCents: number; costCents: number; minMarginPct: number; maxDiscountPct: number;
  stock: number; floorCents: number; persona?: string; lowStockThreshold: number; lowStockMaxDiscountPct: number; bulkQty: number; bulkExtraDiscountPct: number;
}
export interface SellerEvent { id: string; ts: string; type: string; [k: string]: unknown }
export interface Dashboard { stats: Stats; mode: { ai: string; paypal: string }; products: SellerProduct[]; deals: SellerDeal[]; events: SellerEvent[] }
export interface EvalReport {
  generatedAt: string; negotiations: number; turns: number; dealsClosed: number; violationCount: number; passed: boolean;
  interventions: { priceClamped: number; messageReplaced: number; injectionBlocked: number; belowFloorRefused: number };
}

// The seller signs in once; the server sets an HttpOnly session cookie, so no key is kept in the page.
// Components still receive a "sellerKey" prop; SESSION means "use the cookie" (a real key would go in the old header).
export const SESSION = 'session';
export const headers = (key: string): Record<string, string> => (key && key !== SESSION ? { 'x-seller-key': key } : {});

// Refreshes every 8 s, but not while the seller is typing in a field.
export const useDashboard = (key: string) => useQuery({
  queryKey: ['dashboard', key],
  queryFn: () => api<Dashboard>('/api/seller/dashboard', { headers: headers(key) }),
  enabled: !!key,
  retry: false,
  refetchInterval: () => (document.activeElement?.tagName === 'INPUT' ? false : 8000),
});

export function describeEvent(e: SellerEvent): string {
  const s = (k: string) => String(e[k] ?? '');
  const n = (k: string) => Number(e[k] ?? 0);
  const m: Record<string, () => string> = {
    injection_blocked: () => `Manipulation attempt ignored: "${s('text')}"`,
    below_floor_refused: () => `Offer of ${usd(n('offer'))} refused (below your limit)`,
    price_clamped: () => `AI proposed ${usd(n('aiProposed'))}; guardrail used ${usd(n('used'))}`,
    payment_ok: () => `Payment OK (${s('status')}) for deal ${s('dealId')}`,
    payment_declined: () => `Payment declined (${s('issue')}) for deal ${s('dealId')}. PayPal debug id: ${s('debugId') || 'n/a'}`,
    webhook_processed: () => `Webhook verified and applied: ${s('eventType')}`,
    webhook_duplicate: () => `Duplicate webhook ignored: ${s('eventType')}`,
    webhook_rejected: () => 'Webhook rejected: signature check failed',
    seller_captured: () => `You captured the held payment for deal ${s('dealId')}`,
    seller_voided: () => `You released the payment hold for deal ${s('dealId')}`,
    seller_refunded: () => `You refunded deal ${s('dealId')}`,
    paypal_error: () => `PayPal error in ${s('op')}: ${s('issue')} (debug id ${s('debugId') || 'n/a'})`,
    rules_changed: () => `Rules changed for ${s('productId')}`,
    deal_agreed: () => `New deal agreed: ${s('productName')} for ${usd(n('totalCents'))}`,
    copilot_proposed: () => `Copilot proposed "${s('action').replace(/_/g, ' ')}" for deal ${s('dealId')}${e.tainted ? ' (after reading buyer text)' : ''}. Waiting for your confirmation.`,
    copilot_confirmed: () => `You confirmed "${s('action').replace(/_/g, ' ')}" for deal ${s('dealId')}; PayPal executed it`,
    reconciled: () => `Checked ${n('checked')} payments against PayPal: ${n('matched')} match, ${n('mismatched')} mismatch, ${n('missing')} missing`,
  };
  return (m[e.type] || (() => e.type))();
}
