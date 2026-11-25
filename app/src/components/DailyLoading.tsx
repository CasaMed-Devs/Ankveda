import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Loader } from '@/components/Loader';
import { colors, fonts } from '@/theme/tokens';

const STEPS = [
  'Reading your birth numbers…',
  'Consulting the astrologer…',
  'Aligning today’s numbers with your chart…',
  'Finding your lucky number and timing…',
  'Writing today’s guidance for you…',
] as const;

const STEP_MS = 2_200;
const FADE_MS = 220;

/**
 * Shown while today's guidance is generated (astrologyapi.com + OpenAI, ~5–20 s): the Ankveda medallion
 * with a status line that walks through the steps and rests on the last one if it runs long.
 */
export const DailyLoading = () => {
  const [step, setStep] = useState(0);
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (step >= STEPS.length - 1) return;
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => {
        setStep((s) => s + 1);
        Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
      });
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [step, opacity]);

  return (
    <View style={styles.wrap}>
      <Loader size="lg" />
      <AppText variant="eyebrow" align="center" style={styles.eyebrow}>
        Preparing today’s guidance
      </AppText>
      <Animated.View style={{ opacity }}>
        <AppText style={styles.status} align="center" accessibilityLiveRegion="polite">
          {STEPS[step]}
        </AppText>
      </Animated.View>
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {STEPS.map((_, i) => (
          <View key={i} style={[styles.dot, i <= step && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 32, gap: 14 },
  eyebrow: { marginTop: 8 },
  status: { fontFamily: fonts.serifMedium, fontSize: 22, lineHeight: 30, color: colors.cream, minHeight: 60 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.gold },
});
