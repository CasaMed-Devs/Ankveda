/**
 * Chaldean numerology helpers. Used for the exact numbers shown in reports
 * ("NAME NUMBER · 27 → 9") and to cross-check / fill gaps in Astrology API responses.
 */

const CHALDEAN: Record<string, number> = {
  A: 1, I: 1, J: 1, Q: 1, Y: 1,
  B: 2, K: 2, R: 2,
  C: 3, G: 3, L: 3, S: 3,
  D: 4, M: 4, T: 4,
  E: 5, H: 5, N: 5, X: 5,
  U: 6, V: 6, W: 6,
  O: 7, Z: 7,
  F: 8, P: 8,
};

export type Calculation = { compound: number; value: number; text: string };

/** Repeatedly sums digits until a single digit remains. */
export const reduce = (n: number): number => {
  let value = Math.abs(n);
  while (value > 9) value = String(value).split('').reduce((sum, d) => sum + Number(d), 0);
  return value;
};

const calc = (compound: number): Calculation => {
  const value = reduce(compound);
  return { compound, value, text: compound === value ? `${value}` : `${compound} → ${value}` };
};

const digitSum = (text: string) => text.replace(/\D/g, '').split('').reduce((sum, d) => sum + Number(d), 0);

export const parseDob = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
};

/** Birth (psychic / radical) number: the day of birth reduced. 16 → 7 */
export const birthNumber = (iso: string): Calculation => calc(parseDob(iso).day);

/** Life path (destiny) number: every digit of the full date. 16-08-1996 → 40 → 4 */
export const lifePath = (iso: string): Calculation => calc(digitSum(iso));

/** Name number: Chaldean letter values. "Aarav Sharma" → 27 → 9 */
export const nameNumber = (name: string): Calculation =>
  calc(
    name
      .toUpperCase()
      .split('')
      .reduce((sum, ch) => sum + (CHALDEAN[ch] ?? 0), 0),
  );

/** Phone number: all digits summed. */
export const phoneNumber = (phone: string): Calculation => calc(digitSum(phone));

/** Vehicle number: digits plus Chaldean letter values. "MH12AB1234" */
export const vehicleNumber = (plate: string): Calculation =>
  calc(
    plate
      .toUpperCase()
      .split('')
      .reduce((sum, ch) => sum + (/\d/.test(ch) ? Number(ch) : (CHALDEAN[ch] ?? 0)), 0),
  );

/** Personal year for a given calendar year: birth day + birth month + year. */
export const personalYear = (iso: string, year: number): Calculation => {
  const { day, month } = parseDob(iso);
  return calc(day + month + digitSum(String(year)));
};

/** Personal day number: personal year + today's month + today's day. */
export const personalDay = (iso: string, today: Date): number => {
  const year = personalYear(iso, today.getFullYear()).value;
  return reduce(year + today.getMonth() + 1 + today.getDate());
};

// Traditional planetary friendships between root numbers (Chaldean / Cheiro).
const FRIENDLY: Record<number, number[]> = {
  1: [1, 2, 3, 4, 5, 9],
  2: [1, 2, 3, 5],
  3: [1, 2, 3, 5, 6, 9],
  4: [1, 5, 6, 7, 8],
  5: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  6: [3, 4, 5, 6, 8, 9],
  7: [1, 4, 5, 6],
  8: [4, 5, 6, 8],
  9: [1, 3, 5, 6, 9],
};

export type Harmony = 'supportive' | 'neutral' | 'challenging';

export const harmony = (a: number, b: number): Harmony => {
  if (FRIENDLY[a]?.includes(b) && FRIENDLY[b]?.includes(a)) return 'supportive';
  if (FRIENDLY[a]?.includes(b) || FRIENDLY[b]?.includes(a)) return 'neutral';
  return 'challenging';
};

export const ARCHETYPES: Record<number, { title: string; traits: string; message: string }> = {
  1: { title: 'A born leader.', traits: 'Driven. Original. Independent.', message: 'Take the first step today.\nYour initiative opens doors.' },
  2: { title: 'A gentle peacemaker.', traits: 'Intuitive. Warm. Diplomatic.', message: 'Listen closely today.\nHarmony grows from patience.' },
  3: { title: 'A joyful creator.', traits: 'Expressive. Optimistic. Wise.', message: 'Share an idea today.\nYour words carry light.' },
  4: { title: 'A steady builder.', traits: 'Grounded. Loyal. Practical.', message: 'One careful step today.\nStructure becomes freedom.' },
  5: { title: 'A free spirit.', traits: 'Curious. Adaptable. Bold.', message: 'Welcome something new today.\nChange is your teacher.' },
  6: { title: 'A caring nurturer.', traits: 'Loving. Responsible. Graceful.', message: 'Care for yourself today.\nLove flows both ways.' },
  7: { title: 'A seeker at heart.', traits: 'Reflective. Intuitive. Wise.', message: 'Give your curiosity a little space today.\nClarity often starts with a quiet moment.' },
  8: { title: 'A quiet powerhouse.', traits: 'Determined. Capable. Resilient.', message: 'Steady effort today.\nYour patience is your power.' },
  9: { title: 'The humanitarian.', traits: 'Compassionate. Creative. Big-hearted.', message: 'Give generously today.\nKeep your boundaries kind.' },
};

/** A lucky time derived from the day number: 1 → 09:09, 5 → 13:13 (within the working day). */
export const luckyTimeFor = (dayNumber: number) => {
  const hour = String(8 + dayNumber).padStart(2, '0');
  return `${hour}:${hour}`;
};
