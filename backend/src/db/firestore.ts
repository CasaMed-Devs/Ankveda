import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { config } from '../config';
import type {
  AdminOverviewDoc,
  AuditLogDoc,
  CounterDoc,
  DeletedAccountDoc,
  PhoneAccountDoc,
  DailyStatsMonthDoc,
  MetaEventDoc,
  UserDeletionDoc,
  ChatMessageDoc,
  DailyDoc,
  OtpChallengeDoc,
  PlanDoc,
  ReportDoc,
  SubscriptionDoc,
  SubscriptionEventDoc,
  TransactionDoc,
  UserDoc,
  WebhookEventDoc,
} from '../types';
import { converter } from './schema';

/**
 * Firebase Admin. On Cloud Functions / emulator: default credentials.
 * On Vercel: FIREBASE_SERVICE_ACCOUNT (service-account JSON, raw or base64).
 */
const initApp = (): App => {
  const existing = getApps()[0];
  if (existing) return existing;
  const serviceAccount = config.firebaseServiceAccount;
  if (!serviceAccount) return initializeApp();
  return initializeApp({
    projectId: serviceAccount.project_id,
    credential: cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
    }),
  });
};

/** The Firebase Admin app (Firestore + Auth for verifying admin ID tokens). */
export const firebaseApp = initApp();

const createDb = (): Firestore => {
  const app = firebaseApp;
  const databaseId = config.firestoreDatabaseId;
  const firestore = databaseId === '(default)' ? getFirestore(app) : getFirestore(app, databaseId);
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
};

export const db = createDb();

/** Typed references for every collection in the schema (see src/types.ts). */
export const refs = {
  users: () => db.collection('users').withConverter(converter<UserDoc>()),
  user: (userId: string) => refs.users().doc(userId),
  reports: (userId: string) => refs.user(userId).collection('reports').withConverter(converter<ReportDoc>()),
  reportsGroup: () => db.collectionGroup('reports').withConverter(converter<ReportDoc>()),
  chatMessages: (userId: string) => refs.user(userId).collection('chatMessages').withConverter(converter<ChatMessageDoc>()),
  dailyGuidance: (userId: string) => refs.user(userId).collection('dailyGuidance').withConverter(converter<DailyDoc>()),
  plans: () => db.collection('plans').withConverter(converter<PlanDoc>()),
  subscriptions: () => db.collection('subscriptions').withConverter(converter<SubscriptionDoc>()),
  subscriptionEvents: (subscriptionId: string) =>
    refs.subscriptions().doc(subscriptionId).collection('events').withConverter(converter<SubscriptionEventDoc>()),
  transactions: () => db.collection('transactions').withConverter(converter<TransactionDoc>()),
  otpChallenges: () => db.collection('otpChallenges').withConverter(converter<OtpChallengeDoc>()),
  webhookEvents: () => db.collection('webhookEvents').withConverter(converter<WebhookEventDoc>()),
  adminAuditLog: () => db.collection('adminAuditLog').withConverter(converter<AuditLogDoc>()),
  adminStats: () => db.collection('adminStats').withConverter(converter<AdminOverviewDoc>()),
  adminDailyStats: () => db.collection('adminDailyStats').withConverter(converter<DailyStatsMonthDoc>()),
  userDeletions: () => db.collection('userDeletions').withConverter(converter<UserDeletionDoc>()),
  metaEvents: () => db.collection('metaEvents').withConverter(converter<MetaEventDoc>()),
  counters: () => db.collection('counters').withConverter(converter<CounterDoc>()),
  phoneAccounts: () => db.collection('phoneAccounts').withConverter(converter<PhoneAccountDoc>()),
  deletedAccounts: () => db.collection('deletedAccounts').withConverter(converter<DeletedAccountDoc>()),
};
