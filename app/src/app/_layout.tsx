import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold,
  useFonts as useCormorant,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  useFonts as useDmSans,
} from '@expo-google-fonts/dm-sans';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '@/lib/auth-store';
import { queryClient } from '@/lib/queries';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [serifLoaded] = useCormorant({
    CormorantGaramond_500Medium,
    CormorantGaramond_500Medium_Italic,
    CormorantGaramond_600SemiBold,
  });
  const [sansLoaded] = useDmSans({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold });
  const hydrated = useAuthStore((s) => s.hydrated);
  const signedIn = useAuthStore((s) => !!s.token);
  const ready = serifLoaded && sansLoaded && hydrated;

  useEffect(() => {
    void useAuthStore.getState().hydrate();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: colors.backgroundTop },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="intro" />
            <Stack.Screen name="login" />
            <Stack.Screen name="verify" options={{ animation: 'slide_from_right' }} />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="about-you" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="paywall" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="report/choose" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="report/new/[type]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="report/[id]/index" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="report/[id]/unlock" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="report/[id]/preview" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="report/[id]/processing" options={{ gestureEnabled: false }} />
            <Stack.Screen name="astrologer" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="profile-details" options={{ animation: 'slide_from_right' }} />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
