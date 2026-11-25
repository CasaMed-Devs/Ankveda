import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ArrowCard, Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { Loader } from '@/components/Loader';
import { LockBadge } from '@/components/LockedPanel';
import { Screen } from '@/components/Screen';
import { firstName } from '@/lib/format';
import { useHome, useMe, useReports } from '@/lib/queries';
import { reportStatusLine, reportTitle } from '@/lib/report-status';
import { colors, fonts } from '@/theme/tokens';

/** 17 · Home */
export default function Home() {
  const me = useMe();
  const home = useHome();
  const reports = useReports();
  const latest = reports.data?.[0];
  const name = firstName(me.data?.fullName);

  return (
    <Screen withTabBar>
      <Heading eyebrow="Your daily companion" title={name ? `Namaste, ${name}` : 'Namaste'} gap={16} />

      <View style={styles.birthCardWrap}>
        {home.isLoading ? (
          <Card style={[styles.birthCard, styles.center]}>
            <Loader size="sm" />
          </Card>
        ) : home.data && !home.data.locked && home.data.birthNumber ? (
          <Card style={styles.birthCard}>
            <View style={styles.birthText}>
              <AppText variant="eyebrow" style={{ letterSpacing: 0 }}>
                Your birth number
              </AppText>
              <View style={styles.birthCopy}>
                <AppText variant="title">{home.data.birthTitle}</AppText>
                {home.data.birthMessage ? (
                  <AppText variant="small" style={styles.birthMessage}>
                    {home.data.birthMessage}
                  </AppText>
                ) : (
                  // Today's report is being generated (the app started it on open); fills in when ready.
                  <View style={styles.pending}>
                    <Loader size="xs" style={styles.pendingLoader} />
                    <AppText variant="small" style={styles.birthMessage}>
                      Preparing today’s guidance…
                    </AppText>
                  </View>
                )}
              </View>
            </View>
            <AppText style={styles.birthNumber} allowFontScaling={false}>
              {home.data.birthNumber}
            </AppText>
          </Card>
        ) : home.isError ? (
          <Card style={styles.birthCard} onPress={() => void home.refetch()}>
            <AppText variant="small">We could not load today’s guidance. Tap to try again.</AppText>
          </Card>
        ) : (
          <Card style={styles.birthCard} onPress={() => router.push('/paywall')} accessibilityLabel="Unlock your birth number">
            <View style={styles.birthText}>
              <AppText variant="eyebrow" style={{ letterSpacing: 0 }}>
                Your birth number
              </AppText>
              <View style={styles.birthCopy}>
                <AppText variant="title">A number that is yours.</AppText>
                <AppText variant="small" style={styles.birthMessage}>
                  Unlock Premium to reveal your birth number and a little guidance every day.
                </AppText>
              </View>
            </View>
            <LockBadge />
          </Card>
        )}
      </View>

      {latest ? (
        <View style={[styles.section, styles.firstSection]}>
          <AppText variant="title">Your reports</AppText>
          <ArrowCard
            title={reportTitle(latest)}
            subtitle={reportStatusLine(latest)}
            onPress={() => router.push(`/report/${latest.id}`)}
          />
        </View>
      ) : null}

      <View style={[styles.section, !latest && styles.firstSection]}>
        <AppText variant="title" style={{ fontSize: 28 }}>
          Explore your numbers
        </AppText>
        <ArrowCard
          title="Discover your next chapter"
          subtitle="Name · Phone · Birth date · Compatibility & more"
          onPress={() => router.push('/report/choose')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  birthCardWrap: { marginTop: 28 },
  birthCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    minHeight: 160,
    gap: 12,
  },
  center: { justifyContent: 'center' },
  birthText: { flex: 1, gap: 20 },
  birthCopy: { gap: 16 },
  birthMessage: { fontSize: 13, lineHeight: 19 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingLoader: { alignSelf: 'auto' },
  birthNumber: {
    minWidth: 70,
    fontFamily: fonts.serifMedium,
    fontSize: 104,
    lineHeight: 110,
    color: colors.gold,
    textAlign: 'center',
  },
  section: { marginTop: 24, gap: 16 },
  firstSection: { marginTop: 48 },
});
