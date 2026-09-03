'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { getMe, logout as apiLogout } from '@/lib/api';
import type { User } from '@/lib/types';

// ──────────────────────────────────────────────────────────────────────────────
// Auth Context — provides the current user to the entire app
// ──────────────────────────────────────────────────────────────────────────────

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: User };

type AuthContextValue = AuthState & {
  refetch: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const fetchUser = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const user = await getMe();
      setState({ status: 'authenticated', user });
    } catch {
      setState({ status: 'unauthenticated' });
    }
  }, []);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  const handleLogout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setState({ status: 'unauthenticated' });
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, refetch: fetchUser, logout: handleLogout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
