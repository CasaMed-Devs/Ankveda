import { randomInt } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { config } from '../config';
import { otpRepo } from '../db/repositories/ops';
import { usersRepo } from '../db/repositories/users';
import { hashCode, safeEqual, signUserToken, uidForPhone } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { publicUser } from '../services/entitlement';

const OTP_TTL_MS = 5 * 60_000;
const RESEND_AFTER_MS = 25_000;
const MAX_ATTEMPTS = 5;

const phoneSchema = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.');

/**
 * Sends the code. In "dummy" mode the code is fixed (DUMMY_OTP) and returned to the app
 * so testers can sign in. Plug a real SMS provider (MSG91 / Twilio / Firebase) in here later.
 */
const deliverCode = async (_phone: string, _code: string) => {
  if (config.otpMode === 'dummy') return;
  throw new HttpError(501, 'SMS login is not configured yet.', 'sms_unconfigured');
};

export const authRouter = Router();

authRouter.post(
  '/otp/request',
  handle(async (req, res) => {
    const { phone } = parseBody(z.object({ phone: phoneSchema }), req.body);
    const existing = await otpRepo.get(phone);
    if (existing && Date.now() - existing.lastSentAt < RESEND_AFTER_MS) {
      throw new HttpError(429, 'Please wait a few seconds before requesting another code.', 'too_soon');
    }

    const dummy = config.otpMode === 'dummy';
    const code = dummy ? config.dummyOtp : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deliverCode(phone, code);
    const now = Date.now();
    await otpRepo.save(phone, { codeHash: hashCode(phone, code), attempts: 0, lastSentAt: now, expireAt: now + OTP_TTL_MS });

    res.json({ sent: true, ...(dummy ? { devCode: code } : {}) });
  }),
);

authRouter.post(
  '/otp/verify',
  handle(async (req, res) => {
    const { phone, code } = parseBody(
      z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }),
      req.body,
    );
    const otp = await otpRepo.get(phone);
    if (!otp || otp.expireAt < Date.now()) throw new HttpError(400, 'This code has expired. Please request a new one.', 'otp_expired');
    if (otp.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many attempts. Please request a new code.', 'otp_locked');

    if (!safeEqual(otp.codeHash, hashCode(phone, code))) {
      await otpRepo.recordFailedAttempt(phone, otp.attempts + 1);
      throw new HttpError(400, 'That code is not right. Please check and try again.', 'otp_invalid');
    }
    await otpRepo.remove(phone);

    const userId = uidForPhone(phone);
    const user = await usersRepo.upsertOnLogin(userId, phone);
    res.json({ token: signUserToken(userId, phone), user: publicUser(userId, user) });
  }),
);
