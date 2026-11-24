import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ArrowCard, Card } from '@/components/Cards';
import { Input } from '@/components/Fields';
import { Heading } from '@/components/Heading';
import { Screen } from '@/components/Screen';
import { ApiError } from '@/lib/api';
import { firstName } from '@/lib/format';
import { useChatHistory, useEntitlement, useMe, useSendChat } from '@/lib/queries';
import type { ChatMessage } from '@/lib/types';
import { borderWidth, colors, fonts, radii } from '@/theme/tokens';

const SUGGESTIONS = [
  { title: 'Help me understand my numbers', subtitle: 'A good place to begin' },
  { title: 'How can I find more balance?', subtitle: 'Reflect on your natural tendencies' },
];

/** 18 · Chat — AI astrologer (astrologyapi.com via backend). Premium only. */
export default function Chat() {
  const me = useMe();
  const { isPremium } = useEntitlement();
  const history = useChatHistory();
  const send = useSendChat();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messages = history.data?.messages ?? [];
  const name = firstName(me.data?.fullName);

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || send.isPending) return;
    if (!isPremium) {
      router.push('/paywall');
      return;
    }
    setDraft('');
    send.mutate(question, {
      onSuccess: () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100),
      onError: () => setDraft(question),
    });
  };

  const intro = (
    <View style={styles.introBlock}>
      <Card style={styles.welcome}>
        <AppText variant="cardTitle" color={colors.gold} style={{ fontSize: 25 }}>
          {name ? `Welcome, ${name}.` : 'Welcome.'}
        </AppText>
        <AppText variant="bodyCream">
          We can explore your strengths, your personal cycles, or a question on your mind.{'\n'}Where would you like to
          begin?
        </AppText>
      </Card>
      {messages.length === 0 ? (
        <View style={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <ArrowCard key={s.title} title={s.title} subtitle={s.subtitle} titleSize={20} onPress={() => ask(s.title)} />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen
      scroll={false}
      withTabBar
      footer={
        <View>
          {send.error ? (
            <AppText variant="small" color={colors.danger} style={styles.error}>
              {send.error instanceof ApiError ? send.error.message : 'Message not sent. Please try again.'}
            </AppText>
          ) : null}
          <View style={styles.composer}>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder={isPremium ? 'Ask a question…' : 'Unlock Premium to ask a question…'}
              placeholderTextColor={colors.muted}
              selectionColor={colors.gold}
              style={styles.input}
              multiline
              maxLength={500}
              editable={!send.isPending}
              onFocus={() => {
                if (!isPremium) router.push('/paywall');
              }}
              accessibilityLabel="Ask a question"
            />
            <Pressable
              onPress={() => ask(draft)}
              disabled={send.isPending || (!draft.trim() && isPremium)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Send"
              style={({ pressed }) => [styles.send, pressed && { opacity: 0.6 }]}
            >
              <AppText style={styles.sendIcon}>↑</AppText>
            </Pressable>
          </View>
        </View>
      }
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (messages.length > 0) listRef.current?.scrollToEnd({ animated: false });
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Heading
              eyebrow="Your personal space"
              title={'A little clarity,\none question away.'}
              subtitle="Reflect on what your numbers mean to you."
            />
            {intro}
          </View>
        }
        renderItem={({ item }) => <Bubble message={item} />}
        ListFooterComponent={
          send.isPending ? <Bubble message={{ id: 'typing', role: 'astrologer', text: '…', createdAt: 0 }} /> : undefined
        }
      />
    </Screen>
  );
}

const Bubble = ({ message }: { message: ChatMessage }) => {
  const mine = message.role === 'user';
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      {!mine ? (
        <AppText variant="eyebrow" style={styles.bubbleName}>
          Ankveda astrologer
        </AppText>
      ) : null}
      <AppText variant="bodyCream">{message.text}</AppText>
    </View>
  );
};

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { paddingBottom: 16, gap: 12 },
  header: { gap: 43, marginBottom: 8 },
  introBlock: { gap: 38 },
  welcome: { padding: 18, gap: 14 },
  suggestions: { gap: 14 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderWidth,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingLeft: 14,
    paddingRight: 8,
    gap: 12,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    fontFamily: fonts.sansRegular,
    fontSize: 14,
    color: colors.cream,
    paddingVertical: 14,
  },
  send: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { fontFamily: fonts.sansRegular, fontSize: 23, lineHeight: 30, color: colors.gold },
  error: { marginBottom: 8 },
  bubble: { maxWidth: '86%', borderRadius: radii.card, paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.navActive },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth, borderColor: colors.border },
  bubbleName: { fontSize: 9, letterSpacing: 1.2 },
});
