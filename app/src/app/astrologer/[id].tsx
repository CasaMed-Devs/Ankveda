import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { Input, TextField } from '@/components/Fields';
import { Loader } from '@/components/Loader';
import { Screen } from '@/components/Screen';
import { TypingDots } from '@/components/TypingDots';
import { ApiError } from '@/lib/api';
import { dayLabel, firstName, formatTime, sameDay } from '@/lib/format';
import { useAstrologer, useChatMessages, useEntitlement, useMe, useSaveChatContext, useSendChat } from '@/lib/queries';
import type { Astrologer, ChatMessage, RequiredInput } from '@/lib/types';
import { borderWidth, colors, fonts, radii } from '@/theme/tokens';

/** Rows of the (inverted) message list, newest first. */
type Row =
  | { kind: 'message'; key: string; message: ChatMessage; pending?: boolean }
  | { kind: 'typing'; key: string }
  | { kind: 'day'; key: string; label: string }
  | { kind: 'intro'; key: string };

/** 1:1 chat with an astrologer. History is stored by Persona API and loaded page by page. */
export default function AstrologerChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const astrologerId = String(id);
  const me = useMe();
  const { isPremium } = useEntitlement();
  const astrologer = useAstrologer(astrologerId);
  const history = useChatMessages(astrologerId, isPremium);
  const send = useSendChat(astrologerId);
  const [draft, setDraft] = useState('');

  const pages = history.data?.pages;
  const missing = pages?.[0]?.missing ?? [];
  const needsDetails = isPremium && missing.length > 0;
  const messages = useMemo(() => (pages ?? []).slice().reverse().flatMap((p) => p.messages), [pages]);
  const atStart = !history.hasNextPage;
  const pendingText = send.isPending ? send.variables : undefined;

  const rows = useMemo(() => buildRows(messages, atStart, pendingText), [messages, atStart, pendingText]);

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || send.isPending) return;
    if (!isPremium) {
      router.push('/paywall');
      return;
    }
    if (needsDetails) return;
    setDraft('');
    send.mutate(question, { onError: () => setDraft(question) });
  };

  const a = astrologer.data;
  if (!a) {
    return (
      <Screen showBrand={false} scroll={false}>
        <BackHeader />
        <View style={styles.center}>
          {astrologer.isPending ? (
            <Loader size="md" />
          ) : (
            <AppText variant="small" align="center">
              This astrologer is not available right now.
            </AppText>
          )}
        </View>
      </Screen>
    );
  }

  // Until the user's plan is known and the newest history has been fetched from the API, only the
  // loader shows, so the greeting and openers never appear in place of an existing conversation.
  const loading =
    me.isPending || (isPremium && (history.isPending || (history.isFetching && !history.isFetchedAfterMount)));
  const showOpeners =
    !loading && !needsDetails && messages.length === 0 && !send.isPending && (!isPremium || history.isSuccess);

  return (
    <Screen
      showBrand={false}
      scroll={false}
      footer={
        needsDetails ? null : (
          <Composer
            astrologer={a}
            draft={draft}
            setDraft={setDraft}
            isPremium={isPremium}
            disabled={loading}
            sending={send.isPending}
            error={send.error}
            onSend={() => ask(draft)}
          />
        )
      }
    >
      <ChatHeader astrologer={a} />
      {loading ? (
        <View style={styles.center}>
          <Loader size="lg" />
          <AppText variant="small" align="center">
            Loading your conversation…
          </AppText>
        </View>
      ) : (
      <FlatList
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => <RowView row={item} astrologer={a} />}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
        }}
        // Inverted: the header sits at the bottom (above the composer), the footer at the top.
        ListHeaderComponent={
          <View style={styles.bottomArea}>
            {history.isError ? (
              <Pressable onPress={() => void history.refetch()} accessibilityRole="button">
                <AppText variant="small" color={colors.danger} align="center">
                  {history.error instanceof ApiError ? history.error.message : 'Chat could not be loaded.'} Tap to retry.
                </AppText>
              </Pressable>
            ) : null}
            {needsDetails ? <DetailsForm astrologer={a} missing={missing} /> : null}
            {showOpeners && a.openers.length ? (
              <View style={styles.openers}>
                {a.openers.map((opener) => (
                  <Pressable
                    key={opener}
                    onPress={() => ask(opener)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.opener, pressed && styles.pressed]}
                  >
                    <AppText variant="small" color={colors.cream}>
                      {opener}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        }
        ListFooterComponent={
          history.isFetchingNextPage ? <Loader size="sm" style={styles.loading} /> : undefined
        }
      />
      )}
    </Screen>
  );
}

