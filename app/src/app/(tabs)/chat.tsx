import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Cards';
import { Input } from '@/components/Fields';
import { Heading } from '@/components/Heading';
import { Screen, TAB_BAR_SPACE } from '@/components/Screen';
import { ApiError } from '@/lib/api';
import { useAstrologers, useConversations, useEntitlement } from '@/lib/queries';
import type { Astrologer, ConversationSummary } from '@/lib/types';
import { borderWidth, colors, fonts, radii } from '@/theme/tokens';

/** 18 · Chat — choose an astrologer (Persona API personas via the backend). */
export default function Chat() {
  const { isPremium } = useEntitlement();
  const insets = useSafeAreaInsets();
  const astrologers = useAstrologers();
  const conversations = useConversations(isPremium);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const list = astrologers.data ?? [];
    const recent = new Map((conversations.data ?? []).map((c) => [c.astrologerId, c]));
    const query = search.trim().toLowerCase();
    const matches = query
      ? list.filter((a) => `${a.name} ${a.speciality} ${a.city}`.toLowerCase().includes(query))
      : list;
    // Astrologers the user already talks to come first, most recent on top.
    return matches
      .map((astrologer) => ({ astrologer, conversation: recent.get(astrologer.id) }))
      .sort((a, b) => (b.conversation?.updatedAt ?? 0) - (a.conversation?.updatedAt ?? 0));
  }, [astrologers.data, conversations.data, search]);

  const refresh = () => {
    void astrologers.refetch();
    if (isPremium) void conversations.refetch();
  };

  const header = (
    <View style={styles.header}>
      <Heading
        eyebrow="Your personal space"
        title="Talk to an astrologer."
        subtitle="Choose an expert and ask what is on your mind."
        gap={8}
      />
      <View style={styles.search}>
        <AppText style={styles.searchIcon} allowFontScaling={false}>
          ⌕
        </AppText>
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, speciality or city"
          placeholderTextColor={colors.muted}
          selectionColor={colors.gold}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search astrologers"
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <AppText variant="label">Clear</AppText>
          </Pressable>
        ) : null}
      </View>
      {astrologers.data ? (
        <AppText variant="caption">
          {search ? `${rows.length} of ${astrologers.data.length} astrologers` : `${astrologers.data.length} astrologers`}
        </AppText>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false} bleedBottom>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.astrologer.id}
        renderItem={({ item }) => <AstrologerCard astrologer={item.astrologer} conversation={item.conversation} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          astrologers.isPending ? (
            <Skeleton />
          ) : astrologers.isError ? (
            <ErrorCard error={astrologers.error} onRetry={refresh} />
          ) : (
            <AppText variant="small" align="center" style={styles.empty}>
              No astrologer matches “{search.trim()}”.
            </AppText>
          )
        }
        // The list runs under the floating tab bar; the last card can still scroll fully above it.
        contentContainerStyle={[styles.listContent, { paddingBottom: TAB_BAR_SPACE + insets.bottom + 16 }]}
        style={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={astrologers.isRefetching}
            onRefresh={refresh}
            tintColor={colors.gold}
            colors={[colors.gold]}
            progressBackgroundColor={colors.card}
          />
        }
      />
    </Screen>
  );
}

const AstrologerCard = memo(function AstrologerCard({
  astrologer,
  conversation,
}: {
  astrologer: Astrologer;
  conversation?: ConversationSummary;
}) {
  const preview = conversation?.lastMessage;
  return (
    <Card
      onPress={() => router.push({ pathname: '/astrologer/[id]', params: { id: astrologer.id } })}
      style={styles.card}
      accessibilityLabel={`${astrologer.name}, ${astrologer.speciality}, ${astrologer.city}, ${astrologer.age} years`}
    >
      <Avatar uri={astrologer.photoUrl} name={astrologer.name} size={56} />
      <View style={styles.cardText}>
        <AppText variant="cardTitle" numberOfLines={1} style={styles.name}>
          {astrologer.name}
        </AppText>
        <AppText variant="label" numberOfLines={1}>
          {astrologer.speciality}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {astrologer.city} · {astrologer.age} yrs
        </AppText>
        {preview ? (
          <AppText variant="caption" numberOfLines={1} color={colors.creamSoft} style={styles.preview}>
            {preview.role === 'user' ? 'You: ' : ''}
            {preview.text.replace(/\s+/g, ' ')}
          </AppText>
        ) : null}
      </View>
      <View style={styles.side}>
        {conversation ? (
          <View style={styles.continue}>
            <AppText variant="eyebrow" style={styles.continueText}>
              Continue
            </AppText>
          </View>
        ) : null}
        <AppText variant="arrow">→</AppText>
      </View>
    </Card>
  );
});

const Skeleton = () => (
  <View style={styles.skeletonList} accessibilityLabel="Loading astrologers">
    {[0, 1, 2, 3, 4].map((i) => (
      <View key={i} style={[styles.card, styles.skeletonCard]}>
        <View style={styles.skeletonAvatar} />
        <View style={styles.cardText}>
          <View style={[styles.skeletonLine, { width: '62%', height: 16 }]} />
          <View style={[styles.skeletonLine, { width: '44%' }]} />
          <View style={[styles.skeletonLine, { width: '30%' }]} />
        </View>
      </View>
    ))}
  </View>
);

const ErrorCard = ({ error, onRetry }: { error: Error; onRetry: () => void }) => (
  <Card style={styles.errorCard}>
    <AppText variant="subtitle">Astrologers could not be loaded.</AppText>
    <AppText variant="small">{error instanceof ApiError ? error.message : 'Please check your connection.'}</AppText>
    <Pressable onPress={onRetry} hitSlop={10} accessibilityRole="button">
      <AppText variant="label" style={styles.retry}>
        Try again →
      </AppText>
    </Pressable>
  </Card>
);

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { gap: 10 },
  header: { gap: 16, marginBottom: 4 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.input,
    borderWidth,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
  },
  searchIcon: { fontFamily: fonts.sansRegular, fontSize: 20, color: colors.gold },
  searchInput: { flex: 1, fontFamily: fonts.sansRegular, fontSize: 14, color: colors.cream, paddingVertical: 11 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardText: { flex: 1, gap: 3 },
  name: { fontSize: 21, lineHeight: 24 },
  preview: { marginTop: 2 },
  side: { alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  continue: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth,
    borderColor: colors.gold,
  },
  continueText: { fontSize: 8, lineHeight: 12, letterSpacing: 1 },
  empty: { marginTop: 32 },
  skeletonList: { gap: 12 },
  skeletonCard: { backgroundColor: colors.card, borderRadius: radii.card, opacity: 0.55 },
  skeletonAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.navActive },
  skeletonLine: { height: 11, borderRadius: 6, backgroundColor: colors.navActive },
  errorCard: { padding: 18, gap: 10 },
  retry: { marginTop: 4, fontSize: 13 },
});
