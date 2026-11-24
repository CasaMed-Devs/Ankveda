import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { sendOtpSms } from './sms';

const realFetch = globalThis.fetch;
let calls: string[] = [];

const mockFetch = (status: number, body: string) => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(body, { status });
  }) as typeof fetch;
};

beforeEach(() => {
  calls = [];
  process.env.VOICENSMS_API_KEY = 'KEY123';
  process.env.VOICENSMS_SENDER_ID = 'HOTIPL';
  process.env.VOICENSMS_TEMPLATE_ID = '80388';
  process.env.VOICENSMS_SEND_URL =
    'https://sms.example.com/api/send?apikey={apiKey}&sender={senderId}&templateid={templateId}&number={mobile91}&message={message}';
  process.env.VOICENSMS_MESSAGE = 'Your Ankveda login code is {otp}. Do not share it. - HOTIPL';
  delete process.env.VOICENSMS_SUCCESS_PATTERN;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('fills the URL template with encoded values and the DLT message', async () => {
  mockFetch(200, '{"status":"success","msgid":"abc"}');
  await sendOtpSms('9876543210', '482913');
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get('apikey'), 'KEY123');
  assert.equal(url.searchParams.get('sender'), 'HOTIPL');
  assert.equal(url.searchParams.get('templateid'), '80388');
  assert.equal(url.searchParams.get('number'), '919876543210');
  assert.equal(url.searchParams.get('message'), 'Your Ankveda login code is 482913. Do not share it. - HOTIPL');
});

test('treats a gateway error body as a failure even with HTTP 200', async () => {
  mockFetch(200, '{"status":"error","message":"Invalid template"}');
  await assert.rejects(sendOtpSms('9876543210', '111111'), { code: 'sms_failed' });
});

test('treats HTTP errors and network failures as failures', async () => {
  mockFetch(500, 'oops');
  await assert.rejects(sendOtpSms('9876543210', '111111'), { code: 'sms_failed' });
  globalThis.fetch = (async () => {
    throw new Error('ECONNRESET');
  }) as typeof fetch;
  await assert.rejects(sendOtpSms('9876543210', '111111'), { code: 'sms_failed' });
});

test('honours an explicit success pattern', async () => {
  process.env.VOICENSMS_SUCCESS_PATTERN = '^\\d+$';
  mockFetch(200, 'queued');
  await assert.rejects(sendOtpSms('9876543210', '111111'), { code: 'sms_failed' });
  mockFetch(200, '1234567');
  await sendOtpSms('9876543210', '111111');
});
