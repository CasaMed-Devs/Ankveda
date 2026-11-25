import { dailyRepo } from '../db/repositories/content';
import { profileKeyOf } from '../db/repositories/users';
import { HttpError } from '../lib/http';
import { logger } from '../lib/logger';
import type { Daily, UserProfile } from '../types';
import { astrologyApi, type AstroRecord } from './astrologyApi';
import { luckyTimeFor, personalDay, reduce } from './numerology';
import { generateJson, STYLE_GUIDE } from './openai';

/** Today's date in India (YYYY-MM-DD): the daily limit resets at 00:00 IST. */
export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** How long a second request waits for another request that is already generating today's report. */
const WAIT_FOR_OTHER_MS = 45_000;
const POLL_MS = 1_000;

const UNAVAILABLE = 'We couldn’t reach the astrologer right now. Please try again in a moment.';

const pickLuckyNumber = (prediction: AstroRecord, fallback: number) => {
  const raw = prediction.lucky_number ?? prediction.luckyNumber;
  const parsed = Number(String(raw ?? '').split(/[,\s]/)[0]);
  return Number.isFinite(parsed) && parsed > 0 ? reduce(parsed) || fallback : fallback;
};

/** "HH:MM" from the API's lucky time if it gives one, else the number-based time. */
const pickLuckyTime = (prediction: AstroRecord, lucky: number) => {
  const raw = String(prediction.lucky_time ?? prediction.luckyTime ?? '');
  const match = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : luckyTimeFor(lucky);
};

type Written = { theme: string; title: string; message: string };

const isWritten = (w: Partial<Written> | null): w is Written =>
  !!w && [w.theme, w.title, w.message].every((v) => typeof v === 'string' && v.trim().length > 0);

/** Builds today's report from astrologyapi.com + OpenAI. Throws if either is unavailable. */
const generate = async (date: string, profile: UserProfile): Promise<Daily> => {
  const input = { dob: profile.dob, name: profile.fullName };
  const dayNumber = personalDay(profile.dob, new Date(`${date}T06:00:00+05:30`));

  let prediction: AstroRecord;
  let table: AstroRecord;
  try {
    [prediction, table] = await Promise.all([astrologyApi.strict.dailyPrediction(input), astrologyApi.strict.numeroTable(input)]);
  } catch (error) {
    throw Object.assign(new Error('astrology'), { cause: error });
  }

  const lucky = pickLuckyNumber(prediction, dayNumber);
  const luckyTime = pickLuckyTime(prediction, lucky);

  let written: Partial<Written> | null;
  try {
    written = await generateJson<Partial<Written>>(
      `${STYLE_GUIDE}
You are writing today's personal numerology guidance for one person, using their details and today's
astrologyapi.com numerology prediction. Ground every line in their numbers and the prediction — never generic.
Return JSON {"theme": string, "title": string, "message": string}:
- theme: a 4–6 word invitation split over two lines with "\\n", e.g. "Today, choose\\nnew beginnings."
- title: 3–6 words, e.g. "Make room for aligned beginnings."
- message: 1–2 short sentences (max 30 words), addressed to them, reflecting today's prediction.`,
      JSON.stringify({
        date,
        person: {
          firstName: profile.fullName.split(' ')[0],
          dateOfBirth: profile.dob,
          birthTime: profile.birthTime ?? null,
          birthPlace: profile.birthPlace ?? null,
          numbers: { birth: profile.numbers.birth, lifePath: profile.numbers.lifePath, name: profile.numbers.name },
        },
        today: { personalDayNumber: dayNumber, luckyNumber: lucky, luckyTime },
        astrologyApi: { dailyPrediction: prediction, numerologyTable: table },
      }),
    );
  } catch (error) {
    throw Object.assign(new Error('openai'), { cause: error });
  }
  if (!isWritten(written)) {
    throw Object.assign(new Error('openai'), { cause: written === null ? 'OPENAI_API_KEY is not configured' : 'incomplete JSON' });
  }

  return {
    date,
    luckyNumber: String(lucky),
    luckyTime,
    theme: written.theme.trim(),
    title: written.title.trim(),
    message: written.message.trim(),
  };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Today's finished report without generating one (Home card). */
export const readDaily = (userId: string) => dailyRepo.get(userId, todayIst());

/**
 * Daily guidance: exactly one report per user per IST day (users/{id}/dailyGuidance/{date}).
 * The first request claims the day and generates; concurrent requests wait for that result.
 * A failed generation is released, so it doesn't use up the day — the next open retries.
 */
export const getDaily = async (userId: string, profile: UserProfile): Promise<Daily> => {
  const date = todayIst();
  const profileKey = profileKeyOf(profile);
  const deadline = Date.now() + WAIT_FOR_OTHER_MS;

  for (;;) {
    const claim = await dailyRepo.claim(userId, date, profileKey);
    if (claim.kind === 'ready') return claim.daily;
    if (claim.kind === 'claimed') break;
    // Another request is generating today's report — wait for it.
    if (Date.now() > deadline) throw new HttpError(503, UNAVAILABLE, 'daily_unavailable');
    await wait(POLL_MS);
  }

  try {
    const daily = await generate(date, profile);
    await dailyRepo.save(userId, daily, profileKey);
    return daily;
  } catch (error) {
    await dailyRepo.release(userId, date).catch(() => undefined);
    const step = error instanceof Error ? error.message : 'unknown';
    logger.error('Daily guidance generation failed', { userId, step, error: (error as { cause?: unknown }).cause ?? error });
    throw new HttpError(503, UNAVAILABLE, 'daily_unavailable');
  }
};
