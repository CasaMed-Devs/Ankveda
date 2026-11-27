import { config } from '../config';
import { HttpError } from '../lib/http';
import { logger } from '../lib/logger';

/**
 * Persona API client (https://personaapi.web.app/docs) — astrologer personas for chat.
 * Persona API stores every conversation, so it is the source of truth for chat history.
 * The key is secret: only the backend calls it; the app talks to our /astrologers and /chat routes.
 *
 * Ids: session_id = conversation id = `${userId}__${profileId}` (one ongoing chat per user per astrologer).
 */

export type PersonaRequiredInput = { key: string; label: string; example?: string; required: boolean };

export type PersonaProfile = {
  id: string;
  category: string;
  name: string;
  tagline: string;
  method: string;
  city: string;
  age: number;
  photo_url: string;
  greeting: string;
  openers: string[];
  required_inputs: PersonaRequiredInput[];
};

export type PersonaMessage = { seq: number; role: 'user' | 'assistant'; text: string; at: number };

export type PersonaConversation = {
  id: string;
  user_id: string | null;
  profile: { id: string; name: string; category: string; photo_url?: string };
  blocked: boolean;
  message_count: number;
  last_message: { role: 'user' | 'assistant'; text: string; at: number } | null;
  created_at: number;
  updated_at: number;
};

type PersonaChatResponse = {
  session_id: string;
  message: PersonaMessage;
  reply: { seq: number; text: string; at: number };
};

const TIMEOUT_MS = 60_000;

/** Persona error codes → status + a message the app can show (Persona's own messages are Hinglish). */
const FRIENDLY: Record<string, string> = {
  conversation_blocked: 'This chat is unavailable.',
  profile_not_enabled: 'This astrologer is not available right now.',
  unknown_profile: 'This astrologer is not available right now.',
  missing_context: 'Please add your birth details first.',
  upstream_error: 'The astrologer could not reply just now. Please try again.',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async <T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, retried = false): Promise<T> => {
  const persona = config.persona;
  if (!persona) throw new HttpError(503, 'Chat is not available right now.', 'chat_unavailable');

  // Persona's CDN caches error responses (e.g. the 404 for a chat that has no messages yet) for 10 minutes
  // per URL, ignoring the API key and Cache-Control request headers. Without a unique URL, a chat opened
  // before its first message keeps returning "not found" — the app then shows an empty history.
  const url = method === 'GET' ? `${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}` : path;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${persona.baseUrl}/v1${url}`, {
      method,
      headers: { Authorization: `Bearer ${persona.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    logger.warn(`Persona API ${method} ${path} network error`, error);
    throw new HttpError(502, FRIENDLY.upstream_error, 'chat_unavailable');
  } finally {
    clearTimeout(timer);
  }

  const data = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (response.ok) return data;

  const code = data.error?.code ?? 'chat_unavailable';
  // The docs ask to retry only upstream_error, once, after ~2 s.
  if (code === 'upstream_error' && !retried) {
    await sleep(2000);
    return request<T>(method, path, body, true);
  }
  if (response.status === 401 || response.status >= 500 || code === 'account_disabled') {
    logger.error(`Persona API ${method} ${path} failed (${response.status} ${code})`, data.error?.message);
    throw new HttpError(502, FRIENDLY.upstream_error, 'chat_unavailable');
  }
  throw new HttpError(response.status, FRIENDLY[code] ?? data.error?.message ?? 'Something went wrong.', code);
};

export const sessionIdFor = (userId: string, profileId: string) => `${userId}__${profileId}`;

export const personaApi = {
  configured: () => !!config.persona,

  listProfiles: async () => (await request<{ profiles: PersonaProfile[] }>('GET', '/profiles')).profiles,

  /** Sends a message and waits for the reply (3–8 s). Context is stored on the conversation. */
  chat: (input: { sessionId: string; profileId: string; userId: string; message: string; context: Record<string, string> }) =>
    request<PersonaChatResponse>('POST', '/chat', {
      session_id: input.sessionId,
      profile_id: input.profileId,
      user_id: input.userId,
      message: input.message,
      context: input.context,
    }),

  /** A user's conversations, most recent first. */
  listConversations: async (userId: string, limit = 100) =>
    (await request<{ conversations: PersonaConversation[] }>('GET', `/conversations?user_id=${encodeURIComponent(userId)}&limit=${limit}`))
      .conversations,

  /** One page of history, oldest → newest. `before` is a `seq` cursor. A missing conversation is an empty page. */
  messages: async (sessionId: string, opts: { limit?: number; before?: number } = {}) => {
    const query = new URLSearchParams({ limit: String(opts.limit ?? 50) });
    if (opts.before !== undefined) query.set('before', String(opts.before));
    try {
      return await request<{ messages: PersonaMessage[]; next_cursor: number | null; has_more: boolean }>(
        'GET',
        `/conversations/${encodeURIComponent(sessionId)}/messages?${query}`,
      );
    } catch (error) {
      if (error instanceof HttpError && error.code === 'conversation_not_found') return { messages: [], next_cursor: null, has_more: false };
      throw error;
    }
  },
};