/** Chronological rows with day separators, returned newest first for the inverted list. */
const buildRows = (messages: ChatMessage[], atStart: boolean, pendingText?: string): Row[] => {
  const rows: Row[] = [];
  if (atStart) rows.push({ kind: 'intro', key: 'intro' });
  const now = Date.now();
  const all: { message: ChatMessage; pending?: boolean }[] = messages.map((message) => ({ message }));
  if (pendingText) all.push({ message: { id: 'pending', role: 'user', text: pendingText, createdAt: now }, pending: true });

  let previous: number | null = null;
  for (const { message, pending } of all) {
    if (previous === null || !sameDay(previous, message.createdAt)) {
      rows.push({ kind: 'day', key: `day-${message.createdAt}`, label: dayLabel(message.createdAt) });
    }
    previous = message.createdAt;
    rows.push({ kind: 'message', key: pending ? 'pending' : `m-${message.id}`, message, pending });
  }
  if (pendingText) rows.push({ kind: 'typing', key: 'typing' });
  return rows.reverse();
};

const RowView = ({ row, astrologer }: { row: Row; astrologer: Astrologer }) => {
  switch (row.kind) {
    case 'intro':
      return <Intro astrologer={astrologer} />;
    case 'day':
      return (
        <View style={styles.dayRow}>
          <View style={styles.dayLine} />
          <AppText variant="caption" style={styles.dayText}>
            {row.label}
          </AppText>
          <View style={styles.dayLine} />
        </View>
      );
    case 'typing':
      return (
        <View style={[styles.bubble, styles.theirs, styles.typingBubble]}>
          <TypingDots />
        </View>
      );
    case 'message':
      return <Bubble message={row.message} pending={row.pending} />;
  }
};

/** Profile card + greeting at the very beginning of the conversation. */
const Intro = ({ astrologer }: { astrologer: Astrologer }) => (
  <View style={styles.intro}>
    <Card tone="soft" style={styles.profileCard}>
      <Avatar uri={astrologer.photoUrl} name={astrologer.name} size={84} />
      <AppText variant="cardTitle" align="center" style={styles.profileName}>
        {astrologer.name}
      </AppText>
      <AppText variant="label" align="center">
        {astrologer.speciality}
      </AppText>
      <AppText variant="caption" align="center">
        {astrologer.city} · {astrologer.age} yrs
      </AppText>
      {astrologer.about ? (
        <AppText variant="small" align="center" style={styles.about}>
          {astrologer.about}
        </AppText>
      ) : null}
    </Card>
    {astrologer.greeting ? (
      <View style={[styles.bubble, styles.theirs]}>
        <AppText variant="bodyCream">{astrologer.greeting}</AppText>
      </View>
    ) : null}
  </View>
);

const Bubble = ({ message, pending }: { message: ChatMessage; pending?: boolean }) => {
  const mine = message.role === 'user';
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      <AppText variant="bodyCream" selectable>
        {message.text}
      </AppText>
      <AppText variant="caption" style={[styles.time, mine && styles.timeMine]}>
        {pending ? 'Sending…' : formatTime(message.createdAt)}
      </AppText>
    </View>
  );
};

const BackHeader = () => (
  <Pressable
    onPress={() => (router.canGoBack() ? router.back() : router.replace('/chat'))}
    hitSlop={12}
    accessibilityRole="button"
    accessibilityLabel="Back"
    style={styles.back}
  >
    <AppText style={styles.backIcon}>‹</AppText>
  </Pressable>
);

const ChatHeader = ({ astrologer }: { astrologer: Astrologer }) => (
  <View style={styles.header}>
    <BackHeader />
    <Avatar uri={astrologer.photoUrl} name={astrologer.name} size={42} />
    <View style={styles.headerText}>
      <AppText variant="subtitle" numberOfLines={1}>
        {astrologer.name}
      </AppText>
      <AppText variant="caption" numberOfLines={1}>
        {astrologer.speciality} · {astrologer.city}
      </AppText>
    </View>
  </View>
);

type ComposerProps = {
  astrologer: Astrologer;
  draft: string;
  setDraft: (text: string) => void;
  isPremium: boolean;
  disabled: boolean;
  sending: boolean;
  error: Error | null;
  onSend: () => void;
};

const Composer = ({ astrologer, draft, setDraft, isPremium, disabled, sending, error, onSend }: ComposerProps) => (
  <View>
    {error ? (
      <AppText variant="small" color={colors.danger} style={styles.error}>
        {error instanceof ApiError ? error.message : 'Message not sent. Please try again.'}
      </AppText>
    ) : null}
    <View style={styles.composer}>
      <Input
        value={draft}
        onChangeText={setDraft}
        placeholder={isPremium ? `Message ${firstName(astrologer.name)}…` : 'Unlock Premium to start chatting…'}
        placeholderTextColor={colors.muted}
        selectionColor={colors.gold}
        style={styles.input}
        multiline
        maxLength={1000}
        editable={!sending && !disabled}
        showSoftInputOnFocus={isPremium}
        onFocus={() => {
          if (!isPremium) router.push('/paywall');
        }}
        accessibilityLabel={`Message ${astrologer.name}`}
      />
      <Pressable
        onPress={onSend}
        disabled={disabled || sending || (isPremium && !draft.trim())}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Send"
        style={({ pressed }) => [
          styles.send,
          (disabled || sending || (isPremium && !draft.trim())) && styles.sendDisabled,
          pressed && styles.pressed,
        ]}
      >
        {sending ? <ActivityIndicator size="small" color={colors.onGold} /> : <AppText style={styles.sendIcon}>↑</AppText>}
      </Pressable>
    </View>
  </View>
);

