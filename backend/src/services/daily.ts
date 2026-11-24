import { dailyRepo } from '../db/repositories/content';
import { profileKeyOf } from '../db/repositories/users';
import type { Daily } from '../types';
import { astrologyApi } from './astrologyApi';
import { ARCHETYPES, luckyTimeFor, personalDay, reduce } from './numerology';
import { generateJson, STYLE_GUIDE } from './openai';

/** Today's date in India (YYYY-MM-DD), so guidance rolls over at IST midnight. */
export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const pickLuckyNumber = (prediction: Record<string, unknown>, fallback: number) => {
  const raw = prediction.lucky_number ?? prediction.luckyNumber;
  const parsed = Number(String(raw ?? '').split(/[,\s]/)[0]);
  return Number.isFinite(parsed) && parsed > 0 ? reduce(parsed) || fallback : fallback;
};

/**
 * Daily guidance: generated once per user per day (users/{id}/dailyGuidance/{date}).
 * The cache is tied to the profile, so editing name / date of birth regenerates it.
 */
export const getDaily = async (userId: string, person: { fullName: string; dob: string }): Promise<Daily> => {
  const date = todayIst();
  const profileKey = profileKeyOf(person);
  const cached = await dailyRepo.get(userId, date, profileKey);
  if (cached) return cached;

  const dayNumber = personalDay(person.dob, new Date(`${date}T06:00:00+05:30`));
  const prediction = await astrologyApi.dailyPrediction({ dob: person.dob, name: person.fullName });
  const lucky = pickLuckyNumber(prediction, dayNumber);

  const written = await generateJson<{ theme: string; title: string; message: string }>(
    `${STYLE_GUIDE}
Return JSON {"theme": string, "title": string, "message": string} for today's guidance screen.
- theme: a 4–6 word invitation split over two lines with "\\n", e.g. "Today, choose\\nnew beginnings."
- title: 3–6 words, e.g. "Make room for aligned beginnings."
- message: 1–2 short sentences (max 30 words).`,
    JSON.stringify({ date, firstName: person.fullName.split(' ')[0], personalDayNumber: dayNumber, luckyNumber: lucky, astrologyApi: prediction }),
  );

  const archetype = ARCHETYPES[lucky] ?? ARCHETYPES[1];
  const daily: Daily = {
    date,
    luckyNumber: String(lucky),
    luckyTime: luckyTimeFor(lucky),
    theme: written?.theme ?? 'Today, choose\nnew beginnings.',
    title: written?.title ?? 'Make room for aligned beginnings.',
    message: written?.message ?? archetype.message.replace('\n', ' '),
  };
  await dailyRepo.save(userId, daily, profileKey);
  return daily;
};
