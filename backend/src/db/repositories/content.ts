import { SCHEMA_VERSION, type ChatMessage, type ChatMessageDoc, type ChatProvider, type Daily, type DailyDoc } from '../../types';
import { db, refs } from '../firestore';
import { DAY_MS } from '../schema';

const DAILY_RETENTION_DAYS = 30;

export const chatRepo = {
  recent: async (userId: string, limit: number): Promise<ChatMessage[]> => {
    const snap = await refs.chatMessages(userId).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, role: d.data().role, text: d.data().text, createdAt: d.data().createdAt })).reverse();
  },

  /** Stores a question and its answer atomically. */
  appendExchange: async (userId: string, question: string, answer: string, provider: ChatProvider): Promise<ChatMessage[]> => {
    const now = Date.now();
    const userRef = refs.chatMessages(userId).doc();
    const botRef = refs.chatMessages(userId).doc();
    const userMsg: ChatMessageDoc = { schemaVersion: SCHEMA_VERSION, role: 'user', text: question, provider: null, createdAt: now };
    const botMsg: ChatMessageDoc = { schemaVersion: SCHEMA_VERSION, role: 'astrologer', text: answer, provider, createdAt: now + 1 };
    const batch = db.batch();
    batch.create(userRef, userMsg);
    batch.create(botRef, botMsg);
    await batch.commit();
    return [
      { id: userRef.id, role: 'user', text: question, createdAt: userMsg.createdAt },
      { id: botRef.id, role: 'astrologer', text: answer, createdAt: botMsg.createdAt },
    ];
  },
};

export const dailyRepo = {
  /** Returns today's cached guidance only if it was written for the current profile. */
  get: async (userId: string, date: string, profileKey: string): Promise<Daily | null> => {
    const doc = (await refs.dailyGuidance(userId).doc(date).get()).data();
    if (!doc || doc.profileKey !== profileKey) return null;
    return { date: doc.date, luckyNumber: doc.luckyNumber, luckyTime: doc.luckyTime, theme: doc.theme, title: doc.title, message: doc.message };
  },

  save: (userId: string, daily: Daily, profileKey: string) => {
    const now = Date.now();
    const doc: DailyDoc = {
      ...daily,
      schemaVersion: SCHEMA_VERSION,
      profileKey,
      createdAt: now,
      expireAt: now + DAILY_RETENTION_DAYS * DAY_MS,
    };
    return refs.dailyGuidance(userId).doc(daily.date).set(doc);
  },
};
