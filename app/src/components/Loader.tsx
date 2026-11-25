import LottieView from 'lottie-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

const medallion = require('../../assets/ankveda_loader_medallion.json');

/** The source loop is 2.4s; play it faster so loading feels snappy. */
const LOOP_MS = 1600;
const FADE_MS = 180;

const SIZES = { xs: 28, sm: 48, md: 88, lg: 120 } as const;

type LoaderProps = {
  /** xs = beside a line of text, sm = inside cards / inline, md = main content area, lg = full-screen hero. */
  size?: keyof typeof SIZES;
  /** Stretch to fill the parent and center the medallion. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Branded Ankveda medallion loader. Use for page and section loading; buttons keep ActivityIndicator. */
export const Loader = ({ size = 'md', fill, style }: LoaderProps) => {
  const [opacity] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
  }, [opacity]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => mounted && setReduceMotion(on));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const dim = SIZES[size];

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[styles.wrap, fill && styles.fill, { opacity }, style]}
    >
      <LottieView
        key={reduceMotion ? 'still' : 'loop'}
        source={medallion}
        autoPlay={!reduceMotion}
        loop={!reduceMotion}
        progress={reduceMotion ? 0.5 : undefined}
        duration={LOOP_MS}
        resizeMode="contain"
        style={{ width: dim, height: dim }}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1, alignSelf: 'stretch' },
});
