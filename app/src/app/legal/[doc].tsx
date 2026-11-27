import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, TurboModuleRegistry, View } from 'react-native';
import type { WebViewNavigation } from 'react-native-webview';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { Loader } from '@/components/Loader';
import { Screen } from '@/components/Screen';
import { LEGAL_HOST } from '@/lib/config';
import { isLegalDoc, LEGAL_DOCS } from '@/lib/legal';
import { borderWidth, colors, radii } from '@/theme/tokens';

/**
 * Only load the WebView when its native module is in this binary. Importing it in a build made before
 * react-native-webview was added (or one receiving an OTA update) throws at startup and crashes the app,
 * because Expo Router loads every route eagerly. Without it, the page opens in the browser instead.
 */
const WebView: typeof import('react-native-webview').WebView | null = TurboModuleRegistry.get('RNCWebViewModule')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy, see above
    require('react-native-webview').WebView
  : null;

const goBack =() => (router.canGoBack() ? router.back() : router.replace('/'));

/** Hosted pages stay in the WebView; mail, phone and other sites open outside the app. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const isInternal = (url: string, docUrl: string) => {
  if (url === 'about:blank') return true;
  const host = hostOf(url);
  // The doc's own host too, in case an EXPO_PUBLIC_* override points a page elsewhere.
  return host !== null && (host === LEGAL_HOST || host === hostOf(docUrl));
};

const openOutside = (url: string) => {
  Linking.openURL(url).catch(() => undefined);
};

/** A legal page (privacy, terms, payment & cancellation, account deletion) in an in-app WebView. */
export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const info = isLegalDoc(doc) ? LEGAL_DOCS[doc] : null;
  const [failed, setFailed] = useState(false);
  // Changing the key remounts the WebView, which reloads the page from scratch.
  const [attempt, setAttempt] = useState(0);

  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  const onShouldStartLoadWithRequest = ({ url }: WebViewNavigation) => {
    if (!info || isInternal(url, info.url)) return true;
    openOutside(url);
    return false;
  };

  return (
    <Screen scroll={false} headerAction={{ label: 'Back', onPress: goBack }}>
      <View style={styles.heading}>
        <AppText variant="eyebrow">Legal & policies</AppText>
        <AppText variant="display" style={styles.title}>
          {info?.title ?? 'Page not found'}
        </AppText>
      </View>

      {!info ? (
        <Card style={styles.card}>
          <AppText variant="subtitle">Page not found</AppText>
          <AppText variant="small">This page is no longer available.</AppText>
        </Card>
      ) : !WebView ? (
        <Card style={styles.card}>
          <AppText variant="subtitle">{info.title}</AppText>
          <AppText variant="small">Update the app to read this page here. Meanwhile, you can open it in your browser.</AppText>
          <View style={styles.actions}>
            <PrimaryButton label="Open in browser" onPress={() => openOutside(info.url)} />
          </View>
        </Card>
      ) : failed ? (
        <Card style={styles.card}>
          <AppText variant="subtitle">Couldn’t load this page</AppText>
          <AppText variant="small">Check your internet connection and try again.</AppText>
          <View style={styles.actions}>
            <PrimaryButton label="Try again" onPress={retry} />
            <PrimaryButton label="Open in browser" tone="card" onPress={() => openOutside(info.url)} />
          </View>
        </Card>
      ) : (
        <View style={styles.frame}>
          <WebView
            key={attempt}
            source={{ uri: info.url }}
            style={styles.web}
            containerStyle={styles.web}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <Loader size="md" />
              </View>
            )}
            onError={() => setFailed(true)}
            onHttpError={({ nativeEvent }) => {
              if (nativeEvent.statusCode >= 400) setFailed(true);
            }}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            setSupportMultipleWindows={false}
            originWhitelist={['https://*', 'http://*', 'mailto:*', 'tel:*']}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            sharedCookiesEnabled={false}
            accessibilityLabel={info.title}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 12, marginBottom: 20 },
  title: { fontSize: 36 },
  card: { padding: 18, gap: 6 },
  actions: { marginTop: 14, gap: 12 },
  frame: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radii.card,
    borderWidth,
    borderColor: colors.ringMuted,
    backgroundColor: colors.backgroundTop,
  },
  web: { flex: 1, backgroundColor: colors.backgroundTop },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundTop,
  },
});
