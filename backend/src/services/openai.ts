import OpenAI from 'openai';

import { config } from '../config';

let client: OpenAI | null = null;

const getClient = () => {
  const apiKey = config.openaiKey;
  if (!apiKey) return null;
  if (!client) client = new OpenAI({ apiKey });
  return client;
};

export const openaiConfigured = () => !!config.openaiKey;

/**
 * Asks the model for a JSON object. Returns null when OpenAI is not configured,
 * so callers can fall back to template copy in development.
 */
export const generateJson = async <T>(system: string, user: string): Promise<T | null> => {
  const openai = getClient();
  if (!openai) return null;

  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned an empty response');
  return JSON.parse(text) as T;
};

/** Plain-text chat reply (used only as a fallback for the astrologer chat). */
export const generateText = async (system: string, messages: { role: 'user' | 'assistant'; content: string }[]) => {
  const openai = getClient();
  if (!openai) return null;
  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  return completion.choices[0]?.message?.content?.trim() ?? null;
};

export const STYLE_GUIDE = `You write for Ankveda, a premium Indian numerology app.
Voice: warm, calm, elegant, reflective. Short sentences. Second person ("you").
Never predict disasters, illness, death or guaranteed outcomes. Frame everything as reflection and guidance, not prediction.
No medical, legal or financial advice. English only. No emojis.`;
