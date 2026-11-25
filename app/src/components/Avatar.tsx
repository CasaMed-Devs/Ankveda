import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts } from '@/theme/tokens';

type AvatarProps = { uri?: string; name: string; size?: number };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/** Round astrologer photo with a hairline gold ring; initials show while it loads or if it fails. */
export const Avatar = ({ uri, name, size = 56 }: AvatarProps) => (
  <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
    <AppText style={[styles.initials, { fontSize: size * 0.34, lineHeight: size * 0.42 }]} allowFontScaling={false}>
      {initials(name)}
    </AppText>
    {uri ? (
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        recyclingKey={uri}
        accessibilityIgnoresInvertColors
      />
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  ring: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navActive,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  initials: { fontFamily: fonts.serifSemiBold, color: colors.gold },
});
