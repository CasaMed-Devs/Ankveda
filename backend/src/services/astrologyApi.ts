import { logger } from '../lib/logger';

import { config } from '../config';
import { ARCHETYPES, birthNumber, lifePath, nameNumber, parseDob, personalDay } from './numerology';

/**
 * astrologyapi.com client.
 *  - Numerology: POST https://json.astrologyapi.com/v1/<endpoint> with { day, month, year, name }.
 *  - Chat:       POST https://json-chat.astrologyapi.com/api/chat (Astro Chat API).
 * Auth: access token in the `x-astrologyapi-key` header (or Basic userId:apiKey for legacy plan keys).
 * Numerology responses are passed to OpenAI as context, so we keep them as loose records.
 */

export type AstroRecord = Record<string, unknown>;

type BirthInput = { dob: string; name: string };

const TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_MS = 50_000;

const authHeaders = (astro: NonNullable<typeof config.astrology>): Record<string, string> =>
  astro.userId
    ? { Authorization: `Basic ${Buffer.from(`${astro.userId}:${astro.apiKey}`).toString('base64')}` }
    : { 'x-astrologyapi-key': astro.apiKey };

const postJson = async (url: string, body: Record<string, unknown>, timeoutMs: number): Promise<AstroRecord> => {
  const astro = config.astrology;
  if (!astro) throw new Error('Astrology API is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(astro), 'Content-Type': 'application/json', 'Accept-Language': 'en' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as AstroRecord;
    if (!response.ok || data.status === false) {
      throw new Error(`Astrology API ${new URL(url).pathname} failed (${response.status}): ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const post = (endpoint: string, body: Record<string, unknown>) =>
  postJson(`${config.astrology?.baseUrl}/${endpoint}`, body, TIMEOUT_MS);

export type AstroChatRequest = {
  name: string;
  dob: string;
  question: string;
  sessionId?: string;
};

export type AstroChatResponse = { text: string; sessionId?: string };

// The app doesn't collect birth time/place yet; the chart uses these neutral defaults (see README).
const CHAT_DEFAULTS = { hour: 12, min: 0, place: 'New Delhi', lat: '28.61', lon: '77.21', tzone: '5.5', country: 'INDIA' };

const birthBody = ({ dob, name }: BirthInput) => {
  const { day, month, year } = parseDob(dob);
  return { day, month, year, name };
};

/** Locally computed stand-in used when no API key is configured (development / emulator). */
const mockTable = ({ dob, name }: BirthInput): AstroRecord => ({
  source: 'local-mock',
  name,
  date: dob,
  radical_number: birthNumber(dob).value,
  destiny_number: lifePath(dob).value,
  name_number: nameNumber(name).value,
  fav_color: 'Gold, cream',
  fav_day: 'Thursday',
  friendly_num: '1, 3, 5',
});

const withFallback = async (label: string, call: () => Promise<AstroRecord>, fallback: () => AstroRecord) => {
  if (!config.astrology) return fallback();
  try {
    return await call();
  } catch (error) {
    // A single failing endpoint should not fail the whole report; the local numbers still apply.
    logger.warn(`Astrology API ${label} failed, using local numbers`, error);
    return { ...fallback(), source: 'local-fallback' };
  }
};

export const astrologyApi = {
  /** Core numerology table: radical/destiny/name numbers, favourable colours, days, gods, stones… */
  numeroTable: (input: BirthInput) => withFallback('numero_table', () => post('numero_table', birthBody(input)), () => mockTable(input)),

  /** Narrative numerology report for the person's radical number. */
  numeroReport: (input: BirthInput) =>
    withFallback(
      'numero_report',
      () => post('numero_report', birthBody(input)),
      () => ({ source: 'local-mock', title: ARCHETYPES[birthNumber(input.dob).value].title }),
    ),

  /** Favourable times / dates. */
  numeroFavTime: (input: BirthInput) =>
    withFallback('numero_fav_time', () => post('numero_fav_time', birthBody(input)), () => ({ source: 'local-mock' })),

  /** Daily numerology prediction for today. */
  dailyPrediction: (input: BirthInput) =>
    withFallback(
      'numero_prediction/daily',
      () => post('numero_prediction/daily', birthBody(input)),
      () => ({ source: 'local-mock', lucky_number: personalDay(input.dob, new Date()) }),
    ),

  /** Astro Chat API — Vedic AI astrologer. Reuse `sessionId` to continue the same conversation. */
  chat: async ({ name, dob, question, sessionId }: AstroChatRequest): Promise<AstroChatResponse> => {
    const { day, month, year } = parseDob(dob);
    const data = await postJson(
      config.astrology!.chatUrl,
      {
        language: 'en',
        name,
        day,
        month,
        year,
        ...CHAT_DEFAULTS,
        ap: 'KUNDLI',
        sid: sessionId ?? '',
        ep: 'STANDARD',
        ac: 'VEDIC',
        q: question,
      },
      CHAT_TIMEOUT_MS,
    );
    const text = typeof data.response === 'string' ? data.response.trim() : '';
    if (data.success === false || !text) throw new Error(`Astro Chat returned no answer: ${JSON.stringify(data).slice(0, 200)}`);
    return { text, sessionId: typeof data.session_id === 'string' ? data.session_id : sessionId };
  },
};
