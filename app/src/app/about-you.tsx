import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { InfoCard } from '@/components/Cards';
import { DateField, TextField } from '@/components/Fields';
import { Heading } from '@/components/Heading';
import { FooterNote, Screen } from '@/components/Screen';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useUpdateMe } from '@/lib/queries';
import { colors } from '@/theme/tokens';

/** Time for the keyboard / footer to settle before scrolling the date field into view. */
const SCROLL_DELAY_MS = 250;

/** New screen (not in Figma): collects name + date of birth once after the first login. */
export default function AboutYou() {
  const user = useAuthStore((s) => s.user);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [dob, setDob] = useState(user?.dob ?? '');
  const [nameTouched, setNameTouched] = useState(false);
  const [dobTouched, setDobTouched] = useState(false);
  const [dobFocused, setDobFocused] = useState(false);
  const update = useUpdateMe();

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const dobRef = useRef<ComponentRef<typeof TextInput>>(null);

  const nameValid = fullName.trim().length >= 2;
  const nameError = nameTouched && !nameValid ? 'Please enter your full name.' : undefined;
  const dobError = dobTouched && !dob ? 'Enter a valid date of birth (DD / MM / YYYY).' : undefined;

  const focusDob = () => dobRef.current?.focus();

  /** Continue walks the form: missing name → name field; then date of birth; then save. */
  const submit = () => {
    if (!nameValid) {
      setNameTouched(true);
      nameRef.current?.focus();
      return;
    }
    if (!dob) {
      // Coming from the name field: just move on to the date. Already in it with an incomplete date: explain.
      if (dobFocused) setDobTouched(true);
      focusDob();
      return;
    }
    update.mutate({ fullName: fullName.trim(), dob }, { onSuccess: () => router.replace('/home') });
  };

  return (
    <Screen
      scrollRef={scrollRef}
      footer={
        <>
          {update.error ? (
            <FooterNote color={colors.danger}>
              {update.error instanceof ApiError ? update.error.message : 'Could not save. Please try again.'}
            </FooterNote>
          ) : (
            <FooterNote>Your details stay private and secure.</FooterNote>
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
          ref={nameRef}
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          onBlur={() => fullName && setNameTouched(true)}
          placeholder="Your full name"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={nameValid ? focusDob : () => setNameTouched(true)}
          error={nameError}
        />
        <DateField
          ref={dobRef}
          label="Date of birth"
          value={dob}
          onChange={setDob}
          onFocus={() => {
            setDobFocused(true);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), SCROLL_DELAY_MS);
          }}
          onBlur={() => setDobFocused(false)}
          returnKeyType="done"
          onSubmitEditing={submit}
          error={dobError}
        />
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
