import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { OtpInput } from '@/components/Fields';
import { Heading } from '@/components/Heading';
import { FooterNote, Screen } from '@/components/Screen';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { RESEND_SECONDS } from '@/lib/config';
import { formatPhone } from '@/lib/format';
import { keys, queryClient } from '@/lib/queries';
import { colors, fonts } from '@/theme/tokens';

/** 05 · Verify phone — 6-digit OTP (dummy code in development, see backend DUMMY_OTP). */
export default function Verify() {
  const { phone = '', devCode = '' } = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [hint, setHint] = useState(devCode);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setLoading(true);
    setError(undefined);
    try {
      const { token, user } = await api.verifyOtp(phone, value);
      queryClient.setQueryData(keys.me, user);
      // Setting the session unlocks the protected routes; the root screen then routes
      // to About you (new user) or Home without the splash delay.
      await useAuthStore.getState().setSession(token, user);
      router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That code did not work. Please try again.');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setSeconds(RESEND_SECONDS);
    setError(undefined);
    try {
      const res = await api.requestOtp(phone);
      setHint(res.devCode ?? '');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not resend the code.');
    }
  };

  return (
    <Screen
      footer={
        <>
          <FooterNote>
            Your details stay private and secure.
          </FooterNote>
          <PrimaryButton label="Verify & continue" onPress={() => verify()} loading={loading} disabled={code.length !== 6} />
        </>
      }
    >
      <View style={styles.headingWrap}>
        <Heading eyebrow="Verify your mobile" title={'A small step.\nA personal journey.'} />
        <AppText variant="body">
          Enter the 6-digit code sent to{'\n'}
          {formatPhone(phone)}
          {'  ·  '}
          <AppText style={styles.change} onPress={() => router.back()} accessibilityRole="link">
            Change
          </AppText>
        </AppText>
      </View>

      <View style={styles.otp}>
        <OtpInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (v.length === 6) void verify(v);
          }}
        />
        {error ? (
          <AppText variant="small" align="center" color={colors.danger}>
            {error}
          </AppText>
        ) : null}
        {seconds > 0 ? (
          <AppText variant="small" align="center" style={{ fontSize: 13 }}>
            Resend code in 00:{String(seconds).padStart(2, '0')}
          </AppText>
        ) : (
          <AppText variant="label" align="center" style={{ fontSize: 13 }} onPress={resend} accessibilityRole="button">
            Resend code
          </AppText>
        )}
        {hint ? (
          <AppText variant="caption" align="center">
            Test mode · your code is {hint}
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headingWrap: { gap: 10 },
  change: { fontFamily: fonts.sansSemiBold, color: '#dedede' },
  otp: { marginTop: 60, gap: 27 },
});
