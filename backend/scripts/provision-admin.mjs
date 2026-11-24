#!/usr/bin/env node
/**
 * One-time (idempotent) admin provisioning for the Ankveda admin dashboard.
 *
 *   1. Enables Firebase Authentication → Email/Password on the project (initialises Auth if it never was).
 *   2. Finds or registers the "Ankveda Admin" Web app and writes its public config to
 *      admin/src/lib/firebase-config.json (Web config is not secret).
 *   3. Creates / updates the admin account and sets the custom claim { admin: true }.
 *
 * The password is never stored in the repo — pass it at run time:
 *
 *   cd backend
 *   ADMIN_PASSWORD_INITIAL='…' npm run admin:provision -- --email admin@ankveda.in
 *
 * Options:
 *   --email <email>        admin email (default admin@ankveda.in)
 *   --reset-password       also reset the password of an existing account to ADMIN_PASSWORD_INITIAL
 *   --revoke               remove the admin claim from --email (and revoke its sessions)
 *   --skip-project-setup   only manage the user (steps 1–2 skipped)
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT (raw/base64 JSON) or backend/service-account.json.
 * Emulator: set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 and GCLOUD_PROJECT=<id>; steps 1–2 are skipped.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const email = option('email', 'admin@ankveda.in').trim().toLowerCase();
const emulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

const loadServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (raw) return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  const file = resolve(here, '..', 'service-account.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  return null;
};

const serviceAccount = emulator ? null : loadServiceAccount();
if (!emulator && !serviceAccount) {
  console.error('No credentials: set FIREBASE_SERVICE_ACCOUNT or add backend/service-account.json.');
  process.exit(1);
}
const projectId = serviceAccount?.project_id ?? process.env.GCLOUD_PROJECT ?? 'demo-ankveda';
const app = serviceAccount
  ? initializeApp({ projectId, credential: cert({ ...serviceAccount, private_key: serviceAccount.private_key.replace(/\\n/g, '\n') }) })
  : initializeApp({ projectId });

const googleFetch = async (method, url, body) => {
  const { access_token: token } = await app.options.credential.getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': projectId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
};

const consoleHelp = () =>
  [
    'Do it in the Firebase console instead:',
    `  1. https://console.firebase.google.com/project/${projectId}/authentication → Get started → Sign-in method → Email/Password → Enable`,
    `  2. https://console.firebase.google.com/project/${projectId}/settings/general → Your apps → Add app → Web ("Ankveda Admin")`,
    '  then re-run this script.',
  ].join('\n');

const enableEmailPassword = async () => {
  const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  const patch = () =>
    googleFetch('PATCH', `${configUrl}?updateMask=signIn.email.enabled,signIn.email.passwordRequired`, {
      signIn: { email: { enabled: true, passwordRequired: true } },
    });

  let res = await patch();
  if (res.status === 404 && JSON.stringify(res.json).includes('CONFIGURATION_NOT_FOUND')) {
    console.log('• Firebase Authentication is not initialised yet — initialising…');
    const init = await googleFetch('POST', `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/identityPlatform:initializeAuth`, {});
    if (init.status >= 300) {
      console.error('  Could not initialise Authentication:', init.status, JSON.stringify(init.json));
      console.error(consoleHelp());
      process.exit(1);
    }
    res = await patch();
  }
  if (res.status >= 300) {
    console.error('  Could not enable Email/Password sign-in:', res.status, JSON.stringify(res.json));
    console.error(consoleHelp());
    process.exit(1);
  }
  console.log('✓ Email/Password sign-in is enabled');
};

const waitForOperation = async (name) => {
  for (let i = 0; i < 30; i++) {
    const op = await googleFetch('GET', `https://firebase.googleapis.com/v1beta1/${name}`);
    if (op.json.done) {
      if (op.json.error) throw new Error(JSON.stringify(op.json.error));
      return op.json.response;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Timed out waiting for the Web app to be created');
};

const ensureWebAppConfig = async () => {
  const base = `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`;
  const list = await googleFetch('GET', base);
  if (list.status >= 300) {
    console.error('  Could not list Web apps:', list.status, JSON.stringify(list.json));
    console.error(consoleHelp());
    process.exit(1);
  }
  let webApp = (list.json.apps ?? []).find((a) => a.state !== 'DELETED');
  if (!webApp) {
    console.log('• Registering Web app "Ankveda Admin"…');
    const created = await googleFetch('POST', base, { displayName: 'Ankveda Admin' });
    if (created.status >= 300) {
      console.error('  Could not register the Web app:', created.status, JSON.stringify(created.json));
      console.error(consoleHelp());
      process.exit(1);
    }
    webApp = await waitForOperation(created.json.name);
  }
  const cfg = await googleFetch('GET', `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps/${webApp.appId}/config`);
  if (cfg.status >= 300) throw new Error(`Could not read Web app config: ${JSON.stringify(cfg.json)}`);
  const { apiKey, authDomain, projectId: pid, appId, messagingSenderId, storageBucket } = cfg.json;
  const out = resolve(here, '..', '..', 'admin', 'src', 'lib', 'firebase-config.json');
  writeFileSync(out, `${JSON.stringify({ apiKey, authDomain, projectId: pid, appId, messagingSenderId, storageBucket }, null, 2)}\n`);
  console.log(`✓ Web app ${webApp.appId} — config written to admin/src/lib/firebase-config.json`);
};

const ensureAdminUser = async () => {
  const auth = getAuth(app);
  let user = await auth.getUserByEmail(email).catch((e) => (e.code === 'auth/user-not-found' ? null : Promise.reject(e)));

  if (flag('revoke')) {
    if (!user) return console.log(`• ${email} does not exist — nothing to revoke`);
    const { admin: _drop, ...rest } = user.customClaims ?? {};
    await auth.setCustomUserClaims(user.uid, rest);
    await auth.revokeRefreshTokens(user.uid);
    return console.log(`✓ Admin access removed from ${email} and its sessions revoked`);
  }

  const password = process.env.ADMIN_PASSWORD_INITIAL;
  if (!user || flag('reset-password')) {
    if (!password || password.length < 8) {
      console.error('Set ADMIN_PASSWORD_INITIAL (at least 8 characters) to create the account or reset its password.');
      process.exit(1);
    }
  }
  if (!user) {
    user = await auth.createUser({ email, password, emailVerified: true, displayName: 'Ankveda Admin' });
    console.log(`✓ Created ${email} (${user.uid})`);
  } else if (flag('reset-password')) {
    await auth.updateUser(user.uid, { password });
    console.log(`✓ Password reset for ${email}`);
  } else {
    console.log(`• ${email} already exists (${user.uid}) — password unchanged`);
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
  console.log(`✓ ${email} has the admin claim`);
};

try {
  console.log(`Project: ${projectId}${emulator ? ' (Auth emulator)' : ''}`);
  if (!emulator && !flag('skip-project-setup')) {
    await enableEmailPassword();
    await ensureWebAppConfig();
  }
  await ensureAdminUser();
} catch (error) {
  console.error('Provisioning failed:', error?.message ?? error);
  process.exit(1);
}
