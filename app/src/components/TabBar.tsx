import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { borderWidth, colors, fonts, radii } from '@/theme/tokens';

const LABELS: Record<string, string> = {
  home: 'Home',
  chat: 'Chat',
  reports: 'Reports',
  daily: 'Daily',
  profile: 'Profile',
};

/** Floating maroon tab bar with a highlighted pill for the active tab (Figma frames 17–21). */
export const TabBar = ({ state, navigateToTab, insets }: BottomTabBarProps) => (
  <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 8 }]} pointerEvents="box-none">
    <View style={styles.bar} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const label = LABELS[route.name] ?? route.name;
        return (
          <Pressable
            key={route.key}
            onPress={() => {
              if (!focused) navigateToTab(route.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={({ pressed }) => [styles.tab, focused && styles.tabActive, pressed && !focused && styles.pressed]}
          >
            <AppText style={[styles.label, focused && styles.labelActive]}>{label}</AppText>
          </Pressable>
        );
      })}
    </View>
  </View>
);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.navBackground,
    borderWidth,
    borderColor: colors.border,
    borderRadius: radii.nav,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  tab: { flex: 1, height: 40, borderRadius: radii.tab, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: colors.navActive },
  pressed: { opacity: 0.7 },
  label: { fontFamily: fonts.sansRegular, fontSize: 11, lineHeight: 16, color: colors.muted },
  labelActive: { fontFamily: fonts.sansBold, color: colors.gold },
});
