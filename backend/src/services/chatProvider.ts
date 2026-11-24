import { config } from '../config';
import { profileKeyOf, usersRepo } from '../db/repositories/users';
import { HttpError } from '../lib/http';
import { logger } from '../lib/logger';
import type { ChatMessage, ChatProvider, UserDoc, UserProfile } from '../types';
import { astrologyApi } from './astrologyApi';
import { ARCHETYPES } from './numerology';
import { generateText, STYLE_GUIDE } from './openai';

/**
 * AI astrologer reply via the astrologyapi.com Astro Chat API.
 * The conversation id is stored on users/{id}.chat and tied to the birth details it started with,
 * so editing name / DOB starts a fresh conversation.
 * Without an Astrology API key (local development) it falls back to OpenAI, then to a template.
 */
export const astrologerReply = async (
  userId: string,
  user: UserDoc & { profile: UserProfile },
  history: ChatMessage[],
  question: string,
): Promise<{ text: string; provider: ChatProvider }> => {
  const { fullName, dob, numbers } = user.profile;

  if (config.astrology) {
    const profileKey = profileKeyOf(user.profile);
    const sessionId = user.chat?.profileKey === profileKey ? (user.chat.astroSessionId ?? undefined) : undefined;
    // Give the astrologer the user's numerology numbers at the start of a new session.
    const q = sessionId
      ? question
      : `My Chaldean numerology numbers: birth number ${numbers.birth}, life path ${numbers.lifePath}, name number ${numbers.name}.\n\n${question}`;
    try {
      const reply = await astrologyApi.chat({ name: fullName, dob, question: q, sessionId });
      if (reply.sessionId && reply.sessionId !== sessionId) await usersRepo.setChatSession(userId, reply.sessionId, profileKey);
      return { text: reply.text, provider: 'astrologyapi' };
    } catch (error) {
      logger.error('Astro Chat failed', error);
      throw new HttpError(502, 'Our astrologer is unavailable right now. Please try again in a moment.', 'chat_unavailable');
    }
  }

  const reply = await generateText(
    `${STYLE_GUIDE}
You are Ankveda's numerology astrologer, answering ${fullName.split(' ')[0]} in a chat.
Their numbers: birth number ${numbers.birth}, life path ${numbers.lifePath}, name number ${numbers.name} (Chaldean).
Answer in 2–5 sentences. Ground answers in their numbers. If asked about health, money or legal matters, suggest a qualified professional.`,
    [
      ...history.slice(-12).map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.text })),
      { role: 'user', content: question },
    ],
  );
  if (reply) return { text: reply, provider: 'openai' };

  const archetype = ARCHETYPES[numbers.birth];
  const traits = archetype.traits.toLowerCase().replace(/\.$/, '').split('. ').join(', ');
  return {
    text: `Your birth number ${numbers.birth} carries a ${traits} energy. ${archetype.message.replace('\n', ' ')} (Development mode: add the Astrology API key for full answers.)`,
    provider: 'template',
  };
};
