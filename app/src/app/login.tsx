import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { PhoneField } from '@/components/Fields';
import { Heading } from '@/components/Heading';
import { Screen } from '@/components/Screen';
import { toast } from '@/components/Toast';
import { api, ApiError } from '@/lib/api';
import { LEGAL_URLS } from '@/lib/config';
import { colors } from '@/theme/tokens';

/** 04 · Sign up — phone number only (Google/Apple removed by product decision). */
export default function Login() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      const { devCode, delayed } = await api.requestOtp(phone);
      if (delayed) toast.info('SMS is taking longer than usual. Enter the code when it arrives, or tap resend.');
      router.push({ pathname: '/verify', params: { phone, devCode: devCode ?? '' } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      footer={
        <AppText variant="caption" align="center">
          By continuing, you agree to our{' '}
          <AppText variant="caption" color={colors.gold} onPress={() => void Linking.openURL(LEGAL_URLS.terms)}>
            Terms of Service
          </AppText>
          {'\n'}and{' '}
          <AppText variant="caption" color={colors.gold} onPress={() => void Linking.openURL(LEGAL_URLS.privacy)}>
            Privacy Policy
          </AppText>
          .
        </AppText>
      }
    >
      <Heading
        eyebrow="Your journey starts here"
        title={'Welcome to\nAnkveda.'}
        subtitle="Let’s discover what makes you, you."
      />
      <View style={styles.form}>
        <PhoneField
          label="Mobile number"
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            if (error) setError(undefined);
          }}
          error={error}
          hint="We’ll send a one-time code to verify it."
          autoFocus
        />
        <PrimaryButton label="Continue with phone" onPress={submit} loading={loading} disabled={phone.length !== 10} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: 48, gap: 28 },
});
