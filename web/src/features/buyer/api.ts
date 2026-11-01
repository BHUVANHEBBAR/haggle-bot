import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { PublicDeal } from '../../api/types';

export interface BuyerState { signedIn: boolean; email?: string }
export type Order = PublicDeal & { createdAt: string };

// Who is signed in as a buyer. The session lives in an HttpOnly cookie, so the page only asks the server.
export const useBuyer = () => useQuery({ queryKey: ['buyer'], queryFn: () => api<BuyerState>('/api/buyer/me'), staleTime: 60_000 });

export const startSignIn = (email: string) => api<{ sent: boolean; demoCode?: string }>('/api/buyer/login/start', { method: 'POST', body: { email } });
export const verifySignIn = (email: string, code: string) => api<{ ok: boolean; email: string }>('/api/buyer/login/verify', { method: 'POST', body: { email, code } });

export const useOrders = (enabled: boolean) => useQuery({ queryKey: ['orders'], enabled, queryFn: () => api<{ email: string; orders: Order[] }>('/api/buyer/orders') });

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await api('/api/buyer/logout', { method: 'POST' }).catch(() => undefined);
    qc.setQueryData<BuyerState>(['buyer'], { signedIn: false });
    qc.removeQueries({ queryKey: ['orders'] });
  };
}
