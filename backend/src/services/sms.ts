import { config } from '../config';
import { HttpError } from '../lib/http';
import { logger } from '../lib/logger';

/**
 * VoiceNSMS (voicensms.in) — DLT-registered transactional SMS for login codes.
 *
 * Their HTTP API is configured as a URL template copied from the VoiceNSMS dashboard
 * (Developer / API section), with values replaced by placeholders:
 *   VOICENSMS_SEND_URL=https://<host>/<path>?<key-param>={apiKey}&<sender-param>={senderId}
 *                      &<template-param>={templateId}&<number-param>={mobile}&<text-param>={message}
 * Placeholders: {apiKey} {senderId} {templateId} {mobile} (10 digits) {mobile91} (91 + 10 digits) {message}
 *
 * The SMS text must match the DLT-approved template exactly; VOICENSMS_MESSAGE holds it with {otp}.
 */

const TIMEOUT_MS = 15_000;

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? encodeURIComponent(values[key]) : match));

/** Never log the API key or the code itself. */
const redact = (text: string, secrets: string[]) => secrets.reduce((t, s) => (s ? t.split(s).join('***') : t), text);

export const smsConfigured = () => !!config.voicensms;

export const sendOtpSms = async (phone: string, otp: string) => {
  const sms = config.voicensms;
  if (!sms) throw new HttpError(503, 'SMS login is not configured yet.', 'sms_unconfigured');

  const message = sms.messageTemplate.replace('{otp}', otp);
  const url = fill(sms.sendUrl, {
    apiKey: sms.apiKey,
    senderId: sms.senderId,
    templateId: sms.templateId,
    mobile: phone,
    mobile91: `91${phone}`,
    message,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let status = 0;
  let body = '';
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    status = response.status;
    body = (await response.text()).slice(0, 500);
  } catch (error) {
    logger.error('VoiceNSMS request failed', { error: redact(String(error), [sms.apiKey, otp]) });
    throw new HttpError(502, 'We could not send the code right now. Please try again in a minute.', 'sms_failed');
  } finally {
    clearTimeout(timer);
  }

  const failed = status < 200 || status >= 300 || sms.failurePattern.test(body) || (sms.successPattern ? !sms.successPattern.test(body) : false);
  const safeBody = redact(body, [sms.apiKey, otp]);
  if (failed) {
    logger.error('VoiceNSMS rejected the message', { status, body: safeBody, phoneLast4: phone.slice(-4) });
    throw new HttpError(502, 'We could not send the code right now. Please try again in a minute.', 'sms_failed');
  }
  logger.info('Login code sent', { provider: 'voicensms', phoneLast4: phone.slice(-4), response: safeBody.slice(0, 120) });
};
