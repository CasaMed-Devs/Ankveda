import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from './logger';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Wraps async route handlers so thrown errors reach the error middleware. */
export const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export const parseBody = <T>(schema: ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, first?.message ?? 'Invalid request', 'validation');
  }
  return result.data;
};

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid request', code: 'validation' });
    return;
  }
  logger.error('Unhandled API error', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.', code: 'internal' });
};
