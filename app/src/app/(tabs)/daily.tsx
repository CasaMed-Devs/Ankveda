import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { LockedPanel } from '@/components/LockedPanel';
import { Screen } from '@/components/Screen';
import { useDaily } from '@/lib/queries';
import { colors, fonts } from '@/theme/tokens';

/** 20 · Daily guidance — Astrology API daily numbers + OpenAI message. Premium only. */
export default function Daily() {
  const daily = useDaily();
  const data = daily.data?.daily;

  return (
    <Screen withTabBar>
      <Heading
        eyebrow="A little nudge from the universe"
        title={data?.theme ?? 'Today, choose\nnew beginnings.'}
        subtitle="A little intention can change your day."
      />

      <View style={styles.body}>
        {daily.isLoading ? (
          <ActivityIndicator color={colors.gold} style={styles.loader} />
        ) : daily.isError ? (
          <Pressable onPress={() => void daily.refetch()}>
            <AppText variant="small">We could not load today’s guidance. Tap to try again.</AppText>
          </Pressable>
        ) : daily.data?.locked || !data ? (
          <LockedPanel
            title="Your lucky number, every day."
            body="Lucky numbers, timings and a short reflection made personal to your birth date."
          />
        ) : (
          <>
            <Card style={styles.luckyCard}>
              <View style={styles.luckyNumber}>
                <AppText style={styles.bigNumber}>{data.luckyNumber}</AppText>
                <AppText style={styles.luckyLabel}>LUCKY NUMBER</AppText>
              </View>
              <View style={styles.luckyTime}>
                <AppText style={styles.time}>{data.luckyTime}</AppText>
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
  loader: { marginVertical: 40 },
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
  note: { marginTop: 32 },
});
