import { randomInt } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { config } from '../config';
import { otpRepo } from '../db/repositories/ops';
import { usersRepo } from '../db/repositories/users';
import { DAY_MS } from '../db/schema';
import { hashCode, safeEqual, signUserToken } from '../lib/auth';
import { handle, HttpError, parseBody } from '../lib/http';
import { logger } from '../lib/logger';
import { todayIst } from '../services/daily';
import { publicUser } from '../services/entitlement';
import { sendOtpSms, SmsDelayedError } from '../services/sms';

const CODE_TTL_MS = 5 * 60_000;
const RESEND_AFTER_MS = 25_000;
const MAX_ATTEMPTS = 5;

const phoneSchema = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.');

/**
 * Chooses the code:
 *  - test numbers (OTP_TEST_NUMBERS): fixed code, no SMS (Play Store review / QA)
 *  - "dummy" mode: fixed DUMMY_OTP, shown in the app (local / staging without SMS)
 *  - "sms" mode: random 6-digit code sent with VoiceNSMS, never returned to the app
 */
const chooseCode = (phone: string): { code: string; sendSms: boolean; showInApp: boolean } => {
  const testCode = config.otpTestNumbers.get(phone);
  if (testCode) return { code: testCode, sendSms: false, showInApp: false };
  if (config.otpMode === 'dummy') return { code: config.dummyOtp, sendSms: false, showInApp: true };
  return { code: String(randomInt(0, 1_000_000)).padStart(6, '0'), sendSms: true, showInApp: false };
};

export const authRouter = Router();

authRouter.post(
  '/otp/request',
  handle(async (req, res) => {
    const { phone } = parseBody(z.object({ phone: phoneSchema }), req.body);
    const now = Date.now();
    const today = todayIst();
    const { code, sendSms, showInApp } = chooseCode(phone);

    // Checks and stores the code in one transaction, BEFORE sending: two quick taps cannot both send,
    // and a slow SMS that arrives late still matches the stored code.
    let sentToday = 0;
    const previous = await otpRepo.issue(phone, (existing) => {
      if (existing && now - existing.lastSentAt < RESEND_AFTER_MS) {
        throw new HttpError(429, 'Please wait a few seconds before requesting another code.', 'too_soon');
      }
      sentToday = existing?.sendDay === today ? existing.sendCount : 0;
      if (sentToday >= config.otpDailyLimit) {
        throw new HttpError(429, 'Too many codes requested for this number today. Please try again tomorrow.', 'otp_daily_limit');
      }
      return {
        codeHash: hashCode(phone, code),
        attempts: 0,
        lastSentAt: now,
        codeExpiresAt: now + CODE_TTL_MS,
        sendCount: sentToday + 1,
        sendDay: today,
        expireAt: now + DAY_MS,
      };
    });

    let delayed = false;
    if (sendSms) {
      try {
        await sendOtpSms(phone, code);
      } catch (error) {
        if (!(error instanceof SmsDelayedError)) {
          // Definitely not sent: restore the previous state so the user can retry right away.
          await otpRepo.rollback(phone, previous).catch((e: unknown) => logger.warn('OTP rollback failed', { error: e }));
          throw error;
        }
        // The provider is slow: the code stays valid and the SMS may still arrive; the user can resend.
        delayed = true;
      }
    }
    logger.info('Login code issued', { mode: config.otpMode, phoneLast4: phone.slice(-4), sentToday: sentToday + 1, delayed });

    res.json({ sent: true, ...(delayed ? { delayed: true } : {}), ...(showInApp ? { devCode: code } : {}) });
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
    if (!otp || !otp.codeHash || otp.codeExpiresAt < Date.now()) {
      throw new HttpError(400, 'This code has expired. Please request a new one.', 'otp_expired');
    }
    if (otp.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many attempts. Please request a new code.', 'otp_locked');

    if (!safeEqual(otp.codeHash, hashCode(phone, code))) {
      await otpRepo.recordFailedAttempt(phone, otp.attempts + 1);
      throw new HttpError(400, 'That code is not right. Please check and try again.', 'otp_invalid');
    }
    // Burn the code (one-time use) but keep the daily send counter.
    await otpRepo.consume(phone);

    // The phone's current account (a deleted account is never reopened — the number starts fresh).
    const { userId, user } = await usersRepo.resolveOnLogin(phone);
    res.json({ token: signUserToken(userId, phone), user: publicUser(userId, user) });
  }),
);
