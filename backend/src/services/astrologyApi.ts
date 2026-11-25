import { logger } from '../lib/logger';

import { config } from '../config';
import { ARCHETYPES, birthNumber, lifePath, nameNumber, parseDob, personalDay } from './numerology';

/**
 * astrologyapi.com client.
 *  - Numerology: POST https://json.astrologyapi.com/v1/<endpoint> with { day, month, year, name }.
 * Auth: access token in the `x-astrologyapi-key` header (or Basic userId:apiKey for legacy plan keys).
 * Numerology responses are passed to OpenAI as context, so we keep them as loose records.
 */

export type AstroRecord = Record<string, unknown>;

type BirthInput = { dob: string; name: string };

const TIMEOUT_MS = 15_000;

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

  /** Daily numerology prediction for today (falls back to the local personal-day number). */
  dailyPrediction: (input: BirthInput) =>
    withFallback(
      'numero_prediction/daily',
      () => post('numero_prediction/daily', birthBody(input)),
      // Today in India (06:00 IST), not the server's UTC date.
      () => ({ source: 'local-mock', lucky_number: personalDay(input.dob, new Date(`${istDateKey()}T06:00:00+05:30`)) }),
    ),

  /**
   * Strict variants for daily guidance: the real API or an error — never local stand-ins, so a report
   * is only ever saved from astrologyapi.com data.
   */
  strict: {
    numeroTable: (input: BirthInput) => post('numero_table', birthBody(input)),
    dailyPrediction: (input: BirthInput) => post('numero_prediction/daily', birthBody(input)),
  },
};

/** YYYY-MM-DD in India. */
const istDateKey = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
