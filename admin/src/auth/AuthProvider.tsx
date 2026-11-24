import { onIdTokenChanged, signInWithEmailAndPassword, signOut as fbSignOut, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api } from '@/lib/api';
import { auth, persistenceReady } from '@/lib/firebase';
import { queryClient } from '@/lib/queries';

/**
 * The admin claim is read from the ID token only to choose what to render. It is NOT the security
 * boundary — the backend verifies the token and the claim on every request.
 */
type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'forbidden'; user: User }
  | { status: 'admin'; user: User };

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const friendly = (code: string) => {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes or reset the password.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/network-request-failed':
      return 'Network error — check your connection.';
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return 'Email sign-in is not enabled for this Firebase project yet.';
    default:
      return 'Could not sign in. Please try again.';
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let unsub = () => {};
    void persistenceReady.finally(() => {
      unsub = onIdTokenChanged(auth, async (user) => {
        if (!user) {
          queryClient.clear();
          setState({ status: 'signedOut' });
          return;
        }
        const token = await user.getIdTokenResult();
        setState(token.claims.admin === true ? { status: 'admin', user } : { status: 'forbidden', user });
      });
    });
    return () => unsub();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const token = await cred.user.getIdTokenResult();
      // Server-side login audit (also proves the backend accepts this admin).
      if (token.claims.admin === true) await api('POST', '/admin/session').catch(() => undefined);
    } catch (error) {
      throw new Error(friendly((error as { code?: string }).code ?? ''));
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    queryClient.clear();
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