/** Fields the astrologer needs (birth time, place, partner's details…), asked once and remembered. */
const DetailsForm = ({ astrologer, missing }: { astrologer: Astrologer; missing: string[] }) => {
  const me = useMe();
  const save = useSaveChatContext(astrologer.id);
  const inputs = astrologer.requiredInputs.filter((input) => missing.includes(input.key));
  const [values, setValues] = useState<Record<string, string>>(() => ({
    tob: me.data?.birthTime ?? '',
    pob: me.data?.birthPlace ?? '',
  }));
  const complete = inputs.every((input) => values[input.key]?.trim());

  return (
    <Card style={styles.form}>
      <AppText variant="eyebrow">Before we begin</AppText>
      <AppText variant="subtitle">
        {firstName(astrologer.name)} needs a few birth details to read your chart.
      </AppText>
      <View style={styles.formFields}>
        {inputs.map((input) => (
          <DetailField
            key={input.key}
            input={input}
            value={values[input.key] ?? ''}
            onChange={(text) => setValues((v) => ({ ...v, [input.key]: text }))}
          />
        ))}
      </View>
      {save.error ? (
        <AppText variant="small" color={colors.danger}>
          {save.error instanceof ApiError ? save.error.message : 'Could not save. Please try again.'}
        </AppText>
      ) : null}
      <PrimaryButton label="Save and start chatting" loading={save.isPending} disabled={!complete} onPress={() => save.mutate(values)} />
      <AppText variant="caption" align="center">
        Birth time and place are saved to your profile, so you only enter them once.
      </AppText>
    </Card>
  );
};

const isTimeKey = (key: string) => key.endsWith('tob');
const isDateKey = (key: string) => key.endsWith('dob');

/** "1435" → "14:35" while typing. */
const maskTime = (text: string) => {
  const digits = text.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
};

/** "19931102" → "1993-11-02" while typing. */
const maskDate = (text: string) => {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  if (digits.length > 4) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return digits;
};

const DetailField = ({ input, value, onChange }: { input: RequiredInput; value: string; onChange: (text: string) => void }) => {
  const time = isTimeKey(input.key);
  const date = isDateKey(input.key);
  return (
    <TextField
      label={input.label}
      value={value}
      onChangeText={(text) => onChange(time ? maskTime(text) : date ? maskDate(text) : text)}
      placeholder={time ? 'HH:MM (24 hour), e.g. 14:35' : date ? 'YYYY-MM-DD' : input.example ? `e.g. ${input.example}` : ''}
      keyboardType={time || date ? 'number-pad' : 'default'}
      maxLength={time ? 5 : date ? 10 : 120}
      autoCapitalize={time || date ? 'none' : 'words'}
    />
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: borderWidth,
    borderBottomColor: colors.ringMuted,
  },
  back: { width: 28, height: 40, justifyContent: 'center' },
  backIcon: { fontFamily: fonts.sansRegular, fontSize: 34, lineHeight: 38, color: colors.gold },
  headerText: { flex: 1, gap: 1 },
  list: { flex: 1 },
  listContent: { paddingTop: 12, paddingBottom: 16, gap: 10 },
  bottomArea: { gap: 12 },
  loading: { marginVertical: 12 },
  intro: { gap: 14, marginBottom: 4 },
  profileCard: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 20, gap: 6 },
  profileName: { marginTop: 8 },
  about: { marginTop: 6 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  dayLine: { flex: 1, height: borderWidth, backgroundColor: colors.ringMuted },
  dayText: { letterSpacing: 0.6 },
  bubble: { maxWidth: '84%', borderRadius: radii.card, paddingHorizontal: 15, paddingTop: 10, paddingBottom: 6, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.navActive, borderBottomRightRadius: 6 },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderWidth,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
  },
  typingBubble: { paddingVertical: 10 },
  time: { fontSize: 10, lineHeight: 14, alignSelf: 'flex-start' },
  timeMine: { alignSelf: 'flex-end' },
  openers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  opener: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth,
    borderColor: colors.gold,
    backgroundColor: colors.cardSoft,
  },
  pressed: { opacity: 0.6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.input,
    borderWidth,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 10,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    fontFamily: fonts.sansRegular,
    fontSize: 14,
    color: colors.cream,
    paddingVertical: 8,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  sendDisabled: { opacity: 0.4 },
  sendIcon: { fontFamily: fonts.sansBold, fontSize: 20, lineHeight: 24, color: colors.onGold },
  error: { marginBottom: 8 },
  form: { padding: 18, gap: 12 },
  formFields: { gap: 14 },
});
