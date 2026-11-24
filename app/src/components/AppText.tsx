import { StyleSheet, Text, useWindowDimensions, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

export type TextVariant =
  | 'brand'
  | 'display'
  | 'title'
  | 'cardTitle'
  | 'subtitle'
  | 'eyebrow'
  | 'body'
  | 'bodyCream'
  | 'small'
  | 'label'
  | 'caption'
  | 'arrow';

type AppTextProps = TextProps & {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle['textAlign'];
};

const serifLine = (size: number) => ({ fontSize: size, lineHeight: Math.round(size * 1.08) });
const sansLine = (size: number) => ({ fontSize: size, lineHeight: Math.round(size * 1.45) });

const variants = StyleSheet.create({
  brand: { fontFamily: fonts.serifSemiBold, color: colors.cream, ...serifLine(28) },
  display: { fontFamily: fonts.serifMedium, color: colors.cream, ...serifLine(42) },
  title: { fontFamily: fonts.serifMedium, color: colors.cream, ...serifLine(29) },
  cardTitle: { fontFamily: fonts.serifMedium, color: colors.cream, ...serifLine(24) },
  subtitle: { fontFamily: fonts.serifMedium, color: colors.cream, ...serifLine(20) },
  eyebrow: {
    fontFamily: fonts.sansBold,
    color: colors.gold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    ...sansLine(10),
  },
  body: { fontFamily: fonts.sansRegular, color: colors.muted, ...sansLine(14) },
  bodyCream: { fontFamily: fonts.sansRegular, color: colors.cream, ...sansLine(14) },
  small: { fontFamily: fonts.sansRegular, color: colors.muted, ...sansLine(12) },
  label: { fontFamily: fonts.sansRegular, color: colors.gold, ...sansLine(12) },
  caption: { fontFamily: fonts.sansRegular, color: colors.muted, ...sansLine(11) },
  arrow: { fontFamily: fonts.sansRegular, color: colors.gold, ...sansLine(19) },
});

/**
 * Text scaling policy (keeps the Figma layout intact on every phone):
 *  - never shrink below the design size (a phone set to "small text" would otherwise open up all gaps);
 *  - allow growth for accessibility, but cap it so fixed-geometry layouts don't clip or overlap.
 * Decorative display numbers pass allowFontScaling={false} explicitly.
 */
export const MAX_FONT_SCALE = 1.2;

export const useTextScaleProps = () => {
  const { fontScale } = useWindowDimensions();
  return { allowFontScaling: fontScale > 1, maxFontSizeMultiplier: MAX_FONT_SCALE };
};

export const AppText = ({ variant = 'body', color, align, style, ...rest }: AppTextProps) => {
  const scale = useTextScaleProps();
  return (
    <Text
      {...scale}
      {...rest}
      style={[variants[variant], color ? { color } : null, align ? { textAlign: align } : null, style]}
    />
  );
};
