import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrf } from './api';
import type { Me } from './types';
import { setDisplayTimezone } from './utils';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  can: (cap: string, accountId?: string, level?: 'read' | 'send' | 'manage') => boolean;
  refresh: () => Promise<unknown>;
}
const Ctx = createContext<AuthCtx>({ me: null, loading: true, can: () => false, refresh: async () => {} });
const RANK = { read: 1, send: 2, manage: 3 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const me = q.data ?? null;
  useEffect(() => {
    setCsrf(me?.csrf_token);
    setDisplayTimezone(me?.timezone);
  }, [me]);
  useEffect(() => {
    const h = () => qc.setQueryData(['me'], null);
    window.addEventListener('ttw:unauthorized', h);
    return () => window.removeEventListener('ttw:unauthorized', h);
  }, [qc]);

  const can = (cap: string, accountId?: string, level: 'read' | 'send' | 'manage' = 'read') => {
    if (!me) return false;
    if (me.is_super_admin) return true;
    if (!me.capabilities.includes(cap)) return false;
    if (!accountId || me.account_access === 'all') return true;
    const l = me.account_access[accountId];
    return !!l && RANK[l] >= RANK[level];
  };
  return <Ctx.Provider value={{ me, loading: q.isLoading, can, refresh: () => q.refetch() }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
