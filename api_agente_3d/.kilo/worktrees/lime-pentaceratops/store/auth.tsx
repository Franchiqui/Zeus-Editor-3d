'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  verified: boolean;
  created: string;
  updated: string;
}

interface AuthState {
  user: UserRecord | null;
  isAuthenticated: boolean;
  token: string | null;
  setUser: (user: UserRecord) => void;
  setToken: (token: string) => void;
  clearUser: () => void;
  updateUser: (updates: Partial<UserRecord>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      token: null,

      setUser: (user: UserRecord) =>
        set({
          user,
          isAuthenticated: true,
        }),

      setToken: (token: string) =>
        set({
          token,
        }),

      clearUser: () =>
        set({
          user: null,
          isAuthenticated: false,
          token: null,
        }),

      updateUser: (updates: Partial<UserRecord>) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        token: state.token,
      }),
    }
  )
);
