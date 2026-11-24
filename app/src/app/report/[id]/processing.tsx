import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { Heading } from '@/components/Heading';
import { FooterNote, Screen } from '@/components/Screen';
import { goHome } from '@/lib/navigation';
import { useGenerateReport, useReport } from '@/lib/queries';
import { getReportType } from '@/lib/report-types';
import type { ReportStage } from '@/lib/types';
import { colors } from '@/theme/tokens';

const STAGE_ORDER: ReportStage[] = ['received', 'numbers', 'writing', 'done'];
const PROGRESS: Record<ReportStage, number> = { received: 0.34, numbers: 0.66, writing: 0.86, done: 1 };

/** 16 · Report — processing. Polls the backend every 3s and opens the report when ready. */
export default function Processing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = useReport(id);
  const retry = useGenerateReport();
  const data = report.data;
  const stage = data?.stage ?? 'received';
  const reached = (s: ReportStage) => STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(s);

  useEffect(() => {
    if (data?.status === 'complete') router.replace(`/report/${id}`);
  }, [data?.status, id]);

  const failed = data?.status === 'failed';

  const steps = [
    { label: 'Details received', done: true },
    { label: 'Payment confirmed · Access unlocked', done: true },
    { label: 'Connecting your personal numbers', done: reached('writing') },
    { label: 'Preparing your insights', done: reached('done') },
  ];

  return (
    <Screen
      footer={
        <>
          <FooterNote>
            You can leave this screen.{'\n'}Your report will appear in Reports when ready.
          </FooterNote>
          {failed ? (
            <PrimaryButton label="Try again" onPress={() => retry.mutate(id)} loading={retry.isPending} />
          ) : (
            <PrimaryButton label="Go to Home" onPress={goHome} />
          )}
        </>
      }
    >
      <Heading eyebrow="Personal analysis" title={'Your numbers\nare coming together.'} subtitle="Your report is being prepared." />

      <View style={styles.progressBlock}>
        <AppText variant="cardTitle" color={colors.gold} style={styles.typeTitle}>
          {getReportType(data?.type)?.title ?? ' '}
        </AppText>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(PROGRESS[stage] * 100) }}>
          <View style={[styles.fill, { width: `${PROGRESS[stage] * 100}%` }]} />
        </View>
      </View>

      <View style={styles.steps}>
        {steps.map((step, i) => (
          <View key={step.label} style={styles.step}>
            <AppText variant="label" style={styles.marker}>
              {step.done ? '✓' : String(i).padStart(2, '0')}
            </AppText>
            <AppText variant="bodyCream" style={[styles.stepLabel, !step.done && i === 3 && { color: colors.muted }]}>
              {step.label}
            </AppText>
          </View>
        ))}
      </View>

      {failed ? (
        <AppText variant="small" color={colors.danger} style={styles.error}>
          {data?.error ?? 'We could not finish your report. Please try again.'}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressBlock: { marginTop: 36, gap: 36 },
  typeTitle: { fontSize: 27, lineHeight: 29 },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.progressTrack, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.gold },
  steps: { marginTop: 48, gap: 36 },
  step: { flexDirection: 'row', alignItems: 'flex-end', gap: 24 },
  marker: { width: 22, fontSize: 13 },
  stepLabel: { flex: 1, fontSize: 15 },
  error: { marginTop: 24 },
});
