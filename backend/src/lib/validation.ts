import { z } from 'zod';

const isRealPastDate = (iso: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getTime() <= Date.now();
};

export const dobSchema = z.string().refine(isRealPastDate, 'Enter a valid date of birth.');

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Please enter a full name.')
  .max(60, 'That name is too long.')
  .regex(/^[\p{L} .'-]+$/u, 'Use letters only for the name.');
