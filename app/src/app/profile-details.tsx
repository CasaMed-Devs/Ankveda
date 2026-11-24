import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { DateField, TextField } from '@/components/Fields';
import { Heading } from '@/components/Heading';
import { FooterNote, Screen } from '@/components/Screen';
import { ApiError } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import { useMe, useUpdateMe } from '@/lib/queries';
import { colors } from '@/theme/tokens';

/** Profile → Personal details. */
export default function ProfileDetails() {
  const me = useMe();
  const update = useUpdateMe();
  const [fullName, setFullName] = useState(me.data?.fullName ?? '');
  const [dob, setDob] = useState(me.data?.dob ?? '');
  // Fill in once the saved profile loads (if the screen opened before it arrived).
  const [loadedFor, setLoadedFor] = useState(me.data?.id);
  if (me.data && loadedFor !== me.data.id) {
    setLoadedFor(me.data.id);
    if (!fullName) setFullName(me.data.fullName ?? '');
    if (!dob) setDob(me.data.dob ?? '');
  }
  const valid = fullName.trim().length >= 2 && !!dob;

  const save = () => {
    if (!valid) return;
    update.mutate({ fullName: fullName.trim(), dob }, { onSuccess: () => router.back() });
  };

  return (
    <Screen
      headerAction={{ label: 'Profile', onPress: () => router.back() }}
      footer={
        <>
          {update.error ? (
            <FooterNote color={colors.danger}>
              {update.error instanceof ApiError ? update.error.message : 'Could not save. Please try again.'}
            </FooterNote>
          ) : (
            <FooterNote>
              Your information stays private.
            </FooterNote>
          )}
          <PrimaryButton label="Save details" onPress={save} loading={update.isPending} disabled={!valid} />
        </>
      }
    >
      <Heading eyebrow="Personal details" title={'The heart of\nyour readings.'} subtitle="New reports will use these details." />
      <View style={styles.form}>
        <TextField label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" maxLength={60} />
        <DateField label="Date of birth" value={dob} onChange={setDob} />
        <View style={styles.phone}>
          <AppText variant="label">Mobile number</AppText>
          <AppText variant="bodyCream">{me.data ? formatPhone(me.data.phone) : ''}</AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: 36, gap: 16 },
  phone: { gap: 8, paddingTop: 4 },
});
