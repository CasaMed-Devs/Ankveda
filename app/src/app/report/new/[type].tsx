import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { InfoCard } from '@/components/Cards';
import { DateField, OptionField, PhoneField, TextField } from '@/components/Fields';
import { Heading } from '@/components/Heading';
import { FooterNote, Screen } from '@/components/Screen';
import { ApiError } from '@/lib/api';
import { useCreateReport, useMe } from '@/lib/queries';
import { FIELD_LABELS, getReportType, PERIOD_OPTIONS, type ReportField } from '@/lib/report-types';
import type { ReportInput } from '@/lib/types';
import { colors } from '@/theme/tokens';

type Errors = Partial<Record<ReportField, string>>;

const validate = (fields: ReportField[], input: ReportInput): Errors => {
  const errors: Errors = {};
  for (const field of fields) {
    const value = (input[field] ?? '').trim();
    switch (field) {
      case 'fullName':
      case 'partnerName':
        if (value.length < 2) errors[field] = 'Please enter a full name.';
        break;
      case 'dob':
      case 'partnerDob':
        if (!value) errors[field] = 'Enter a valid date (DD / MM / YYYY).';
        break;
      case 'phone':
        if (!/^\d{10}$/.test(value)) errors[field] = 'Enter 10 digits, without the country code.';
        break;
      case 'carNumber':
        if (!/^[A-Z0-9]{4,12}$/.test(value)) errors[field] = 'Enter the vehicle number, e.g. MH12AB1234.';
        break;
      default:
        break;
    }
  }
  return errors;
};

/** 08–13 (+ Car) · Report details form, driven by the report type config. */
export default function ReportForm() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const config = getReportType(type);
  const me = useMe();
  const create = useCreateReport();

  // Prefilled from the saved profile (name, date of birth, own phone for the phone report).
  const profileInput = (): ReportInput => ({
    fullName: me.data?.fullName ?? '',
    dob: me.data?.dob ?? '',
    phone: config?.type === 'phone' ? (me.data?.phone ?? '') : '',
  });
  const [input, setInput] = useState<ReportInput>(() => ({ ...profileInput(), period: '12m' }));
  const [errors, setErrors] = useState<Errors>({});

  // If the profile arrives after the screen opened, fill only the fields the user hasn't typed in.
  const [prefilledFor, setPrefilledFor] = useState(me.data?.id);
  if (me.data && prefilledFor !== me.data.id) {
    setPrefilledFor(me.data.id);
    const profile = profileInput();
    setInput((prev) => ({
      ...prev,
      fullName: prev.fullName || profile.fullName,
      dob: prev.dob || profile.dob,
      phone: prev.phone || profile.phone,
    }));
  }

  if (!config) return <Redirect href="/report/choose" />;

  const set = <K extends ReportField>(field: K, value: ReportInput[K]) => {
    setInput((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = () => {
    const found = validate(config.fields, input);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    const payload: ReportInput = {};
    for (const field of config.fields) {
      const value = input[field];
      if (value) (payload as Record<string, string>)[field] = value.trim();
    }
    create.mutate(
      { type: config.type, input: payload },
      {
        onSuccess: ({ report }) => {
          if (report.status === 'processing') router.replace(`/report/${report.id}/processing`);
          else router.replace(`/report/${report.id}/unlock`);
        },
      },
    );
  };

  const label = (field: ReportField) => config.labels?.[field] ?? FIELD_LABELS[field];

  const renderField = (field: ReportField) => {
    switch (field) {
      case 'dob':
      case 'partnerDob':
        return (
          <DateField key={field} label={label(field)} value={input[field] ?? ''} onChange={(v) => set(field, v)} error={errors[field]} />
        );
      case 'phone':
        return (
          <PhoneField
            key={field}
            label={label(field)}
            value={input.phone ?? ''}
            onChangeText={(v) => set('phone', v)}
            error={errors.phone}
            showCountryCode={false}
          />
        );
      case 'period':
        return (
          <OptionField
            key={field}
            label={label(field)}
            value={input.period ?? '12m'}
            options={PERIOD_OPTIONS}
            onChange={(v) => set('period', v)}
          />
        );
      case 'carNumber':
        return (
          <TextField
            key={field}
            label={label(field)}
            value={input.carNumber ?? ''}
            onChangeText={(v) => set('carNumber', v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            placeholder="MH12AB1234"
            autoCapitalize="characters"
            autoCorrect={false}
            error={errors.carNumber}
          />
        );
      case 'careerFocus':
        return (
          <TextField
            key={field}
            label={label(field)}
            value={input.careerFocus ?? ''}
            onChangeText={(v) => set('careerFocus', v)}
            placeholder="Growth in my current role"
            maxLength={120}
          />
        );
      default:
        return (
          <TextField
            key={field}
            label={label(field)}
            value={input[field] ?? ''}
            onChangeText={(v) => set(field, v)}
            placeholder={field === 'partnerName' ? 'Their full name' : 'Your full name'}
            autoCapitalize="words"
            maxLength={60}
            error={errors[field]}
          />
        );
    }
  };

  return (
    <Screen
      headerAction={{ label: 'Reports', onPress: () => router.back() }}
      footer={
        <>
          {create.error ? (
            <FooterNote color={colors.danger}>
              {create.error instanceof ApiError ? create.error.message : 'Could not create your report. Please try again.'}
            </FooterNote>
          ) : (
            <FooterNote>
              Your details stay private and secure.
            </FooterNote>
          )}
          <PrimaryButton label={config.cta} onPress={submit} loading={create.isPending} />
        </>
      }
    >
      <Heading eyebrow={config.eyebrow} title={config.heading} subtitle={config.subtitle} />
      <View style={styles.form}>
        {config.fields.map(renderField)}
        {config.info ? <InfoCard title="A reading made for you" body={config.info} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: 36, gap: 16 },
});
