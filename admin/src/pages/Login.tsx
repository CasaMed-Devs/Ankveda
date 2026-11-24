import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { InlineAlert } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { errorMessage } from '@/lib/api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LoginPage = () => {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailError = touched && !EMAIL.test(email.trim()) ? 'Enter a valid email address.' : null;
  const passwordError = touched && password.length < 6 ? 'Enter your password (at least 6 characters).' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!EMAIL.test(email.trim()) || password.length < 6) return;
    setBusy(true);
    try {
      await auth.signIn(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_15%_10%,rgb(233_199_131/0.16),transparent_60%),radial-gradient(60%_50%_at_90%_90%,rgb(42_120_214/0.18),transparent_60%)]" />
        <svg className="pointer-events-none absolute -right-24 -bottom-24 size-[520px] text-gold-300/10" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="98" fill="none" stroke="currentColor" />
          <circle cx="100" cy="100" r="72" fill="none" stroke="currentColor" />
          <circle cx="100" cy="100" r="46" fill="none" stroke="currentColor" />
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="100" y1="2" x2="100" y2="28" stroke="currentColor" transform={`rotate(${i * 30} 100 100)`} />
          ))}
        </svg>
        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-gold-200 to-gold-400 font-display text-2xl font-bold text-navy-950">A</span>
          <span className="font-display text-3xl font-semibold tracking-wide text-gold-200">Ankveda</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="font-display text-5xl leading-[1.05] font-semibold text-white">The control room for every reading.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-400">
            Users, subscriptions, payments and pricing — straight from the live Ankveda database, with every change recorded in the audit log.
          </p>
        </div>
        <p className="relative flex items-center gap-2 text-[12px] text-slate-500">
          <ShieldCheck className="size-4 text-gold-300/70" /> Restricted to Ankveda administrators. Access is verified on the server for every request.
        </p>
      </section>

      <section className="relative flex items-center justify-center bg-surface px-5 py-12 sm:px-10">
        <ThemeToggle className="absolute top-4 right-4" />
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-navy-900 font-display text-xl font-bold text-gold-300 dark:bg-gold-300/10">A</span>
            <span className="font-display text-2xl font-semibold text-navy-900 dark:text-gold-200">Ankveda Admin</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-3">Use your administrator account.</p>

          {auth.status === 'forbidden' && (
            <InlineAlert tone="danger" className="mt-6">
              <strong>{auth.user.email}</strong> is signed in but is not an administrator.{' '}
              <button type="button" className="font-semibold underline" onClick={() => void auth.signOut()}>
                Use another account
              </button>
            </InlineAlert>
          )}

          <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
            <Field label="Email" htmlFor="email" error={emailError}>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@ankveda.in"
                aria-invalid={!!emailError}
                leading={<Mail className="size-4" />}
                autoFocus
              />
            </Field>
            <Field label="Password" htmlFor="password" error={passwordError}>
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!passwordError}
                leading={<LockKeyhole className="size-4" />}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
                    className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink"
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
              />
            </Field>
            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
            <Button type="submit" variant="primary" loading={busy} className="mt-2 h-11">
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-[12px] leading-relaxed text-ink-3">
            Forgot the password? Another administrator can reset it with <code className="text-[11px]">npm run admin:provision -- --reset-password</code>.
          </p>
        </div>
      </section>
    </div>
  );
};
