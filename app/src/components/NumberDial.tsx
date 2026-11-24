import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts } from '@/theme/tokens';

const SIZE = 292;

// Centre-x / top of each digit, taken from Figma frame 10:855 (292×292 dial).
const DIGITS: { n: number; x: number; y: number }[] = [
  { n: 1, x: 146, y: 19 },
  { n: 2, x: 217.35, y: 44.97 },
  { n: 3, x: 255.31, y: 110.73 },
  { n: 4, x: 242.13, y: 185.5 },
  { n: 5, x: 183.96, y: 234.31 },
  { n: 6, x: 108.04, y: 234.31 },
  { n: 7, x: 49.87, y: 185.5 },
  { n: 8, x: 36.69, y: 110.73 },
  { n: 9, x: 74.65, y: 44.97 },
];

/** The 1–9 numerology dial with a large centre number (intro slide 1). */
export const NumberDial = ({ value = 7 }: { value?: number }) => (
  <View style={styles.dial} accessibilityLabel={`Numerology dial showing ${value}`}>
    <Image source={require('../../assets/images/orbit-outer.svg')} style={styles.outer} />
    <Image source={require('../../assets/images/orbit-middle.svg')} style={styles.middle} />
    <Image source={require('../../assets/images/orbit-inner.svg')} style={styles.inner} />
    {DIGITS.map((d) => (
      <AppText key={d.n} style={[styles.digit, { left: d.x - 15, top: d.y }]}>
        {d.n}
      </AppText>
    ))}
    <AppText style={styles.centre}>{value}</AppText>
  </View>
);

const styles = StyleSheet.create({
  dial: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.cardSoft,
    boxShadow: `0px 0px 16px 0px ${colors.glow}`,
    alignSelf: 'center',
  },
  outer: { position: 'absolute', left: 0, top: 0, width: 292, height: 292 },
  middle: { position: 'absolute', left: 18, top: 18, width: 256, height: 256 },
  inner: { position: 'absolute', left: 55, top: 55, width: 182, height: 182 },
  digit: {
    position: 'absolute',
    width: 30,
    textAlign: 'center',
    fontFamily: fonts.serifMedium,
    fontSize: 25,
    lineHeight: 26,
    color: colors.gold,
  },
  centre: {
    position: 'absolute',
    left: 70,
    top: 54,
    width: 152,
    textAlign: 'center',
    fontFamily: fonts.serifMedium,
    fontSize: 155,
    lineHeight: 160,
    color: colors.gold,
  },
});
