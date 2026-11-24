import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { Database, KeyRound, Moon, Palette, RefreshCw, Search, Server, ShieldCheck, Sun, Wrench } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { DescList, PageIntro } from '@/components/layout/Page';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { CopyText, InlineAlert, Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Segmented } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Overlay';
import { errorMessage } from '@/lib/api';
import { addDays, dateTime, istKey } from '@/lib/format';
import { useMaintenance, useSystem } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

const Status = ({ ok, yes, no }: { ok: boolean; yes: string; no: string }) => <Badge tone={ok ? 'success' : 'warning'}>{ok ? yes : no}</Badge>;

const Block = ({ icon: Icon, title, description, children }: { icon: typeof Server; title: string; description: string; children: ReactNode }) => (
  <Card>
    <CardHeader
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-ink-3" />
          {title}
        </span>
      }
      description={description}
    />
    <div className="px-5 pb-5">{children}</div>
  </Card>
);

const ChangePassword = () => {
  const auth = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weak = next.length > 0 && (next.length < 10 || !/[A-Za-z]/.test(next) || !/\d/.test(next));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (auth.status !== 'admin' || !auth.user.email) return;
    setError(null);
    if (weak) return setError('Use at least 10 characters with letters and numbers.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await reauthenticateWithCredential(auth.user, EmailAuthProvider.credential(auth.user.email, current));
      await updatePassword(auth.user, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password changed');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'The current password is wrong.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Field label="Current password" htmlFor="pw-current">
        <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="New password" htmlFor="pw-new" hint="10+ characters, letters and numbers" error={weak ? 'Too weak' : null}>
        <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </Field>
      <Field label="Confirm new password" htmlFor="pw-confirm">
        <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      {error && <InlineAlert tone="danger" className="md:col-span-3">{error}</InlineAlert>}
      <div className="md:col-span-3">
        <Button type="submit" variant="primary" icon={KeyRound} loading={busy} disabled={!current || !next || !confirm}>
          Change password
        </Button>
      </div>
    </form>
  );
};

const Appearance = () => {
  const { theme, setTheme } = useTheme();
  return (
    <Block icon={Palette} title="Appearance" description="Saved in this browser. Dark is the default.">
      <Segmented
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" /> Dark</span> },
          { value: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun className="size-3.5" /> Light</span> },
        ]}
      />
    </Block>
  );
};

export const SettingsPage = () => {
  const auth = useAuth();
  const system = useSystem();
  const maintenance = useMaintenance();
  const toast = useToast();
  const s = system.data;
  const user = auth.status === 'admin' ? auth.user : null;

  return (
    <>
      <PageIntro description="Your admin account, the backend this dashboard is connected to, and maintenance tasks." />
      <div className="flex flex-col gap-6">
        <Block icon={ShieldCheck} title="Admin account" description="Signed in with Firebase Authentication. Admin access comes from a server-set custom claim.">
          <DescList
            items={[
              { label: 'Email', value: user?.email ?? '—' },
              { label: 'Firebase UID', value: <CopyText value={user?.uid} truncate={false} /> },
              { label: 'Last sign-in', value: user?.metadata.lastSignInTime ? dateTime(Date.parse(user.metadata.lastSignInTime)) : '—' },
              { label: 'Account created', value: user?.metadata.creationTime ? dateTime(Date.parse(user.metadata.creationTime)) : '—' },
            ]}
          />
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-3 text-[13px] font-semibold">Change password</p>
            <ChangePassword />
          </div>
        </Block>

        <Appearance />

        <Block icon={Server} title="System status" description="Reported by the backend you are connected to.">
          {system.isLoading ? (
            <Skeleton className="h-24" />
          ) : s ? (
            <DescList
              items={[
                { label: 'Environment', value: <Badge tone={s.environment === 'production' ? 'success' : 'warning'}>{s.environment}</Badge> },
                { label: 'Firestore database', value: <code className="text-[12px]">{s.firestoreDatabaseId}</code> },
                { label: 'Razorpay API keys', value: <Status ok={s.razorpayConfigured} yes={s.razorpayKeyMode === 'live' ? 'Configured · LIVE' : 'Configured · test'} no="Not configured" /> },
                { label: 'Razorpay webhook secret', value: <Status ok={s.razorpayWebhookConfigured} yes="Configured" no="Not configured" /> },
                { label: 'Report generation', value: s.reportRunner },
                { label: 'Database access', value: 'Server only — Firestore rules deny every client' },
              ]}
            />
          ) : (
            <InlineAlert tone="danger">{errorMessage(system.error)}</InlineAlert>
          )}
        </Block>

        <Block icon={Wrench} title="Maintenance" description="Safe to run any time. Each run is recorded in Admin Activity.">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line p-4">
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                <Search className="size-4 text-ink-3" /> Rebuild name search
              </p>
              <p className="mt-1 text-[12px] text-ink-3">Indexes the names of users created before search existed. Reads every user once.</p>
              <Button
                size="sm"
                className="mt-3"
                loading={maintenance.backfillSearch.isPending}
                onClick={() =>
                  maintenance.backfillSearch.mutate(undefined, {
                    onSuccess: (r) => toast.success('Search index rebuilt', `${r.updated} of ${r.scanned} users updated.`),
                    onError: (e) => toast.error('Rebuild failed', errorMessage(e)),
                  })
                }
              >
                Run
              </Button>
            </div>
            <div className="rounded-xl border border-line p-4">
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                <Database className="size-4 text-ink-3" /> Recompute statistics (last 90 days)
              </p>
              <p className="mt-1 text-[12px] text-ink-3">Recalculates the cached daily figures — use after a user deletion or a late refund changed older days.</p>
              <Button
                size="sm"
                icon={RefreshCw}
                className="mt-3"
                loading={maintenance.rebuildStats.isPending}
                onClick={() =>
                  maintenance.rebuildStats.mutate(
                    { from: addDays(istKey(), -89), to: istKey() },
                    {
                      onSuccess: (r) => toast.success('Statistics recomputed', `${r.days} days recalculated.`),
                      onError: (e) => toast.error('Recompute failed', errorMessage(e)),
                    },
                  )
                }
              >
                Recompute
              </Button>
            </div>
          </div>
        </Block>
      </div>
    </>
  );
};
