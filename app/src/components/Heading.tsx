import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';

type HeadingProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Space between the stacked lines — Figma uses 12 on most screens, 16 on Home. */
  gap?: number;
};

/** Eyebrow + large serif display title + muted subtitle (top of most screens). */
export const Heading = ({ eyebrow, title, subtitle, gap = 12 }: HeadingProps) => (
  <View style={[styles.wrap, { gap }]}>
    {eyebrow ? <AppText variant="eyebrow">{eyebrow}</AppText> : null}
    <AppText variant="display" accessibilityRole="header">
      {title}
    </AppText>
    {subtitle ? <AppText variant="body">{subtitle}</AppText> : null}
  </View>
);

const styles = StyleSheet.create({
  wrap: { gap: 12 },
});
