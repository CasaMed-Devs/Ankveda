import { cleanReply } from '../lib/cleanReply';
import { HttpError } from '../lib/http';
import type { Astrologer, ChatMessage, ConversationSummary, UserDoc, UserProfile } from '../types';
import { personaApi, type PersonaConversation, type PersonaMessage } from './personaApi';

/**
 * Chat with astrologers (Persona API personas).
 *  - The list is cached in memory for 10 minutes (it only changes when profiles are enabled on the dashboard).
 *  - Every message shown in the app goes through cleanReply (no emoji / markdown symbols).
 *  - Birth details an astrologer needs are built from the user's profile + what they entered in chat.
 */

const LIST_TTL_MS = 10 * 60_000;
let cache: { at: number; list: Astrologer[] } | null = null;

export const listAstrologers = async (): Promise<Astrologer[]> => {
  if (cache && Date.now() - cache.at < LIST_TTL_MS) return cache.list;
  const profiles = await personaApi.listProfiles();
  const list = profiles.map<Astrologer>((p) => ({
    id: p.id,
    name: p.name,
    speciality: cleanReply(p.tagline || p.category),
    about: cleanReply(p.method ?? ''),
    city: p.city,
    age: p.age,
    photoUrl: p.photo_url,
    greeting: cleanReply(p.greeting ?? ''),
    openers: (p.openers ?? []).map(cleanReply).filter(Boolean),
    requiredInputs: (p.required_inputs ?? []).map((r) => ({ key: r.key, label: r.label, example: r.example, required: !!r.required })),
  }));
  cache = { at: Date.now(), list };
  return list;
};

export const findAstrologer = async (id: string) => {
  const astrologer = (await listAstrologers()).find((a) => a.id === id);
  if (!astrologer) throw new HttpError(404, 'This astrologer is not available right now.', 'unknown_profile');
  return astrologer;
};

/** Everything we know that an astrologer may ask for. */
export const chatContextFor = (user: UserDoc & { profile: UserProfile }, astrologerId: string): Record<string, string> => {
  const { profile } = user;
  const context: Record<string, string> = {
    ...(user.chatContext?.[astrologerId] ?? {}),
    name: profile.fullName,
    dob: profile.dob,
    numerology: `Birth number ${profile.numbers.birth}, life path ${profile.numbers.lifePath}, name number ${profile.numbers.name}`,
  };
  if (profile.birthTime) context.tob = profile.birthTime;
  if (profile.birthPlace) context.pob = profile.birthPlace;
  return context;
};

/** Required inputs the user still has to fill in before chatting with this astrologer. */
export const missingInputs = (astrologer: Astrologer, context: Record<string, string>) =>
  astrologer.requiredInputs.filter((input) => input.required && !context[input.key]?.trim()).map((input) => input.key);

export const toChatMessage = (m: PersonaMessage): ChatMessage => ({
  id: String(m.seq),
  role: m.role === 'user' ? 'user' : 'astrologer',
  text: m.role === 'user' ? m.text : cleanReply(m.text),
  createdAt: m.at,
});

export const toSummary = (c: PersonaConversation): ConversationSummary => ({
  astrologerId: c.profile.id,
  messageCount: c.message_count,
  updatedAt: c.updated_at,
  lastMessage: c.last_message
    ? {
        role: c.last_message.role === 'user' ? 'user' : 'astrologer',
        text: c.last_message.role === 'user' ? c.last_message.text : cleanReply(c.last_message.text),
        createdAt: c.last_message.at,
      }
    : null,
});
