import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { DailyLoading } from '@/components/DailyLoading';
import { Heading } from '@/components/Heading';
import { LockedPanel } from '@/components/LockedPanel';
import { Screen } from '@/components/Screen';
import { ApiError } from '@/lib/api';
import { useDaily } from '@/lib/queries';
import { colors, fonts } from '@/theme/tokens';

const EYEBROW = 'A little nudge from the universe';

/**
 * 20 · Daily guidance — one report per user per IST day, made from astrologyapi.com numerology + OpenAI
 * using the user's details. Fetched automatically when the app opens (see (tabs)/_layout). Premium only.
 */
export default function Daily() {
  const daily = useDaily();
  const data = daily.data?.daily;
  // First load, or a retry after an error: show the medallion while the report is generated.
  const generating = daily.isPending || (daily.isFetching && !daily.data);

  return (
    <Screen withTabBar>
      {data ? (
        <Heading eyebrow={EYEBROW} title={data.theme} subtitle="A little intention can change your day." />
      ) : (
        // No placeholder headline while loading — the real theme appears with the report.
        <AppText variant="eyebrow">{EYEBROW}</AppText>
      )}

      <View style={styles.body}>
        {generating ? (
          <DailyLoading />
        ) : daily.isError ? (
          <View style={styles.error}>
            <AppText variant="bodyCream" align="center">
              {daily.error instanceof ApiError ? daily.error.message : 'We could not load today’s guidance.'}
            </AppText>
            <PrimaryButton label="Try again" tone="card" onPress={() => void daily.refetch()} />
          </View>
        ) : daily.data?.locked || !data ? (
          <LockedPanel
            title="Your lucky number, every day."
            body="Lucky numbers, timings and a short reflection made personal to your birth date."
          />
        ) : (
          <>
            <Card style={styles.luckyCard}>
              <View style={styles.luckyNumber}>
                <AppText style={styles.bigNumber} allowFontScaling={false}>
                  {data.luckyNumber}
                </AppText>
                <AppText style={styles.luckyLabel}>LUCKY NUMBER</AppText>
              </View>
              <View style={styles.luckyTime}>
                <AppText style={styles.time} allowFontScaling={false}>
                  {data.luckyTime}
                </AppText>
                <AppText style={styles.luckyLabel}>LUCKY TIMING</AppText>
              </View>
            </Card>
            <Card style={styles.reflection}>
              <AppText variant="cardTitle" style={styles.reflectionTitle}>
                {data.title}
              </AppText>
              <AppText variant="small" style={styles.reflectionBody}>
                {data.message}
              </AppText>
            </Card>
            <AppText variant="caption" align="center">
              A new reading arrives every day at midnight.
            </AppText>
          </>
        )}
      </View>

      <AppText variant="caption" align="center" style={styles.note}>
        For reflection and guidance, not a prediction.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: 40, gap: 16 },
  error: { gap: 20, paddingVertical: 24 },
  luckyCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: 16,
  },
  luckyNumber: { gap: 6, flexShrink: 1 },
  luckyTime: { width: 136, gap: 36 },
  bigNumber: { fontFamily: fonts.serifMedium, fontSize: 93, lineHeight: 96, color: colors.gold },
  time: { fontFamily: fonts.serifMedium, fontSize: 39, lineHeight: 41, color: colors.cream },
  luckyLabel: { fontFamily: fonts.sansRegular, fontSize: 10, lineHeight: 15, color: colors.gold },
  reflection: { paddingHorizontal: 20, paddingVertical: 16, gap: 16 },
  reflectionTitle: { fontSize: 28, lineHeight: 30 },
  reflectionBody: { fontSize: 13, lineHeight: 19 },
  note: { marginTop: 'auto', paddingTop: 32 },
});
