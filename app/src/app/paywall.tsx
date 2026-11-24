import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { LinkButton, PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { PlanCard } from '@/components/PlanCard';
import { Screen } from '@/components/Screen';
import { usePremiumCheckout } from '@/hooks/usePremiumCheckout';
import { api, ApiError } from '@/lib/api';
import { describePlan } from '@/lib/plans';
import { applyUser, useEntitlement, useFeaturedPlan } from '@/lib/queries';
import { borderWidth, colors, radii } from '@/theme/tokens';

// Figma's third benefit mentioned Kundali; Kundali is out of scope for v1, so it now describes Chat.
const BENEFITS = [
  { title: 'Every numerology report', body: 'Name, phone, birth date, compatibility, career, future & car' },
  { title: 'Guidance, every day', body: 'Personal numbers, dates and remedies' },
  { title: 'Your personal astrologer', body: 'Ask anything about your numbers in Chat' },
];

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/home'));

/** 06 · Subscription — one featured plan from the backend (price, duration and trial are dynamic). */
export default function Paywall() {
  const { reportId } = useLocalSearchParams<{ reportId?: string }>();
  const plan = useFeaturedPlan();
  const { isPremium, entitlement } = useEntitlement();
  const { checkout, busy } = usePremiumCheckout(reportId);
  const [restoring, setRestoring] = useState(false);

  const restore = async () => {
    setRestoring(true);
    try {
      const { user, restored } = await api.restorePurchases();
      applyUser(user);
      if (restored) goBack();
      else Alert.alert('Restore purchases', 'We could not find an active subscription on this number.');
    } catch (e) {
      Alert.alert('Restore purchases', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setRestoring(false);
    }
  };

  if (isPremium && entitlement) return <MembershipView />;

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
          <ActivityIndicator color={colors.gold} />
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
const MembershipView = () => {
  const { entitlement } = useEntitlement();
  const [cancelling, setCancelling] = useState(false);
  const endDate = entitlement?.currentPeriodEnd ? new Date(entitlement.currentPeriodEnd).toLocaleDateString('en-IN') : '';

  const cancel = () => {
    Alert.alert('Cancel subscription', `You keep Premium until ${endDate || 'the end of this period'}. It will not renew.`, [
      { text: 'Keep Premium', style: 'cancel' },
      {
        text: 'Cancel renewal',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          try {
            const { user } = await api.cancelSubscription();
            applyUser(user);
          } catch (e) {
            Alert.alert('Cancel subscription', e instanceof ApiError ? e.message : 'Please try again.');
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen
      footer={
        <>
          <PrimaryButton label="Continue" onPress={goBack} />
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
  plan: { marginTop: 40 },
  noPlan: { padding: 18 },
  membership: { marginTop: 40, padding: 18, gap: 8 },
  fineprint: { fontSize: 9, lineHeight: 13 },
});
