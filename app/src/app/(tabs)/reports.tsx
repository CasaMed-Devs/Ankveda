import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { ArrowCard, Badge, Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { Screen } from '@/components/Screen';
import { useReports } from '@/lib/queries';
import { reportStatusLine, reportTitle } from '@/lib/report-status';
import { REPORT_TYPES } from '@/lib/report-types';
import type { Report } from '@/lib/types';
import { colors } from '@/theme/tokens';

const STATUS_BADGE: Record<Report['status'], string> = {
  locked: 'Preview',
  processing: 'Preparing',
  complete: 'Ready',
  failed: 'Retry',
};

/** 19 · Reports — the user's personal library. */
export default function Reports() {
  const reports = useReports();
  const list = reports.data ?? [];
  const [featured, ...rest] = list;
  // Saved (bookmarked) reports first, then newest.
  const others = [...rest].sort((a, b) => Number(b.saved) - Number(a.saved));

  return (
    <Screen withTabBar>
      <Heading
        eyebrow="Your personal library"
        title={'Your reports.\nYour story.'}
        subtitle="Every insight, in one considered space."
      />

      <View style={styles.list}>
        {reports.isLoading ? (
          <ActivityIndicator color={colors.gold} style={styles.loader} />
        ) : reports.isError ? (
          <Pressable onPress={() => void reports.refetch()}>
            <AppText variant="small">We could not load your reports. Tap to try again.</AppText>
          </Pressable>
        ) : featured ? (
          <>
            <Card style={styles.featured} onPress={() => router.push(`/report/${featured.id}`)}>
              <View style={styles.featuredTop}>
                <View style={styles.featuredTitleRow}>
                  <AppText variant="cardTitle" color={colors.gold} style={styles.featuredTitle}>
                    {reportTitle(featured)}
                  </AppText>
                  <Badge label={STATUS_BADGE[featured.status]} />
                </View>
                <AppText variant="bodyCream">{reportStatusLine(featured)}</AppText>
              </View>
              <AppText variant="small">
                {featured.status === 'complete' ? 'Open your reading  →' : 'View preview or generation status  →'}
              </AppText>
            </Card>
            {others.map((report) => (
              <ArrowCard
                key={report.id}
                title={`${reportTitle(report)}${report.saved ? '  ★' : ''}`}
                subtitle={reportStatusLine(report)}
                onPress={() => router.push(`/report/${report.id}`)}
              />
            ))}
          </>
        ) : (
          <Card style={styles.empty}>
            <AppText variant="cardTitle">Your first reading awaits.</AppText>
            <AppText variant="small">Choose a report to begin. Every reading you create will live here.</AppText>
          </Card>
        )}
      </View>

      <View style={styles.cta}>
        <PrimaryButton
          tone="solid"
          label={`Explore all ${REPORT_TYPES.length === 7 ? 'seven' : REPORT_TYPES.length} reports  →`}
          onPress={() => router.push('/report/choose')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 40, gap: 16 },
  loader: { marginVertical: 40 },
  featured: { paddingTop: 20, paddingBottom: 30, paddingHorizontal: 18, gap: 30, marginBottom: 16 },
  featuredTop: { gap: 16 },
  featuredTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  featuredTitle: { fontSize: 28, lineHeight: 30, flexShrink: 1 },
  empty: { padding: 18, gap: 10 },
  cta: { marginTop: 32 },
});
