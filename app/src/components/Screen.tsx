import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { backgroundGradient, spacing } from '@/theme/tokens';

type HeaderAction = { label: string; onPress: () => void };

type ScreenProps = {
  children: ReactNode;
  /** Pinned to the bottom of the screen (CTA buttons, composer). */
  footer?: ReactNode;
  /** Small gold/muted link at the top right, e.g. "Skip" or "Reports". */
  headerAction?: HeaderAction;
  headerActionTone?: 'gold' | 'muted';
  showBrand?: boolean;
  scroll?: boolean;
  /** Extra bottom space reserved for the floating tab bar. */
  withTabBar?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

export const TAB_BAR_SPACE = 96;
const FOOTER_BOTTOM_GAP = 20;

/** Small note shown above a footer button ("Your details stay private and secure.") — Figma keeps ~28pt to the button. */
export const FooterNote = ({ children, color }: { children: ReactNode; color?: string }) => (
  <AppText variant="small" align="center" color={color} style={styles.footerNote}>
    {children}
  </AppText>
);

export const ScreenBackground = ({ children }: { children: ReactNode }) => (
  <LinearGradient colors={backgroundGradient} style={styles.fill}>
    {children}
  </LinearGradient>
);

export const Screen = ({
  children,
  footer,
  headerAction,
  headerActionTone = 'gold',
  showBrand = true,
  scroll = true,
  withTabBar = false,
  contentStyle,
}: ScreenProps) => {
  const insets = useSafeAreaInsets();
  // Figma: bottom buttons sit ~22pt above the home indicator / gesture area.
  const bottomPad = withTabBar ? TAB_BAR_SPACE + insets.bottom : insets.bottom + FOOTER_BOTTOM_GAP;

  const header = showBrand ? (
    <View style={styles.header}>
      <AppText variant="brand">Ankveda</AppText>
      {headerAction ? (
        <Pressable hitSlop={12} onPress={headerAction.onPress} accessibilityRole="link">
          <AppText variant={headerActionTone === 'gold' ? 'label' : 'small'}>{headerAction.label}</AppText>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  const body = (
    <View style={[styles.content, !scroll && styles.fill, contentStyle]}>
      {header}
      {children}
    </View>
  );

  return (
    <ScreenBackground>
      {/* Android is edge-to-edge (the window no longer resizes for the keyboard), so pad on both platforms. */}
      <KeyboardAvoidingView style={[styles.fill, { paddingTop: insets.top + spacing.screenTop }]} behavior="padding">
        {scroll ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.scrollContent, !footer && { paddingBottom: bottomPad + 16 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {body}
          </ScrollView>
        ) : (
          <View style={[styles.fill, !footer && { paddingBottom: bottomPad }]}>{body}</View>
        )}
        {footer ? <View style={[styles.footer, { paddingBottom: bottomPad }]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.gutter },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  footer: { paddingHorizontal: spacing.gutter, paddingTop: 12, gap: 14 },
  footerNote: { marginBottom: 14 },
});
