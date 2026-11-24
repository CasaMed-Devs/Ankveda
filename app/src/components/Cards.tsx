import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { borderWidth, colors, radii } from '@/theme/tokens';

type CardProps = {
  children: ReactNode;
  /** soft = translucent fill with a gold glow (onboarding cards) */
  tone?: 'solid' | 'soft';
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
};

export const Card = ({ children, tone = 'solid', style, onPress, accessibilityLabel }: CardProps) => {
  const cardStyle = [styles.card, tone === 'soft' ? styles.soft : styles.solid, style];
  if (!onPress) return <View style={cardStyle}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [...cardStyle, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
};

type ArrowCardProps = {
  title: string;
  subtitle?: string;
  onPress: () => void;
  titleSize?: number;
};

/** Card with a serif title, small muted subtitle and a gold arrow (Home, Profile, Chat). */
export const ArrowCard = ({ title, subtitle, onPress, titleSize = 24 }: ArrowCardProps) => (
  <Card onPress={onPress} style={styles.arrowCard} accessibilityLabel={title}>
    <View style={styles.arrowText}>
      <AppText variant="cardTitle" style={{ fontSize: titleSize, lineHeight: Math.round(titleSize * 1.08) }}>
        {title}
      </AppText>
      {subtitle ? <AppText variant="small">{subtitle}</AppText> : null}
    </View>
    <AppText variant="arrow">→</AppText>
  </Card>
);

type NumberedRowProps = {
  index: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  badge?: string;
};

/** 64px row used on "Choose report". */
export const NumberedRow = ({ index, title, subtitle, onPress, badge }: NumberedRowProps) => (
  <Card onPress={onPress} style={styles.numbered} accessibilityLabel={title}>
    <AppText variant="label" style={styles.index}>
      {index}
    </AppText>
    <View style={styles.numberedText}>
      <View style={styles.titleRow}>
        <AppText variant="cardTitle" numberOfLines={1}>
          {title}
        </AppText>
        {badge ? <Badge label={badge} /> : null}
      </View>
      <AppText variant="caption" numberOfLines={1}>
        {subtitle}
      </AppText>
    </View>
    <AppText variant="arrow">→</AppText>
  </Card>
);

export const Badge = ({ label }: { label: string }) => (
  <View style={styles.badge}>
    <AppText variant="eyebrow" style={styles.badgeText}>
      {label}
    </AppText>
  </View>
);

/** "A reading made for you" explainer card on report forms. */
export const InfoCard = ({ title, body }: { title: string; body: string }) => (
  <Card style={styles.info}>
    <AppText variant="subtitle">{title}</AppText>
    <AppText variant="small">{body}</AppText>
  </Card>
);

const styles = StyleSheet.create({
  card: { borderWidth, borderColor: colors.border, borderRadius: radii.card, overflow: 'hidden' },
  solid: { backgroundColor: colors.card },
  soft: { backgroundColor: colors.cardSoft, boxShadow: `0px 0px 8px 0px ${colors.glow}` },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  arrowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 8,
  },
  arrowText: { flex: 1, gap: 8 },
  numbered: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 14,
    paddingVertical: 7,
  },
  index: { width: 44 },
  numberedText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth,
    borderColor: colors.border,
  },
  badgeText: { fontSize: 8, lineHeight: 12, letterSpacing: 1 },
  info: { paddingHorizontal: 15, paddingVertical: 12, gap: 6 },
});
