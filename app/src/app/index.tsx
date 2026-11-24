import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { ScreenBackground } from '@/components/Screen';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { queryClient, keys } from '@/lib/queries';
import { colors, fonts } from '@/theme/tokens';

const SPLASH_MS = 1600;
// The branded pause only runs on cold start; later visits (after login / sign-out) route instantly.
let splashShown = false;

/** 01 · Splash — shown on launch, then routes to intro / login / about-you / home. */
export default function Splash() {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const minimumMs = splashShown ? 0 : SPLASH_MS;
    splashShown = true;

    const decide = async () => {
      const { token, introSeen, user: knownUser } = useAuthStore.getState();
      let next: '/intro' | '/login' | '/about-you' | '/home' = introSeen ? '/login' : '/intro';

      if (token && knownUser) {
        next = knownUser.fullName && knownUser.dob ? '/home' : '/about-you';
      } else if (token) {
        next = '/home';
        try {
          const { user } = await api.me();
          useAuthStore.getState().setUser(user);
          queryClient.setQueryData(keys.me, user);
          if (!user.fullName || !user.dob) next = '/about-you';
        } catch {
          // Offline or server down: Home shows its own error state. A 401 already signed the user out.
          if (!useAuthStore.getState().token) next = '/login';
        }
      }

      const wait = Math.max(0, minimumMs - (Date.now() - started));
      setTimeout(() => {
        if (!cancelled) router.replace(next);
      }, wait);
    };

    void decide();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScreenBackground>
      <View style={[styles.container, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.markWrap}>
          <Image source={require('../../assets/images/splash-rings.svg')} style={styles.rings} contentFit="contain" />
          <Image
            source={require('../../assets/images/brand-mark.png')}
            style={styles.mark}
            contentFit="cover"
            accessibilityLabel="Ankveda logo"
          />
        </View>

        <View style={styles.titleBlock}>
          <AppText style={styles.wordmark} allowFontScaling={false}>
            ANKVEDA
          </AppText>
          <AppText style={styles.tagline}>{'NUMEROLOGY & KUNDALI'}</AppText>
        </View>

        <View style={styles.copyBlock}>
          <AppText style={styles.story}>Your numbers. Your story.</AppText>
          <AppText variant="body" align="center" style={styles.wisdom}>
            Ancient wisdom, a little closer to you.
          </AppText>
        </View>

        <AppText style={styles.journey}>A JOURNEY INWARD</AppText>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  markWrap: { width: 342, height: 342, alignItems: 'center', justifyContent: 'center' },
  rings: { position: 'absolute', width: 342, height: 342 },
  mark: { width: 160, height: 160, borderRadius: 38.4 },
  titleBlock: { alignItems: 'center', gap: 10, marginTop: -54 },
  wordmark: { fontFamily: fonts.serifMedium, fontSize: 46, lineHeight: 50, color: colors.gold },
  tagline: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 16, color: colors.gold },
  copyBlock: { alignItems: 'center', gap: 14, marginTop: 72 },
  story: { fontFamily: fonts.serifMedium, fontSize: 23, lineHeight: 25, color: colors.creamSoft, textAlign: 'center' },
  wisdom: { fontSize: 13, color: '#d8b7b5' },
  journey: {
    marginTop: 'auto',
    fontFamily: fonts.sansRegular,
    fontSize: 10,
    lineHeight: 15,
    color: colors.gold,
    textAlign: 'center',
  },
});
