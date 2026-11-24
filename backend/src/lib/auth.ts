import { createHash, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { config } from '../config';
import { HttpError } from './http';

type UserClaims = { sub: string; phone: string; role: 'user' };
type AdminClaims = { sub: 'admin'; role: 'admin' };

declare module 'express-serve-static-core' {
  interface Request {
    uid?: string;
  }
}

/** Stable user id derived from the phone number (no lookup query needed). */
export const uidForPhone = (phone: string) => `u_${createHash('sha256').update(`+91${phone}`).digest('hex').slice(0, 24)}`;

export const signUserToken = (uid: string, phone: string) =>
  jwt.sign({ sub: uid, phone, role: 'user' } satisfies UserClaims, config.jwtSecret, { expiresIn: '30d' });

export const signAdminToken = () =>
  jwt.sign({ sub: 'admin', role: 'admin' } satisfies AdminClaims, config.jwtSecret, { expiresIn: '12h' });

const bearer = (req: Request) => {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

const verify = (token: string) => {
  try {
    return jwt.verify(token, config.jwtSecret) as UserClaims | AdminClaims;
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

export const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
  const token = bearer(req);
  if (!token) return next(new HttpError(401, 'Admin login required', 'unauthorized'));
  try {
    const claims = verify(token);
    if (claims.role !== 'admin') throw new HttpError(403, 'Admin only', 'forbidden');
    next();
  } catch (e) {
    next(e);
  }
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
