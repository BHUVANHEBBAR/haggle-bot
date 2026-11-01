import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Health } from '../api/types';

// /api/health reports the configured AI and the outcome of the last real AI call.
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/api/health'), refetchInterval: 15_000 });
