import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { borderWidth, colors, radii } from '@/theme/tokens';

/**
 * Short, non-blocking confirmations ("Signed out", "Invoice saved"). Slides in under the status bar,
 * auto-hides after ~3 s, tap to dismiss. Use the app alert (components/AppAlert) for anything the
 * user must read or decide on.
 *
 *   toast.success('Invoice saved')   toast.error('Could not save')   toast.info('…')
 */
type Tone = 'success' | 'error' | 'info';
type ToastItem = { id: number; tone: Tone; message: string };
type Push = (tone: Tone, message: string) => void;

const ToastContext = createContext<Push | null>(null);
let imperativePush: Push | null = null;

export const toast = {
  success: (message: string) => imperativePush?.('success', message),
  error: (message: string) => imperativePush?.('error', message),
  info: (message: string) => imperativePush?.('info', message),
};

export const useToast = () => {
  const push = useContext(ToastContext);
  return {
    success: (m: string) => push?.('success', m),
    error: (m: string) => push?.('error', m),
    info: (m: string) => push?.('info', m),
  };
};

const ACCENT: Record<Tone, string> = { success: colors.gold, error: colors.danger, info: colors.muted };
const MARK: Record<Tone, string> = { success: '✓', error: '!', info: 'i' };
const VISIBLE_MS = 3200;

const ToastView = ({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) => {
  // Created once (state, not a ref): the value is read during render for the animated style.
  const [anim] = useState(() => new Animated.Value(0));
  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => onDone(item.id));
  }, [anim, item.id, onDone]);

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 70 }).start();
    AccessibilityInfo.announceForAccessibility(item.message);
    const t = setTimeout(hide, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [anim, hide, item.message]);

  return (
    <Animated.View
      style={[
        styles.toast,
        { borderLeftColor: ACCENT[item.tone] },
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] },
      ]}
    >
      <Pressable onPress={hide} style={styles.inner} accessibilityRole="button" accessibilityLabel={`${item.message}. Dismiss`}>
        <View style={[styles.mark, { borderColor: ACCENT[item.tone] }]}>
          <AppText variant="caption" color={ACCENT[item.tone]} style={styles.markText}>
            {MARK[item.tone]}
          </AppText>
        </View>
        <AppText variant="bodyCream" style={styles.message} numberOfLines={3}>
          {item.message}
        </AppText>
      </Pressable>
    </Animated.View>
  );
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback<Push>((tone, message) => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-1), { id, tone, message }]); // at most two on screen
  }, []);
  const done = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  useEffect(() => {
    imperativePush = push;
    return () => {
      if (imperativePush === push) imperativePush = null;
    };
  }, [push]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <View pointerEvents="box-none" style={[styles.stack, { top: insets.top + 8 }]}>
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDone={done} />
        ))}
      </View>
    </ToastContext.Provider>
  );
};

const styles = StyleSheet.create({
  stack: { position: 'absolute', left: 16, right: 16, gap: 8, zIndex: 1000, elevation: 1000 },
  toast: {
    borderRadius: radii.input,
    backgroundColor: colors.navBackground,
    borderWidth,
    borderColor: colors.border,
    borderLeftWidth: 3,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  mark: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  markText: { fontWeight: '700', lineHeight: 14 },
  message: { flex: 1 },
});
