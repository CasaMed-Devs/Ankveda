/**
 * Firestore cursor pagination for admin lists.
 *
 * Every list orders by one field plus the document id (a stable tie-breaker), then continues with
 * startAfter(lastValue, lastId) and limit(pageSize + 1) — the extra document only tells us whether
 * there is a next page. Nothing is ever fetched to paginate on the client.
 *
 * The cursor sent to the browser is opaque base64url JSON { v, id }. Instants are carried as epoch ms
 * and turned back into Timestamps for the query (they are stored as Timestamps — see db/schema.ts).
 */
import { FieldPath, Timestamp, type Query } from 'firebase-admin/firestore';

import { HttpError } from '../../lib/http';

export const PAGE_SIZES = [20, 50, 100] as const;

type CursorValue = number | string | null;
type Cursor = { v: CursorValue; id: string };

export const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeCursor = (raw: string | undefined | null): Cursor | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.id !== 'string' || !['number', 'string', 'object'].includes(typeof parsed.v)) throw new Error('bad cursor');
    return parsed;
  } catch {
    throw new HttpError(400, 'Invalid page cursor. Go back to the first page.', 'bad_cursor');
  }
};

export const pageSizeOf = (raw: unknown) => {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : PAGE_SIZES[0];
};

export type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * Runs one page of `query` ordered by `field` (+ document id).
 * `instant` = the field holds a Timestamp (cursor values are ms in the browser).
 */
export const runPage = async <T>(
  query: Query<T>,
  opts: { field: string; direction: 'asc' | 'desc'; instant: boolean; pageSize: number; cursor: string | null | undefined },
): Promise<Page<T & { id: string }>> => {
  const cursor = decodeCursor(opts.cursor);
  let q = query.orderBy(opts.field, opts.direction).orderBy(FieldPath.documentId(), opts.direction);
  if (cursor) {
    const value = opts.instant && typeof cursor.v === 'number' ? Timestamp.fromMillis(cursor.v) : cursor.v;
    q = q.startAfter(value, cursor.id);
  }
  const snap = await q.limit(opts.pageSize + 1).get();
  const docs = snap.docs.slice(0, opts.pageSize);
  const items = docs.map((d) => ({ ...d.data(), id: d.id }));
  const last = docs[docs.length - 1];
  const nextCursor =
    snap.docs.length > opts.pageSize && last
      ? encodeCursor({ v: valueAt(last.data() as Record<string, unknown>, opts.field), id: last.id })
      : null;
  return { items, nextCursor };
};

/** Reads a dotted field path from converted data (instants are already ms). */
const valueAt = (data: Record<string, unknown>, path: string): CursorValue => {
  const value = path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), data);
  return typeof value === 'number' || typeof value === 'string' ? value : null;
};
