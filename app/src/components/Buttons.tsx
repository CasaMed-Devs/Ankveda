import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { borderWidth, colors, fonts, goldGradient, radii } from '@/theme/tokens';

type ButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** gradient = default primary, solid = flat gold (Reports tab), card = maroon outline */
  tone?: 'gradient' | 'solid' | 'card';
};

export const PrimaryButton = ({ label, onPress, loading, disabled, tone = 'gradient' }: ButtonProps) => {
  const inactive = disabled || loading;
  const textColor = tone === 'card' ? colors.cream : colors.onGold;

  const inner = loading ? (
    <ActivityIndicator color={textColor} />
  ) : (
    <AppText style={[styles.label, { color: textColor }]} numberOfLines={1}>
      {label}
    </AppText>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [styles.base, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {tone === 'gradient' ? (
        <LinearGradient colors={goldGradient} style={styles.surface}>
          {inner}
        </LinearGradient>
      ) : (
        <View style={[styles.surface, tone === 'solid' ? styles.solid : styles.card]}>{inner}</View>
      )}
    </Pressable>
  );
};

type LinkButtonProps = { label: string; onPress: () => void; size?: 12 | 13 };

export const LinkButton = ({ label, onPress, size = 12 }: LinkButtonProps) => (
  <Pressable onPress={onPress} hitSlop={10} accessibilityRole="link" style={styles.link}>
    {({ pressed }) => (
      <AppText variant="label" align="center" style={[{ fontSize: size }, pressed && { opacity: 0.6 }]}>
        {label}
      </AppText>
    )}
  </Pressable>
);

const styles = StyleSheet.create({
  base: { borderRadius: radii.button, overflow: 'hidden' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  disabled: { opacity: 0.5 },
  surface: { height: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  solid: { backgroundColor: colors.gold },
  card: { backgroundColor: colors.card, borderWidth, borderColor: colors.border, borderRadius: radii.button },
  label: { fontFamily: fonts.sansBold, fontSize: 15, lineHeight: 22 },
  link: { alignSelf: 'center', paddingVertical: 4 },
});
