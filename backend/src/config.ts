/**
 * Runtime configuration — plain environment variables, so the same code runs on
 * Vercel (staging) and Firebase Cloud Functions (production; secrets are bound in src/firebase.ts).
 * Every external integration has a fallback when its key is missing, so the app runs end-to-end locally.
 */

const env = (name: string) => process.env[name]?.trim() || undefined;

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const parseServiceAccount = (raw: string | undefined): ServiceAccount | null => {
  if (!raw) return null;
  const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const parsed = JSON.parse(json) as ServiceAccount;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id / client_email / private_key');
  }
  return parsed;
};

export type ReportRunner = 'inline' | 'trigger';

export const config = {
  /** "staging" on Vercel, "production" on Firebase, "local" in the emulator. */
  get appEnv() {
    return env('APP_ENV') ?? (process.env.VERCEL ? 'staging' : 'local');
  },
  /** Service-account JSON (raw or base64). Required off Google Cloud (Vercel); Firebase uses default credentials. */
  get firebaseServiceAccount() {
    return parseServiceAccount(env('FIREBASE_SERVICE_ACCOUNT'));
  },
  get firestoreDatabaseId() {
    return env('FIRESTORE_DATABASE_ID') ?? '(default)';
  },
  /** inline = generate in the request's background (Vercel waitUntil); trigger = Firestore trigger (Firebase). */
  get reportRunner(): ReportRunner {
    const value = env('REPORT_RUNNER');
    if (value === 'inline' || value === 'trigger') return value;
    return process.env.VERCEL ? 'inline' : 'trigger';
  },
  /** Browser origins allowed to call the API (the admin page on Firebase Hosting). */
  get corsOrigins() {
    return (env('CORS_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  },
  get jwtSecret() {
    const value = env('JWT_SECRET');
    if (!value) throw new Error('JWT_SECRET is not configured');
    return value;
  },
  get openaiKey() {
    return env('OPENAI_API_KEY');
  },
  get openaiModel() {
    return env('OPENAI_MODEL') ?? 'gpt-4o-mini';
  },
  /**
   * astrologyapi.com. An access token ("ak-…") is sent as the `x-astrologyapi-key` header.
   * Legacy plan keys also need ASTROLOGY_API_USER_ID (non-secret) and use HTTP Basic auth.
   */
  get astrology() {
    const apiKey = env('ASTROLOGY_API_KEY');
    if (!apiKey) return null;
    return {
      apiKey,
      userId: env('ASTROLOGY_API_USER_ID'),
      baseUrl: env('ASTROLOGY_API_BASE_URL') ?? 'https://json.astrologyapi.com/v1',
      chatUrl: env('ASTROLOGY_CHAT_URL') ?? 'https://json-chat.astrologyapi.com/api/chat',
    };
  },
  get razorpay() {
    const keyId = env('RAZORPAY_KEY_ID');
    const keySecret = env('RAZORPAY_KEY_SECRET');
    return keyId && keySecret ? { keyId, keySecret } : null;
  },
  get razorpayWebhookSecret() {
    return env('RAZORPAY_WEBHOOK_SECRET');
  },
  /**
   * "sms"   = real codes sent through VoiceNSMS (default when VoiceNSMS is configured).
   * "dummy" = fixed DUMMY_OTP shown in the app — local development / staging only.
   */
  get otpMode(): 'sms' | 'dummy' {
    const value = env('OTP_MODE');
    if (value === 'sms' || value === 'dummy') return value;
    return this.voicensms ? 'sms' : 'dummy';
  },
  get dummyOtp() {
    return env('DUMMY_OTP') ?? '123456';
  },
  /**
   * Numbers that always use a fixed code and never receive an SMS (Play Store review, QA),
   * e.g. "9000000001:482913,9000000002:110022".
   */
  get otpTestNumbers(): Map<string, string> {
    const pairs = (env('OTP_TEST_NUMBERS') ?? '').split(',').map((p) => p.trim().split(':'));
    return new Map(pairs.filter(([phone, code]) => /^\d{10}$/.test(phone ?? '') && /^\d{6}$/.test(code ?? '')) as [string, string][]);
  },
  /** Max login codes sent to one number per day (SMS cost / abuse protection). */
  get otpDailyLimit() {
    return Number(env('OTP_DAILY_LIMIT') ?? 8);
  },
  /** VoiceNSMS DLT SMS — see src/services/sms.ts for the URL template format. */
  get voicensms() {
    const apiKey = env('VOICENSMS_API_KEY');
    const sendUrl = env('VOICENSMS_SEND_URL');
    const messageTemplate = env('VOICENSMS_MESSAGE');
    if (!apiKey || !sendUrl || !messageTemplate) return null;
    const success = env('VOICENSMS_SUCCESS_PATTERN');
    return {
      apiKey,
      sendUrl,
      messageTemplate,
      senderId: env('VOICENSMS_SENDER_ID') ?? '',
      templateId: env('VOICENSMS_TEMPLATE_ID') ?? '',
      successPattern: success ? new RegExp(success, 'i') : null,
      failurePattern: new RegExp(env('VOICENSMS_FAILURE_PATTERN') ?? '"?(status|type)"?\\s*[:=]\\s*"?(error|fail|failed|false)|invalid|insufficient|unauthori', 'i'),
    };
  },
};
