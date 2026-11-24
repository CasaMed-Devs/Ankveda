import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Cards';
import { describePlan } from '@/lib/plans';
import type { Plan } from '@/lib/types';
import { colors, fonts } from '@/theme/tokens';

/** The selected-plan card ("5 day Trial · ₹49 · After that ₹499 / month"), fully driven by the backend plan. */
export const PlanCard = ({ plan }: { plan: Plan }) => {
  const copy = describePlan(plan);
  return (
    <Card style={styles.card} accessibilityLabel={`${copy.title}, ${copy.price}. ${copy.note}`}>
      <View style={styles.row}>
        <AppText style={styles.title}>{copy.title}</AppText>
        <AppText style={styles.price}>{copy.price}</AppText>
      </View>
      <AppText variant="caption" color={colors.gold}>
        {copy.note}
      </AppText>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { paddingHorizontal: 18, paddingVertical: 14, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 18, lineHeight: 26, color: colors.cream, flexShrink: 1 },
  price: { fontFamily: fonts.sansSemiBold, fontSize: 24, lineHeight: 34, color: colors.gold },
});
