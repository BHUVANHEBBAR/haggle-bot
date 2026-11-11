// Shapes of the JSON the Node server returns. Prices are integer cents; the browser never computes a price.
export interface Product {
  id: string; name: string; emoji: string; description: string; listCents: number;
  inStock: boolean; reserved?: boolean; stock?: number; payMode: 'full' | 'authorize'; physical: boolean; bulkQty?: number;
  highlights: string[]; shipping: string; returns: string;
  haggler?: { key: string; label: string; emoji: string }; // who the buyer is chatting with (never the pacing)
}
// a closed or open negotiation restored after a refresh
export interface HistoryItem { role: 'seller' | 'buyer'; text: string; meta: { action?: string; guard?: Guard } | null }
export interface SessionState {
  sessionId: string; status: 'open' | 'agreed' | 'ended'; qty: number; round: number; askCents: number; product: Product;
  history: HistoryItem[]; deal: DealRef | null;
}
export interface Guard {
  clamped: boolean; injection: boolean; belowFloor: boolean; messageReplaced: boolean; provider: string; fellBack: boolean;
  offTopic?: 'code' | 'abuse' | 'gibberish' | 'off_topic' | 'foreign' | 'empty'; // set when code refused the message: it never reached the AI
}
export interface DealRef { id: string; unitCents: number; totalCents: number; expiresAt: string; qty: number }
export interface ChatStart { sessionId: string; message: string; product: Product; qty: number }
export interface ChatReply {
  message: string; action: 'chat' | 'counter' | 'accept' | 'walk_away'; priceCents: number; round: number;
  status: 'open' | 'agreed' | 'ended'; deal: DealRef | null; guard: Guard;
}
export type DealStatus = 'agreed' | 'order_created' | 'authorized' | 'captured' | 'refunded' | 'voided' | 'expired' | 'invoiced';
export interface PublicDeal {
  id: string; productId: string; source: 'negotiated' | 'buy_now'; productName: string; qty: number; unitCents: number; totalCents: number; listTotalCents: number;
  currency: string; status: DealStatus; payMode: 'full' | 'authorize'; expiresAt: string; lastError: string | null; pending?: boolean;
  invoice?: { status: string; url: string | null; number: string | null } | null;
  shipment?: { carrier: string; trackingNumber: string; at: string } | null;
}
export interface AiStatus { provider: string; fellBack: boolean; error: string | null; model?: string | null; paused?: string[]; at: string }
export interface Health { ok: boolean; ai: string; aiStatus: AiStatus | null; paypal: 'sandbox' | 'simulated'; sellerKeyIsDefault: boolean }
