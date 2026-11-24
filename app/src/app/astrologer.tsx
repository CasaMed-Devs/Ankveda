import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { LinkButton, PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { Screen } from '@/components/Screen';

/** Consult with an Astrologer — placeholder (product decision: "coming soon" for v1). */
export default function Astrologer() {
  return (
    <Screen
      footer={
        <>
          <PrimaryButton label="Ask our AI astrologer in Chat" onPress={() => router.navigate('/chat')} />
          <LinkButton label="Back to report choices" onPress={() => router.back()} />
        </>
      }
    >
      <Heading
        eyebrow="Personal guidance"
        title={'Consult with\nan Astrologer.'}
        subtitle="One-to-one sessions with experienced astrologers."
      />
      <Card tone="soft" style={styles.card}>
        <AppText variant="eyebrow" style={{ letterSpacing: 1.7 }}>
          Coming soon
        </AppText>
        <AppText variant="title">We’re preparing something personal.</AppText>
        <AppText variant="small" style={{ fontSize: 13, lineHeight: 19 }}>
          Soon you’ll be able to speak with an astrologer about your numbers, your timing and the questions on your mind.
          Until then, our AI astrologer is always here in Chat.
        </AppText>
      </Card>
      <View style={styles.spacer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 40, paddingHorizontal: 22, paddingVertical: 20, gap: 14 },
  spacer: { height: 24 },
});
