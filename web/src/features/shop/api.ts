import { api } from '../../api/client';
import type { ChatReply, DealRef, SessionState } from '../../api/types';

// Buying without haggling: the server sets the price (list price), the browser only names a product and a quantity.
export const buyNow = (productId: string, qty: number) => api<{ deal: DealRef & { listTotalCents: number; payMode: 'full' | 'authorize' } }>('/api/buy-now', { method: 'POST', body: { productId, qty } });
// Take the seller's current price (deterministic, no AI). Also works after the seller walked away.
export const buyAtCurrent = (sessionId: string) => api<ChatReply>('/api/chat/buy-at-current', { method: 'POST', body: { sessionId } });
export const getSession = (sessionId: string) => api<SessionState>(`/api/chat/session/${sessionId}`);

// Remember the open negotiation across a refresh (sessionStorage only: it is the buyer's own tab).
const KEY = 'haggle-chat';
export const rememberChat = (sessionId: string) => { try { sessionStorage.setItem(KEY, sessionId); } catch { /* storage may be blocked */ } };
export const recallChat = (): string | null => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
export const forgetChat = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };
