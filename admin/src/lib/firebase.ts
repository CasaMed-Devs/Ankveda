import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from 'firebase/auth';

import firebaseConfig from './firebase-config.json';

/**
 * Firebase Auth is used only to sign admins in. The dashboard never talks to Firestore directly —
 * every read and write goes through the backend, which verifies the ID token and the `admin` claim.
 * Web config values are public identifiers, not secrets (written by backend/scripts/provision-admin.mjs).
 */
export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

const emulator = import.meta.env.VITE_AUTH_EMULATOR as string | undefined;
if (emulator) connectAuthEmulator(auth, emulator, { disableWarnings: true });

// Session persistence: stay signed in across reloads and browser restarts until "Sign out".
export const persistenceReady = setPersistence(auth, browserLocalPersistence);
