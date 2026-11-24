import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { InfoCard } from '@/components/Cards';
import { DateField, TextField } from '@/components/Fields';
import { Heading } from '@/components/Heading';
import { FooterNote, Screen } from '@/components/Screen';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useUpdateMe } from '@/lib/queries';
import { colors } from '@/theme/tokens';

/** New screen (not in Figma): collects name + date of birth once after the first login. */
export default function AboutYou() {
  const user = useAuthStore((s) => s.user);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [dob, setDob] = useState(user?.dob ?? '');
  const [touched, setTouched] = useState(false);
  const update = useUpdateMe();

  const nameError = touched && fullName.trim().length < 2 ? 'Please enter your full name.' : undefined;
  const dobError = touched && !dob ? 'Enter a valid date of birth (DD / MM / YYYY).' : undefined;

  const submit = () => {
    setTouched(true);
    if (fullName.trim().length < 2 || !dob) return;
    update.mutate(
      { fullName: fullName.trim(), dob },
      { onSuccess: () => router.replace('/home') },
    );
  };

  return (
    <Screen
      footer={
        <>
          {update.error ? (
            <FooterNote color={colors.danger}>
              {update.error instanceof ApiError ? update.error.message : 'Could not save. Please try again.'}
            </FooterNote>
          ) : (
            <FooterNote>
              Your details stay private and secure.
            </FooterNote>
          )}
          <PrimaryButton label="Continue" onPress={submit} loading={update.isPending} />
        </>
      }
    >
      <Heading
        eyebrow="About you"
        title={'Let’s begin\nwith you.'}
        subtitle="Your name and birth date are the heart of every reading."
      />
      <View style={styles.form}>
        <TextField
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your full name"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          error={nameError}
        />
        <DateField label="Date of birth" value={dob} onChange={setDob} error={dobError} />
        <InfoCard
          title="A reading made for you"
          body="We use these details to calculate your birth number, life path and name number."
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: 40, gap: 16 },
});
