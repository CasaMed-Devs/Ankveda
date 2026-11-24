import { Timestamp, type DocumentData, type FirestoreDataConverter } from 'firebase-admin/firestore';

/**
 * Instants are epoch ms in code and Firestore Timestamps in the database.
 * Convention: any key ending in At / Start / End / Until holds an instant.
 */
const INSTANT_KEY = /(At|Start|End|Until)$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Timestamp) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** Code → Firestore: ms numbers on instant keys become Timestamps (recursively). */
export const toStored = (value: unknown, key = ''): unknown => {
  if (INSTANT_KEY.test(key) && typeof value === 'number') return Timestamp.fromMillis(value);
  if (Array.isArray(value)) return value.map((v) => toStored(v));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toStored(v, k)]));
  }
  return value;
};

/** Firestore → code: Timestamps become ms numbers (recursively). */
export const fromStored = (value: unknown): unknown => {
  if (value instanceof Timestamp) return value.toMillis();
  if (Array.isArray(value)) return value.map(fromStored);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fromStored(v)]));
  }
  return value;
};

/**
 * Typed converter. Note: Firestore's update() bypasses converters, so repositories
 * only write through set() / set(…, { merge: true }) / create().
 */
export const converter = <T extends object>(): FirestoreDataConverter<T, DocumentData> => ({
  toFirestore: (model) => toStored(model) as DocumentData,
  fromFirestore: (snapshot) => fromStored(snapshot.data()) as T,
});

export const DAY_MS = 86_400_000;
