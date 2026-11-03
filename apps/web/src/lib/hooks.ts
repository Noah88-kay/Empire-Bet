import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type User, type WalletDto } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000
  });
}

export function useWallet(enabled: boolean) {
  return useQuery({
    queryKey: ['wallet'],
    queryFn: () => api<WalletDto>('/wallet'),
    enabled,
    refetchInterval: 20_000
  });
}
