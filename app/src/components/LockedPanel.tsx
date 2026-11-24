import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Cards';
import { colors } from '@/theme/tokens';

type LockedPanelProps = { title: string; body: string };

/** Shown in place of premium content for free users; opens the paywall. */
export const LockedPanel = ({ title, body }: LockedPanelProps) => (
  <Card onPress={() => router.push('/paywall')} style={styles.card} accessibilityLabel={`${title}. Unlock with Premium`}>
    <View style={styles.row}>
      <View style={styles.lock}>
        <Image source={require('../../assets/images/lock-keyhole.svg')} style={styles.icon} />
      </View>
      <AppText variant="eyebrow">Ankveda Premium</AppText>
    </View>
    <AppText variant="title" style={styles.title}>
      {title}
    </AppText>
    <AppText variant="small">{body}</AppText>
    <AppText variant="label" style={styles.cta}>
      Unlock with Premium  →
    </AppText>
  </Card>
);

/** Small lock badge that sits on top of blurred / hidden content. */
export const LockBadge = () => (
  <View style={styles.lock}>
    <Image source={require('../../assets/images/lock-keyhole.svg')} style={styles.icon} />
  </View>
);

const styles = StyleSheet.create({
  card: { padding: 18, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lock: {
    padding: 12,
    borderRadius: 50,
    backgroundColor: colors.cardSoft,
    borderWidth: 0.7,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  icon: { width: 20, height: 20 },
  title: { fontSize: 26, lineHeight: 28 },
  cta: { marginTop: 4, fontSize: 13 },
});
