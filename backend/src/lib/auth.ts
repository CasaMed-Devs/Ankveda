import { createHash, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import jwt from 'jsonwebtoken';

import { config } from '../config';
import { firebaseApp } from '../db/firestore';
import type { AdminActor } from '../types';
import { HttpError } from './http';
import { logger } from './logger';

type UserClaims = { sub: string; phone: string; role: 'user' };

declare module 'express-serve-static-core' {
  interface Request {
    uid?: string;
    /** Set by requireAdmin: the signed-in Firebase Auth admin. */
    admin?: AdminActor & { authTime: number };
  }
}

/** Stable user id derived from the phone number (no lookup query needed). */
export const uidForPhone = (phone: string) => `u_${createHash('sha256').update(`+91${phone}`).digest('hex').slice(0, 24)}`;

export const signUserToken = (uid: string, phone: string) =>
  jwt.sign({ sub: uid, phone, role: 'user' } satisfies UserClaims, config.jwtSecret, { expiresIn: '30d' });

const bearer = (req: Request) => {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

const verify = (token: string) => {
  try {
    return jwt.verify(token, config.jwtSecret) as UserClaims;
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.', 'unauthorized');
  }
};

export const requireUser = (req: Request, _res: Response, next: NextFunction) => {
  const token = bearer(req);
  if (!token) return next(new HttpError(401, 'Please sign in to continue.', 'unauthorized'));
  try {
    const claims = verify(token);
    if (claims.role !== 'user') throw new HttpError(403, 'Not allowed', 'forbidden');
    req.uid = claims.sub;
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * Admin dashboard requests carry a Firebase Auth ID token (admin signs in with email + password).
 * The token is verified with the Admin SDK — signature, expiry and revocation — and must carry the
 * custom claim { admin: true }, which only backend/scripts/provision-admin.mjs can set.
 * Client-side checks never authorise anything.
 */
export const requireAdmin = async (req: Request, _res: Response, next: NextFunction) => {
  const token = bearer(req);
  if (!token) return next(new HttpError(401, 'Please sign in to the admin dashboard.', 'unauthorized'));
  try {
    const decoded = await getAuth(firebaseApp).verifyIdToken(token, true);
    if (decoded.admin !== true) {
      return next(new HttpError(403, 'This account does not have admin access.', 'forbidden'));
    }
    req.admin = { uid: decoded.uid, email: decoded.email ?? null, authTime: decoded.auth_time * 1000 };
    next();
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    // Only problems with the token itself sign the admin out (the dashboard signs out on 401).
    // Anything else (e.g. the server cannot reach Firebase Auth) is a server fault, not an expired session.
    if (TOKEN_ERRORS.has(code)) {
      const message = code === 'auth/id-token-revoked' || code === 'auth/user-disabled'
        ? 'Your admin session was revoked. Please sign in again.'
        : 'Your admin session has expired. Please sign in again.';
      return next(new HttpError(401, message, 'unauthorized'));
    }
    logger.error('Admin token verification failed (server side)', { code, error });
    next(new HttpError(503, 'The server could not verify your session right now. Please try again shortly.', 'auth_unavailable'));
  }
};

const TOKEN_ERRORS = new Set([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/argument-error',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

/** The admin performing the request (for audit logs and grantedBy fields). */
export const actorOf = (req: Request): AdminActor => {
  if (!req.admin) throw new HttpError(401, 'Admin login required', 'unauthorized');
  return { uid: req.admin.uid, email: req.admin.email };
};

export const uidOf = (req: Request) => {
  if (!req.uid) throw new HttpError(401, 'Please sign in to continue.', 'unauthorized');
  return req.uid;
};

export const hashCode = (phone: string, code: string) =>
  createHash('sha256').update(`${config.jwtSecret}:${phone}:${code}`).digest('hex');

export const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};
