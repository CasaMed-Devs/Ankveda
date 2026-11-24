import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { User } from '@/lib/types';

const TOKEN_KEY = 'ankveda.token';
const INTRO_KEY = 'ankveda.introSeen';

type AuthState = {
  hydrated: boolean;
  token: string | null;
  user: User | null;
  introSeen: boolean;
  hydrate: () => Promise<void>;
  setSession: (token: string, user: User) => Promise<void>;
  setUser: (user: User) => void;
  markIntroSeen: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  hydrated: false,
  token: null,
  user: null,
  introSeen: false,

  hydrate: async () => {
    const [token, introSeen] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
      SecureStore.getItemAsync(INTRO_KEY).catch(() => null),
    ]);
    set({ token, introSeen: introSeen === '1', hydrated: true });
  },

  setSession: async (token, user) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    set({ token, user });
  },

  setUser: (user) => set({ user }),

  markIntroSeen: async () => {
    await SecureStore.setItemAsync(INTRO_KEY, '1').catch(() => undefined);
    set({ introSeen: true });
  },

  signOut: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    set({ token: null, user: null });
  },
}));
