import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { TextField } from '@/components/Fields';
import { borderWidth, colors, radii } from '@/theme/tokens';

/**
 * The app's own alert (replaces the system Alert): maroon card, gold title, stacked buttons.
 *
 *   appAlert({ title, message, bullets, actions: [{ label, style, onPress }], confirmText })
 *
 * - `style`: 'default' (gold), 'cancel' (maroon outline), 'destructive' (coral outline).
 * - An async `onPress` shows a spinner and keeps the alert open; if it throws, the error is shown
 *   inside the alert so the user can retry or cancel. It closes when the promise resolves.
 * - `confirmText` (e.g. "DELETE") adds a field; destructive actions stay disabled until it matches.
 */
export type AlertAction = {
  label: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
};

export type AlertOptions = {
  title: string;
  message?: string;
  bullets?: string[];
  actions?: AlertAction[];
  confirmText?: string;
};

type Show = (options: AlertOptions) => void;

const AlertContext = createContext<Show | null>(null);
let imperativeShow: Show | null = null;

/** Show an app alert from anywhere (hooks, callbacks). Falls back to the system alert before mount. */
export const appAlert: Show = (options) => {
  if (imperativeShow) return imperativeShow(options);
  Alert.alert(options.title, [options.message, ...(options.bullets ?? [])].filter(Boolean).join('\n'));
};

export const useAppAlert = () => {
  const show = useContext(AlertContext);
  return show ?? appAlert;
};

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.');

export const AlertProvider = ({ children }: { children: ReactNode }) => {
  const [current, setCurrent] = useState<AlertOptions | null>(null);
  const queue = useRef<AlertOptions[]>([]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback<Show>((options) => {
    setCurrent((open) => {
      if (open) {
        queue.current.push(options);
        return open;
      }
      return options;
    });
  }, []);

  useEffect(() => {
    imperativeShow = show;
    return () => {
      if (imperativeShow === show) imperativeShow = null;
    };
  }, [show]);

  const close = useCallback(() => {
    setTyped('');
    setBusy(null);
    setError(null);
    setCurrent(queue.current.shift() ?? null);
  }, []);

  const actions: AlertAction[] = current?.actions?.length ? current.actions : [{ label: 'OK' }];
  const confirmed = !current?.confirmText || typed.trim().toUpperCase() === current.confirmText.toUpperCase();

  const press = async (action: AlertAction, index: number) => {
    if (busy !== null) return;
    const result = action.onPress?.();
    if (result && typeof (result as Promise<void>).then === 'function') {
      setBusy(index);
      setError(null);
      try {
        await result;
        close();
      } catch (e) {
        setError(errorText(e));
        setBusy(null);
      }
      return;
    }
    close();
  };

  // Back button / backdrop = the cancel action (or simply close when there is only an OK).
  const dismiss = () => {
    if (busy !== null || !current) return;
    const cancel = actions.find((a) => a.style === 'cancel');
    if (cancel) void press(cancel, actions.indexOf(cancel));
    else if (actions.length === 1) void press(actions[0]!, 0);
  };

  return (
    <AlertContext.Provider value={show}>
      {children}
      <Modal visible={!!current} transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close" accessibilityRole="button" />
          {current ? (
            <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
              <View style={styles.ornament} />
              <AppText variant="cardTitle" align="center" style={styles.title}>
                {current.title}
              </AppText>
              {current.message ? (
                <AppText variant="body" align="center">
                  {current.message}
                </AppText>
              ) : null}
              {current.bullets?.length ? (
                <View style={styles.bullets}>
                  {current.bullets.map((line) => (
                    <View key={line} style={styles.bulletRow}>
                      <View style={styles.dot} />
                      <AppText variant="small" style={styles.bulletText}>
                        {line}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : null}
              {current.confirmText ? (
                <View style={styles.confirm}>
                  <TextField
                    label={`Type ${current.confirmText} to confirm`}
                    value={typed}
                    onChangeText={setTyped}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder={current.confirmText}
                    editable={busy === null}
                  />
                </View>
              ) : null}
              {error ? (
                <AppText variant="small" align="center" color={colors.danger} style={styles.error} accessibilityLiveRegion="polite">
                  {error}
                </AppText>
              ) : null}
              <View style={styles.actions}>
                {actions.map((action, index) => (
                  <PrimaryButton
                    key={action.label}
                    label={action.label}
                    tone={action.style === 'cancel' ? 'card' : action.style === 'destructive' ? 'danger' : 'gradient'}
                    loading={busy === index}
                    disabled={(busy !== null && busy !== index) || (action.style === 'destructive' && !confirmed)}
                    onPress={() => void press(action, index)}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </AlertContext.Provider>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(20, 3, 8, 0.72)' },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: radii.card + 4,
    borderWidth,
    borderColor: colors.border,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 22,
    gap: 10,
    shadowColor: colors.gold,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  ornament: { alignSelf: 'center', width: 36, height: 3, borderRadius: 2, backgroundColor: colors.gold, opacity: 0.7, marginBottom: 6 },
  title: { marginBottom: 2 },
  bullets: { marginTop: 6, gap: 8 },
  bulletRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.gold, marginTop: 7 },
  bulletText: { flex: 1, color: colors.creamSoft },
  confirm: { marginTop: 8 },
  error: { marginTop: 2 },
  actions: { marginTop: 10, gap: 10 },
});
