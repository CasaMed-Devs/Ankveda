import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { LinkButton, PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { Loader } from '@/components/Loader';
import { PlanCard } from '@/components/PlanCard';
import { Screen } from '@/components/Screen';
import { usePremiumCheckout } from '@/hooks/usePremiumCheckout';
import { goReports } from '@/lib/navigation';
import { describePlan } from '@/lib/plans';
import { useEntitlement, useFeaturedPlan, useGenerateReport, useReport } from '@/lib/queries';
import { getReportType, UNLOCK_BENEFITS } from '@/lib/report-types';
import { colors } from '@/theme/tokens';

/** 14 · Unlock personalised report — subscribe to the featured plan to generate this report. */
export default function UnlockReport() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = useReport(id);
  const plan = useFeaturedPlan();
  const { checkout, busy } = usePremiumCheckout(id);
  const { isPremium } = useEntitlement();
  const generate = useGenerateReport();
  const config = getReportType(report.data?.type);
  const copy = plan.data ? describePlan(plan.data) : null;

  // Premium members (e.g. report created before subscribing) just generate it.
  const reveal = () =>
    generate.mutate(id, { onSuccess: () => router.replace(`/report/${id}/processing`) });

  return (
    <Screen
      headerAction={{ label: 'Reports', onPress: goReports }}
      footer={
        <>
          {isPremium ? (
            <PrimaryButton label="Reveal my report" onPress={reveal} loading={generate.isPending} />
          ) : plan.data && copy ? (
            <PrimaryButton label={copy.cta} onPress={() => void checkout(plan.data!)} loading={busy} />
          ) : (
            <PrimaryButton label="See Premium plans" onPress={() => router.push('/paywall')} />
          )}
          {!isPremium ? (
            <LinkButton label="View preview without paying" onPress={() => router.replace(`/report/${id}/preview`)} />
          ) : null}
        </>
      }
    >
      <Heading eyebrow="Your personalised report" title={'There’s more\nto your story.'} subtitle="Unlock this personalised report." />

      <View style={styles.body}>
        <Card style={styles.summary}>
          <AppText variant="cardTitle" color={colors.gold} style={styles.summaryTitle}>
            {config?.title ?? ' '}
          </AppText>
          <AppText variant="small" style={{ fontSize: 13 }}>
            {config?.tagline ?? ''}
          </AppText>
        </Card>

        <View style={styles.benefits}>
          {UNLOCK_BENEFITS.map((b) => (
            <View key={b} style={styles.benefit}>
              <AppText variant="label" style={styles.check}>
                ✓
              </AppText>
              <AppText variant="bodyCream">{b}</AppText>
            </View>
          ))}
        </View>

        {isPremium ? null : plan.isLoading ? (
          <Loader size="sm" />
        ) : plan.data ? (
          <PlanCard plan={plan.data} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: 32, gap: 32 },
  summary: { paddingHorizontal: 17, paddingVertical: 15, gap: 10 },
  summaryTitle: { fontSize: 28, lineHeight: 30 },
  benefits: { gap: 22 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  check: { fontSize: 15 },
});
