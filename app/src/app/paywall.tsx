import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { LinkButton, PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { Loader } from '@/components/Loader';
import { PlanCard } from '@/components/PlanCard';
import { Screen } from '@/components/Screen';
import { usePremiumCheckout } from '@/hooks/usePremiumCheckout';
import { appAlert } from '@/components/AppAlert';
import { toast } from '@/components/Toast';
import { analytics } from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import { describePlan } from '@/lib/plans';
import { applyUser, useEntitlement, useFeaturedPlan } from '@/lib/queries';
import { borderWidth, colors, radii } from '@/theme/tokens';

// Figma's third benefit mentioned Kundali; Kundali is out of scope for v1, so it now describes Chat.
const BENEFITS = [
  { title: 'Every numerology report', body: 'Name, phone, birth date, compatibility, career, future & car' },
  { title: 'Guidance, every day', body: 'Personal numbers, dates and remedies' },
  { title: 'Your personal astrologer', body: 'Chat 1:1 with expert astrologers, anytime' },
];

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/home'));

/** 06 · Subscription — one featured plan from the backend (price, duration and trial are dynamic). */
export default function Paywall() {
  const { reportId } = useLocalSearchParams<{ reportId?: string }>();
  const plan = useFeaturedPlan();
  const { isPremium, entitlement } = useEntitlement();
  const { checkout, busy } = usePremiumCheckout(reportId);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    analytics.logViewContent('paywall');
  }, []);

  const restore = async () => {
    setRestoring(true);
    try {
      const { user, restored } = await api.restorePurchases();
      applyUser(user);
      if (restored) {
        toast.success('Welcome back — your Ankveda Premium access is active again.');
        goBack();
      } else appAlert({ title: 'Restore purchases', message: 'We could not find an active subscription on this number.' });
    } catch (e) {
      appAlert({ title: 'Restore purchases', message: e instanceof ApiError ? e.message : 'Please try again.' });
    } finally {
      setRestoring(false);
    }
  };

  if (isPremium && entitlement) return <MembershipView reportId={reportId} />;

  const copy = plan.data ? describePlan(plan.data) : null;

  return (
    <Screen
      footer={
        <>
          {plan.data && copy ? (
            <PrimaryButton label={copy.cta} onPress={() => void checkout(plan.data!)} loading={busy} />
          ) : null}
          <LinkButton label="Continue with free experience" onPress={goBack} />
          <AppText variant="caption" align="center" style={styles.fineprint}>
            Auto-renews. Cancel anytime.{'  ·  '}
            <AppText variant="caption" style={styles.fineprint} onPress={restoring ? undefined : restore}>
              {restoring ? 'Restoring…' : 'Restore purchases'}
            </AppText>
          </AppText>
        </>
      }
    >
      <View style={styles.top}>
        <View style={styles.pill}>
          <AppText variant="eyebrow" style={{ letterSpacing: 1.7 }}>
            Ankveda Premium
          </AppText>
        </View>
        <Heading title={'Go deeper.\nLive more aligned.'} subtitle="Unlock all numerology insights." />
      </View>

      <View style={styles.benefits}>
        {BENEFITS.map((b, i) => (
          <View key={b.title} style={styles.benefit}>
            <AppText variant="label" style={styles.benefitIndex}>
              {String(i + 1).padStart(2, '0')}
            </AppText>
            <View style={styles.benefitText}>
              <AppText variant="cardTitle" style={{ fontSize: 23, lineHeight: 25 }}>
                {b.title}
              </AppText>
              <AppText variant="small">{b.body}</AppText>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.plan}>
        {plan.isLoading ? (
          <Loader size="sm" />
        ) : plan.data ? (
          <PlanCard plan={plan.data} />
        ) : (
          <Card style={styles.noPlan} onPress={() => void plan.refetch()}>
            <AppText variant="small">
              {plan.isError ? 'We could not load plans. Tap to try again.' : 'Premium plans are being prepared. Please check back soon.'}
            </AppText>
          </Card>
        )}
      </View>
    </Screen>
  );
}

/** Shown on the same route when the user already has Premium (Profile → Ankveda Premium). */
const MembershipView = ({ reportId }: { reportId?: string }) => {
  const { entitlement } = useEntitlement();
  const plan = useFeaturedPlan();
  const { checkout, busy } = usePremiumCheckout(reportId);
  const [cancelling, setCancelling] = useState(false);
  // Renewal cancelled but days left: the user may start a new subscription now (no trial the second time).
  const resubscribe = entitlement?.cancelAtPeriodEnd && plan.data ? describePlan(plan.data) : null;
  const endDate = entitlement?.currentPeriodEnd ? new Date(entitlement.currentPeriodEnd).toLocaleDateString('en-IN') : '';

  const cancel = () =>
    appAlert({
      title: 'Cancel your subscription?',
      message: `You keep Premium until ${endDate || 'the end of this period'}. It will not renew and you won't be charged again.`,
      actions: [
        {
          label: 'Cancel renewal',
          style: 'destructive',
          // Progress and any error are shown inside the alert.
          onPress: async () => {
            setCancelling(true);
            try {
              const { user } = await api.cancelSubscription();
              applyUser(user);
              toast.success(`Renewal cancelled. Premium stays active until ${endDate || 'the end of this period'}.`);
            } finally {
              setCancelling(false);
            }
          },
        },
        { label: 'Keep Premium', style: 'cancel' },
      ],
    });

  return (
    <Screen
      footer={
        <>
          {resubscribe && plan.data ? (
            <PrimaryButton label={resubscribe.cta} onPress={() => void checkout(plan.data!)} loading={busy} />
          ) : null}
          <PrimaryButton label="Continue" tone={resubscribe ? 'card' : 'gradient'} onPress={goBack} />
          {!entitlement?.cancelAtPeriodEnd ? (
            <LinkButton label={cancelling ? 'Cancelling…' : 'Cancel auto-renewal'} onPress={cancel} />
          ) : null}
        </>
      }
    >
      <View style={styles.top}>
        <View style={styles.pill}>
          <AppText variant="eyebrow" style={{ letterSpacing: 1.7 }}>
            Ankveda Premium
          </AppText>
        </View>
        <Heading title={'You’re aligned.\nEnjoy every insight.'} subtitle="All reports, daily guidance and Chat are unlocked." />
      </View>
      <Card style={styles.membership}>
        <AppText variant="cardTitle">{entitlement?.planName ?? 'Premium'}</AppText>
        <AppText variant="small">
          {entitlement?.cancelAtPeriodEnd ? `Access ends on ${endDate}` : endDate ? `Renews on ${endDate}` : 'Active'}
        </AppText>
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  top: { gap: 12 },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.cardSoft,
    borderWidth,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  benefits: { marginTop: 32, gap: 20 },
  benefit: { flexDirection: 'row', gap: 12 },
  benefitIndex: { width: 30, fontSize: 13 },
  benefitText: { flex: 1, gap: 6 },
  plan: { marginTop: 'auto', paddingTop: 40 },
  noPlan: { padding: 18 },
  membership: { marginTop: 40, padding: 18, gap: 8 },
  fineprint: { fontSize: 9, lineHeight: 13 },
});
