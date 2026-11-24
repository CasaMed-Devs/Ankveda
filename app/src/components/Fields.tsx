import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText, useTextScaleProps } from '@/components/AppText';
import { borderWidth, colors, fonts, radii } from '@/theme/tokens';
import { digitsToIsoDate, isoDateToDigits } from '@/lib/format';

/** TextInput with the app-wide text scaling policy (see AppText). */
export const Input = (props: TextInputProps & { ref?: React.Ref<ComponentRef<typeof TextInput>> }) => {
  const scale = useTextScaleProps();
  return <TextInput {...scale} {...props} />;
};

type FieldShellProps = { label: string; error?: string; hint?: string; children: React.ReactNode };

const FieldShell = ({ label, error, hint, children }: FieldShellProps) => (
  <View style={styles.field}>
    <AppText variant="label">{label}</AppText>
    {children}
    {error ? (
      <AppText variant="small" color={colors.danger} style={styles.hint}>
        {error}
      </AppText>
    ) : hint ? (
      <AppText variant="small" style={styles.hint}>
        {hint}
      </AppText>
    ) : null}
  </View>
);

type TextFieldProps = Omit<TextInputProps, 'style'> & { label: string; error?: string; hint?: string };

export const TextField = ({ label, error, hint, ...input }: TextFieldProps) => (
  <FieldShell label={label} error={error} hint={hint}>
    <View style={[styles.box, error && styles.boxError]}>
      <Input
        placeholderTextColor="rgba(215, 185, 182, 0.55)"
        selectionColor={colors.gold}
        style={styles.input}
        accessibilityLabel={label}
        {...input}
      />
    </View>
  </FieldShell>
);

type PhoneFieldProps = {
  label: string;
  value: string;
  onChangeText: (digits: string) => void;
  error?: string;
  hint?: string;
  showCountryCode?: boolean;
  autoFocus?: boolean;
};

/** 10-digit Indian mobile number. Stores digits only. */
export const PhoneField = ({ label, value, onChangeText, error, hint, showCountryCode = true, autoFocus }: PhoneFieldProps) => (
  <FieldShell label={label} error={error} hint={hint}>
    <View style={[styles.box, styles.row, error && styles.boxError]}>
      {showCountryCode ? <AppText style={styles.prefix}>+91</AppText> : null}
      <Input
        value={formatPhoneForInput(value)}
        onChangeText={(text) => onChangeText(text.replace(/\D/g, '').slice(0, 10))}
        keyboardType="phone-pad"
        maxLength={11}
        placeholder="10-digit mobile number"
        placeholderTextColor="rgba(215, 185, 182, 0.55)"
        selectionColor={colors.gold}
        style={[styles.input, styles.flex]}
        accessibilityLabel={label}
        autoComplete="tel"
        textContentType="telephoneNumber"
        autoFocus={autoFocus}
      />
    </View>
  </FieldShell>
);

const formatPhoneForInput = (digits: string) =>
  digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;

type DateFieldProps = {
  label: string;
  /** ISO date YYYY-MM-DD, or '' when empty/incomplete */
  value: string;
  onChange: (isoDate: string) => void;
  error?: string;
};

/** DD / MM / YYYY masked input. */
export const DateField = ({ label, value, onChange, error }: DateFieldProps) => {
  const [digits, setDigits] = useState(() => isoDateToDigits(value));
  const [prevValue, setPrevValue] = useState(value);

  // Sync when the value is filled from outside (e.g. profile prefill) — adjust state during render.
  if (value !== prevValue) {
    setPrevValue(value);
    if (value && digitsToIsoDate(digits) !== value) setDigits(isoDateToDigits(value));
  }

  const handleChange = (text: string) => {
    const next = text.replace(/\D/g, '').slice(0, 8);
    setDigits(next);
    onChange(digitsToIsoDate(next));
  };

  return (
    <FieldShell label={label} error={error}>
      <View style={[styles.box, error && styles.boxError]}>
        <Input
          value={maskDate(digits)}
          onChangeText={handleChange}
          keyboardType="number-pad"
          placeholder="DD  /  MM  /  YYYY"
          placeholderTextColor="rgba(215, 185, 182, 0.55)"
          selectionColor={colors.gold}
          style={styles.input}
          accessibilityLabel={`${label}, day month year`}
        />
      </View>
    </FieldShell>
  );
};

const maskDate = (d: string) => {
  const parts = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean);
  return parts.join('  /  ');
};

type OptionFieldProps<T extends string> = {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
};

/** A field that expands into a list of choices. */
export const OptionField = <T extends string>({ label, value, options, onChange }: OptionFieldProps<T>) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <FieldShell label={label}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={[styles.box, styles.row]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}: ${selected?.label ?? ''}`}
      >
        <AppText style={[styles.input, styles.flex]}>{selected?.label}</AppText>
        <AppText variant="label">{open ? '▴' : '▾'}</AppText>
      </Pressable>
      {open ? (
        <View style={styles.options}>
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: option.value === value }}
            >
              <AppText variant="bodyCream" color={option.value === value ? colors.gold : colors.cream}>
                {option.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </FieldShell>
  );
};

type OtpInputProps = { value: string; onChange: (code: string) => void; length?: number };

export const OtpInput = ({ value, onChange, length = 6 }: OtpInputProps) => {
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(true);
  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.otpRow} accessibilityLabel="One-time code">
      {Array.from({ length }, (_, i) => {
        const active = focused && i === Math.min(value.length, length - 1);
        return (
          <View key={i} style={[styles.otpBox, active && styles.otpActive]}>
            <AppText style={styles.otpDigit}>{value[i] ?? ''}</AppText>
          </View>
        );
      })}
      <Input
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.hiddenInput}
        caretHidden
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  field: { gap: 8 },
  // Figma: 10 between the input box and its helper / error line.
  hint: { marginTop: 2 },
  box: {
    backgroundColor: colors.input,
    borderWidth,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: 16,
    minHeight: 54,
    justifyContent: 'center',
  },
  boxError: { borderColor: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flex: { flex: 1 },
  input: { fontFamily: fonts.sansRegular, fontSize: 15, color: colors.cream, paddingVertical: 14 },
  prefix: { fontFamily: fonts.sansRegular, fontSize: 15, color: colors.cream },
  options: {
    backgroundColor: colors.input,
    borderWidth,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingVertical: 4,
  },
  option: { paddingHorizontal: 16, paddingVertical: 12 },
  otpRow: { flexDirection: 'row', gap: 8 },
  otpBox: {
    flex: 1,
    height: 62,
    backgroundColor: colors.input,
    borderWidth,
    borderColor: colors.border,
    borderRadius: radii.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpActive: { borderColor: colors.gold },
  otpDigit: { fontFamily: fonts.sansRegular, fontSize: 25, lineHeight: 36, color: colors.cream },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
});
