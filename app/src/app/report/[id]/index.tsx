import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { Screen } from '@/components/Screen';
import { toast } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { goHome, goReports } from '@/lib/navigation';
import { useEntitlement, useReport, useSaveReport } from '@/lib/queries';
import { getReportType } from '@/lib/report-types';
import { colors, fonts } from '@/theme/tokens';

/**
 * 22 · Report — complete. Also routes locked/processing reports to the right step,
 * so every "open report" link can simply push /report/:id.
 */
export default function ReportResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = useReport(id);
  const save = useSaveReport();
  const { isPremium } = useEntitlement();
  const data = report.data;

  if (report.isLoading) {
    return (
      <Screen headerAction={{ label: 'Reports', onPress: goReports }}>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 80 }} />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen headerAction={{ label: 'Reports', onPress: goReports }}>
        <Pressable onPress={() => void report.refetch()}>
          <AppText variant="small">We could not open this report. Tap to try again.</AppText>
        </Pressable>
      </Screen>
    );
  }

  if (data.status === 'processing' || data.status === 'failed') return <Redirect href={`/report/${id}/processing`} />;
  if (data.status === 'locked') return <Redirect href={isPremium ? `/report/${id}/unlock` : `/report/${id}/preview`} />;
  if (!data.content) return null;

  const config = getReportType(data.type);
  const content = data.content;
  const owner = data.input.fullName ?? '';

  return (
    <Screen
      headerAction={{ label: 'Reports', onPress: goReports }}
      footer={
        <>
          {data.saved ? (
            // Already saved: take the user home (closes the stacked report screens).
            <PrimaryButton label="Go to Home" onPress={goHome} />
          ) : (
            <PrimaryButton
              label="Save report"
              onPress={() =>
                save.mutate(
                  { id, saved: true },
                  {
                    onSuccess: () => toast.success('Report saved to your Reports.'),
                    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the report. Please try again.'),
                  },
                )
              }
              loading={save.isPending}
            />
          )}
          <AppText variant="caption" align="center" style={styles.basis}>
            {content.basis}
            {'\n'}For reflection and guidance, not a prediction.
          </AppText>
        </>
      }
    >
      <AppText variant="eyebrow">
        {`Your ${config?.title.replace(/ numerology$/i, '') ?? ''} report${owner ? ` · ${owner}` : ''}`}
      </AppText>

      <View style={styles.hero}>
        <Card style={styles.identity}>
          <View style={styles.identityText}>
            <View style={styles.identityCopy}>
              <AppText variant="title" style={styles.headline}>
                {content.headline}
              </AppText>
              <AppText variant="small" style={{ fontSize: 13 }}>
                {content.traits}
              </AppText>
            </View>
            <AppText variant="eyebrow" style={styles.calc}>
              {`${content.primary.label} · ${content.primary.calculation}`}
            </AppText>
          </View>
          <AppText style={styles.bigNumber} allowFontScaling={false}>
            {content.primary.value}
          </AppText>
        </Card>

        <View style={styles.numbers}>
          {content.numbers.slice(0, 3).map((n) => (
            <Card key={n.label} style={styles.numberCard}>
              <AppText style={styles.numberValue} allowFontScaling={false}>
                {n.value}
              </AppText>
              <AppText style={styles.numberLabel}>{n.label.toUpperCase()}</AppText>
            </Card>
          ))}
        </View>
      </View>

      <View style={styles.sections}>
        {content.sections.map((s) => (
          <View key={s.title} style={styles.section}>
            {s.eyebrow ? <AppText variant="eyebrow">{s.eyebrow}</AppText> : null}
            <AppText variant="cardTitle" style={{ fontSize: s.eyebrow ? 22 : 25, lineHeight: s.eyebrow ? 24 : 27 }}>
              {s.title}
            </AppText>
            <AppText variant="small" style={{ fontSize: 13, lineHeight: 19 }}>
              {s.body}
            </AppText>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 22, gap: 13 },
  identity: { flexDirection: 'row', alignItems: 'flex-end', padding: 18, paddingTop: 20, gap: 10 },
  identityText: { flex: 1, gap: 28 },
  identityCopy: { gap: 12 },
  headline: { fontSize: 32, lineHeight: 34 },
  calc: { fontSize: 9, letterSpacing: 1 },
  bigNumber: { fontFamily: fonts.serifMedium, fontSize: 104, lineHeight: 106, color: colors.gold, minWidth: 70, textAlign: 'center' },
  numbers: { flexDirection: 'row', gap: 14 },
  numberCard: { flex: 1, height: 83, alignItems: 'center', justifyContent: 'center', gap: 10 },
  numberValue: { fontFamily: fonts.serifMedium, fontSize: 32, lineHeight: 35, color: colors.gold },
  numberLabel: { fontFamily: fonts.sansRegular, fontSize: 8, lineHeight: 12, color: colors.muted, letterSpacing: 0.5 },
  sections: { marginTop: 28, gap: 28 },
  section: { gap: 12 },
  basis: { fontSize: 9, lineHeight: 13 },
});
