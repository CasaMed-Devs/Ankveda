import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';

type HeadingProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
};

/** Eyebrow + large serif display title + muted subtitle (top of most screens). */
export const Heading = ({ eyebrow, title, subtitle }: HeadingProps) => (
  <View style={styles.wrap}>
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
