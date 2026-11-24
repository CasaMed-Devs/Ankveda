import { BlurTargetView, BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, type ComponentRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { LinkButton, PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { LockBadge } from '@/components/LockedPanel';
import { Screen } from '@/components/Screen';
import { usePremiumCheckout } from '@/hooks/usePremiumCheckout';
import { goHome, goReports } from '@/lib/navigation';
import { useFeaturedPlan, useReport } from '@/lib/queries';
import { getReportType, PREVIEW_SECTIONS } from '@/lib/report-types';
import { formatRupees } from '@/lib/format';
import { colors } from '@/theme/tokens';

/** 15 · Report — locked preview (free users see only the first section). */
export default function LockedPreview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = useReport(id);
  const plan = useFeaturedPlan();
  const { checkout, busy } = usePremiumCheckout(id);
  const blurTarget = useRef<ComponentRef<typeof View>>(null);
  const config = getReportType(report.data?.type);
  const [first, ...hidden] = PREVIEW_SECTIONS;

  const price = plan.data
    ? formatRupees(plan.data.trialDays > 0 && plan.data.trialPriceInPaise > 0 ? plan.data.trialPriceInPaise : plan.data.priceInPaise)
    : '';

  return (
    <Screen
      headerAction={{ label: 'Reports', onPress: goReports }}
      footer={
        <>
          <PrimaryButton
            label={price ? `Unlock my report · ${price}` : 'Unlock my report'}
            onPress={() => (plan.data ? void checkout(plan.data) : router.push({ pathname: '/paywall', params: { reportId: id } }))}
            loading={busy}
          />
          <LinkButton label="Continue to Home" onPress={goHome} size={13} />
        </>
      }
    >
      <Heading
        eyebrow="Report preview · Locked"
        title={'Your story is\nwaiting for you.'}
        subtitle="A glimpse of what your reading explores."
      />

      {report.isLoading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.body}>
          <AppText variant="cardTitle" color={colors.gold} style={styles.typeTitle}>
            {config?.title ?? 'Your report'}
          </AppText>
          <Card style={styles.card}>
            <AppText variant="cardTitle" style={{ fontSize: 25, lineHeight: 27 }}>
              Inside your personal reading
            </AppText>
            <PreviewItem index="01" title={first.title} body={first.body} />

            <View style={styles.lockedArea}>
              <BlurTargetView ref={blurTarget} style={styles.lockedItems}>
                {hidden.map((s, i) => (
                  <PreviewItem key={s.title} index={String(i + 2).padStart(2, '0')} title={s.title} body={s.body} />
                ))}
              </BlurTargetView>
              <BlurView
                blurTarget={blurTarget}
                intensity={18}
                tint="dark"
                blurMethod="dimezisBlurViewSdk31Plus"
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.lockCentre} pointerEvents="none">
                <LockBadge />
              </View>
            </View>
          </Card>
          <AppText variant="small" align="center">
            Your full reading stays locked until you unlock it.
          </AppText>
        </View>
      )}
    </Screen>
  );
}

const PreviewItem = ({ index, title, body }: { index: string; title: string; body: string }) => (
  <View style={styles.item}>
    <AppText variant="label" style={{ fontSize: 14 }}>
      {`${index}   ${title}`}
    </AppText>
    <AppText variant="small" style={{ fontSize: 13 }}>
      {body}
    </AppText>
  </View>
);

const styles = StyleSheet.create({
  body: { marginTop: 32, gap: 24 },
  typeTitle: { fontSize: 28, lineHeight: 30 },
  card: { paddingHorizontal: 20, paddingVertical: 22, gap: 19 },
  item: { gap: 6 },
  lockedArea: { borderRadius: 8, overflow: 'hidden' },
  lockedItems: { gap: 12, opacity: 0.7 },
  lockCentre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
