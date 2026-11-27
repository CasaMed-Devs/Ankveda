import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { useAppAlert } from '@/components/AppAlert';
import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { ArrowCard } from '@/components/Cards';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { APP_NAME, SUPPORT_EMAIL } from '@/lib/config';
import { formatLongDate, formatPhone } from '@/lib/format';
import { LEGAL_DOC_KEYS, LEGAL_DOCS, openLegal } from '@/lib/legal';
import { queryClient, useEntitlement, useMe } from '@/lib/queries';
import { borderWidth, colors, radii } from '@/theme/tokens';

/** Ends the local session: token, cached data, back to the start. */
const endSession = async () => {
  await useAuthStore.getState().signOut();
  queryClient.clear();
  router.replace('/');
};

/** 21 · Profile */
export default function Profile() {
  const me = useMe();
  const { isPremium, entitlement } = useEntitlement();
  const alert = useAppAlert();
  const toast = useToast();
  const user = me.data;

  const openSupport = async () => {
    const number = (user?.phone ?? '').replace(/\D/g, '').slice(-10);
    const subject = `Support Request – ${APP_NAME}`;
    const body = [
      'Hi Support Team,',
      '',
      `My number is ${number}.`,
      'I am facing an issue with the application.',
      '',
      'Issue: [Describe your issue here]',
      '',
      'Please help me resolve this issue.',
      '',
      'Thank you.',
    ].join('\n');
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await Linking.openURL(url);
    } catch {
      alert({ title: 'No email app found', message: `Please email us at ${SUPPORT_EMAIL} from your email app.` });
    }
  };

  const confirmSignOut = () =>
    alert({
      title: 'Sign out of Ankveda?',
      message: 'You can sign back in anytime with your mobile number. Your readings stay saved.',
      actions: [
        {
          label: 'Sign out',
          onPress: async () => {
            await endSession();
            toast.info('You have been signed out.');
          },
        },
        { label: 'Cancel', style: 'cancel' },
      ],
    });

  const confirmDelete = () =>
    alert({
      title: 'Delete your account?',
      message: 'Your Ankveda account will be removed from the app.',
      bullets: [
        'Your profile, reports, chat and daily guidance will no longer be available.',
        ...(isPremium ? ['Your Ankveda Premium subscription will be cancelled now — no further charges and no refund.'] : []),
        'Signing in again with this number starts a brand-new account.',
        'This cannot be undone.',
      ],
      confirmText: 'DELETE',
      actions: [
        {
          label: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            // Errors (e.g. the subscription could not be cancelled) stay inside the alert.
            await api.deleteAccount();
            await endSession();
            toast.success('Your account has been deleted.');
          },
        },
        { label: 'Cancel', style: 'cancel' },
      ],
    });

  const premiumSubtitle = isPremium
    ? `${entitlement?.planName ?? 'Premium'} · ${entitlement?.cancelAtPeriodEnd ? 'ends' : 'renews'} ${
        entitlement?.currentPeriodEnd ? new Date(entitlement.currentPeriodEnd).toLocaleDateString('en-IN') : 'soon'
      }`
    : 'Manage your plan or explore all insights';

  return (
    <Screen withTabBar>
      <View style={styles.heading}>
        <AppText variant="eyebrow">Your journey</AppText>
        <View style={styles.identity}>
          <AppText variant="display" style={styles.name}>
            {user?.fullName ?? ' '}
          </AppText>
          <AppText variant="body">{user ? formatPhone(user.phone) : ''}</AppText>
        </View>
      </View>

      <View style={styles.rows}>
        <ArrowCard
          title="Personal details"
          subtitle={`${user?.dob ? `${formatLongDate(user.dob)} · ` : ''}Your information stays private`}
          onPress={() => router.push('/profile-details')}
        />
        <ArrowCard title="Ankveda Premium" subtitle={premiumSubtitle} onPress={() => router.push('/paywall')} />
        <ArrowCard title="Invoices" subtitle="Tax invoices for your trial and subscription" onPress={() => router.push('/invoices')} />
        <ArrowCard title="Help & support" subtitle="Facing an issue? Write to us" onPress={() => void openSupport()} />
      </View>

      <View style={styles.legal}>
        <AppText variant="eyebrow">Legal & policies</AppText>
        {LEGAL_DOC_KEYS.map((doc) => (
          <ArrowCard key={doc} title={LEGAL_DOCS[doc].title} subtitle={LEGAL_DOCS[doc].subtitle} onPress={() => openLegal(doc)} />
        ))}
      </View>

      <View style={styles.account}>
        <AppText variant="eyebrow">Account</AppText>
        <PrimaryButton label="Sign out" tone="card" onPress={confirmSignOut} />
        <Pressable
          onPress={confirmDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete account"
          accessibilityHint="Removes your account from Ankveda after confirmation"
          style={({ pressed }) => [styles.deleteRow, pressed && styles.pressed]}
        >
          <View style={styles.deleteText}>
            <AppText variant="bodyCream" color={colors.danger}>
              Delete account
            </AppText>
            <AppText variant="caption">Remove your account and data from the app</AppText>
          </View>
          <AppText variant="arrow" color={colors.danger}>
            →
          </AppText>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <AppText variant="small" align="center">
          <AppText variant="small" onPress={() => openLegal('terms')}>
            Terms of Service
          </AppText>
          {'   ·   '}
          <AppText variant="small" onPress={() => openLegal('privacy')}>
            Privacy Policy
          </AppText>
        </AppText>
        <AppText variant="caption" align="center" color={colors.gold}>
          Ancient wisdom, a little closer to you.
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 20 },
  identity: { gap: 16 },
  name: { fontSize: 42 },
  rows: { marginTop: 44, gap: 16 },
  legal: { marginTop: 36, gap: 16 },
  account: { marginTop: 36, gap: 14 },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: radii.button,
    borderWidth,
    borderColor: 'rgba(255, 155, 138, 0.45)',
    backgroundColor: 'rgba(255, 155, 138, 0.06)',
  },
  deleteText: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  footer: { marginTop: 36, gap: 22 },
});
