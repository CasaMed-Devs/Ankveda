import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ArrowCard } from '@/components/Cards';
import { Screen } from '@/components/Screen';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { LEGAL_URLS } from '@/lib/config';
import { formatLongDate, formatPhone } from '@/lib/format';
import { applyUser, queryClient, useEntitlement, useMe } from '@/lib/queries';
import { colors } from '@/theme/tokens';

/** 21 · Profile */
export default function Profile() {
  const me = useMe();
  const { isPremium, entitlement } = useEntitlement();
  const [restoring, setRestoring] = useState(false);
  const user = me.data;

  const restore = async () => {
    setRestoring(true);
    try {
      const { user: fresh, restored } = await api.restorePurchases();
      applyUser(fresh);
      Alert.alert(
        'Restore purchases',
        restored ? 'Your Ankveda Premium access is active again.' : 'We could not find an active subscription on this number.',
      );
    } catch (e) {
      Alert.alert('Restore purchases', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setRestoring(false);
    }
  };

  const signOut = () => {
    Alert.alert('Sign out', 'You can sign back in anytime with your mobile number.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await useAuthStore.getState().signOut();
          queryClient.clear();
          router.replace('/');
        },
      },
    ]);
  };

  const premiumSubtitle = isPremium
    ? `${entitlement?.planName ?? 'Premium'} · ${entitlement?.cancelAtPeriodEnd ? 'ends' : 'renews'} ${
        entitlement?.currentPeriodEnd ? new Date(entitlement.currentPeriodEnd).toLocaleDateString('en-IN') : 'soon'
      }`
    : 'Manage your plan or explore all insights';

  return (
    <Screen withTabBar>
      <View style={styles.heading}>
        <AppText variant="eyebrow">Your journey</AppText>
        <View style={styles.identity}>
          <AppText variant="display" style={styles.name}>
            {user?.fullName ?? ' '}
          </AppText>
          <AppText variant="body">{user ? formatPhone(user.phone) : ''}</AppText>
        </View>
      </View>

      <View style={styles.rows}>
        <ArrowCard
          title="Personal details"
          subtitle={`${user?.dob ? `${formatLongDate(user.dob)} · ` : ''}Your information stays private`}
          onPress={() => router.push('/profile-details')}
        />
        <ArrowCard title="Ankveda Premium" subtitle={premiumSubtitle} onPress={() => router.push('/paywall')} />
        <ArrowCard
          title="Purchases & reports"
          subtitle="Your access and saved readings"
          onPress={() => router.navigate('/reports')}
        />
        <ArrowCard
          title={restoring ? 'Restoring…' : 'Restore purchases'}
          subtitle="Reconnect your existing access"
          onPress={restore}
        />
      </View>

      <View style={styles.footer}>
        <AppText variant="small" align="center">
          <AppText variant="small" onPress={() => void Linking.openURL(LEGAL_URLS.terms)}>
            Terms of Service
          </AppText>
          {'   ·   '}
          <AppText variant="small" onPress={() => void Linking.openURL(LEGAL_URLS.privacy)}>
            Privacy Policy
          </AppText>
        </AppText>
        <AppText variant="caption" align="center" color={colors.gold}>
          Ancient wisdom, a little closer to you.
        </AppText>
        <Pressable onPress={signOut} hitSlop={10} accessibilityRole="button" style={styles.signOut}>
          <AppText variant="caption" align="center">
            Sign out
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 20 },
  identity: { gap: 16 },
  name: { fontSize: 42 },
  rows: { marginTop: 44, gap: 16 },
  footer: { marginTop: 44, gap: 22 },
  signOut: { alignSelf: 'center', paddingVertical: 4 },
});
