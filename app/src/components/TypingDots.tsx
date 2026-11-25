import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

/** Three softly pulsing dots ("astrologer is typing"). */
export const TypingDots = () => {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <View style={styles.row} accessibilityLabel="Typing" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => {
        const start = i * 0.2;
        const opacity = progress.interpolate({
          inputRange: [0, start, start + 0.2, start + 0.4, 1],
          outputRange: [0.3, 0.3, 1, 0.3, 0.3],
        });
        const translateY = progress.interpolate({
          inputRange: [0, start, start + 0.2, start + 0.4, 1],
          outputRange: [0, 0, -3, 0, 0],
        });
        return <Animated.View key={i} style={[styles.dot, { opacity, transform: [{ translateY }] }]} />;
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gold },
});
