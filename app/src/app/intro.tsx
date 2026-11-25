import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { NumberDial } from '@/components/NumberDial';
import { ScreenBackground } from '@/components/Screen';
import { useAuthStore } from '@/lib/auth-store';
import { colors, fonts, spacing } from '@/theme/tokens';

type Slide = { key: string; cta: string; render: () => React.ReactNode };

type TextStyleProp = React.ComponentProps<typeof AppText>['style'];

/** Line box tall enough for Cormorant's full ascent + descent on Android (hhea and win metrics). */
const SAFE_LINE = 1.4;

/**
 * Tight-leading serif text whose descenders (g, y, p) stay fully visible.
 *
 * Cormorant's glyphs need ~1.21–1.38em, but the Figma leading here is ~1.05em. Android shrinks the
 * line box to lineHeight and clips the text view to it, cutting the tails off g / y. Padding doesn't
 * help (TextView clips it too). So each line is its own Text with a roomy lineHeight, and equal
 * negative top/bottom margins pull it back: baselines land exactly where the design's lineHeight
 * puts them, but nothing is clipped.
 */
const SerifLines = ({
  text,
  style,
  allowFontScaling,
}: {
  text: string;
  style: TextStyleProp;
  allowFontScaling?: boolean;
}) => {
  const { fontSize = 16, lineHeight } = StyleSheet.flatten(style) ?? {};
  const designLine = lineHeight ?? fontSize;
  const extra = Math.max(0, Math.ceil((fontSize * SAFE_LINE - designLine) / 2));
  const lineStyle = { lineHeight: designLine + extra * 2, marginVertical: -extra };

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text.replace(/\n/g, ' ')}>
      {text.split('\n').map((line, i) => (
        <AppText
          key={i}
          style={[style, lineStyle]}
          allowFontScaling={allowFontScaling}
          importantForAccessibility="no"
        >
          {line}
        </AppText>
      ))}
    </View>
  );
};

/** Hero headline: fixed size (display type, matches Figma on every phone). */
const Hero = ({ children, style }: { children: string; style: TextStyleProp }) => (
  <SerifLines text={children} style={style} allowFontScaling={false} />
);

/**
 * Title stays at the top (Figma: 48 below the brand); the visual block is centred in the
 * remaining height, so taller phones don't get an empty band above the dots.
 */
const SlideLayout = ({ title, children }: { title: React.ReactNode; children: React.ReactNode }) => (
  <View style={styles.slideBody}>
    <View style={styles.titleGroup}>{title}</View>
    <View style={styles.visual}>{children}</View>
  </View>
);

const NumbersSlide = () => (
  <SlideLayout
    title={
      <>
        <Hero style={[styles.heroSerif, { fontSize: 48, lineHeight: 50 }]}>{'Your Numbers\nCan Shape'}</Hero>
        <Hero style={[styles.heroItalic, { fontSize: 53, lineHeight: 56 }]}>Your Future</Hero>
      </>
    }
  >
    <NumberDial value={7} />
    <AppText variant="small" align="center" color={colors.cream} style={styles.dialCaption}>
      {'Personality   /   Opportunities   /   Future'}
    </AppText>
  </SlideLayout>
);

const CHANGE_ITEMS = [
  { glyph: 'A', title: 'Name', body: 'Change a letter and\nattract better opportunities' },
  { glyph: '01', title: 'Phone Number', body: 'Find a number that\nbrings luck and growth' },
  { glyph: '07', title: 'Car Number', body: 'Choose a number for\nsmoother journeys' },
];

const ChangeSlide = () => (
  <SlideLayout
    title={
      <>
        <Hero style={[styles.heroMedium, { fontSize: 43, lineHeight: 45 }]}>Change a Number,</Hero>
        <Hero style={[styles.heroItalic, { fontSize: 42, lineHeight: 45 }]}>Change Your Results</Hero>
      </>
    }
  >
    <View style={styles.changeList}>
      {CHANGE_ITEMS.map((item) => (
        <Card key={item.title} tone="soft" style={styles.changeCard}>
          <AppText style={styles.changeGlyph} allowFontScaling={false}>
            {item.glyph}
          </AppText>
          <View style={styles.changeText}>
            <AppText style={styles.changeTitle}>{item.title}</AppText>
            <AppText variant="body" style={styles.changeBody}>
              {item.body}
            </AppText>
          </View>
        </Card>
      ))}
    </View>
  </SlideLayout>
);

const LuckySlide = () => (
  <SlideLayout
    title={
      <>
        <Hero style={[styles.heroMedium, { fontSize: 50, lineHeight: 52 }]}>Get Your</Hero>
        <Hero style={[styles.heroItalic, { fontSize: 58, lineHeight: 62 }]}>Lucky Edge</Hero>
      </>
    }
  >
    <View style={styles.luckyGroup}>
      <View style={styles.luckyRow}>
        <Card tone="soft" style={[styles.luckyCard, styles.luckyNumberCard]}>
          <AppText style={styles.luckyBig} allowFontScaling={false}>
            7
          </AppText>
          <SerifLines style={styles.luckyLabel} text={'Lucky\nNumber'} />
        </Card>
        <Card tone="soft" style={[styles.luckyCard, styles.luckyTimeCard]}>
          <AppText style={styles.luckyTime} allowFontScaling={false}>
            09:09
          </AppText>
          <SerifLines style={styles.luckyLabel} text={'Lucky\nTiming'} />
        </Card>
      </View>
      <Card tone="soft" style={styles.astroCard}>
        <AppText variant="eyebrow" style={{ letterSpacing: 1.7 }}>
          Personal guidance
        </AppText>
        <SerifLines style={styles.astroTitle} text={'Consult with\nan Astrologer'} />
      </Card>
    </View>
  </SlideLayout>
);

const SLIDES: Slide[] = [
  { key: 'numbers', cta: 'Discover My Numbers  →', render: NumbersSlide },
  { key: 'change', cta: 'Explore Reports  →', render: ChangeSlide },
  { key: 'lucky', cta: 'Begin My Journey  →', render: LuckySlide },
];

/** Intro slides 01–03. */
export default function Intro() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Slide>>(null);
  const [page, setPage] = useState(0);

  const finish = async () => {
    await useAuthStore.getState().markIntroSeen();
    router.replace('/login');
  };

  const next = () => {
    if (page < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: page + 1, animated: true });
      setPage(page + 1);
    } else {
      void finish();
    }
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <ScreenBackground>
      <View style={[styles.fill, { paddingTop: insets.top + spacing.screenTop }]}>
        <View style={styles.header}>
          <AppText variant="brand">Ankveda</AppText>
          <Pressable onPress={finish} hitSlop={12} accessibilityRole="button">
            <AppText variant="small" style={{ fontSize: 13 }}>
              Skip
            </AppText>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={SLIDES}
          keyExtractor={(s) => s.key}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          renderItem={({ item }) => <View style={{ width }}>{item.render()}</View>}
          style={styles.fill}
        />

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <AppText variant="small" align="center" color={colors.gold} accessibilityLabel={`Slide ${page + 1} of 3`}>
            {SLIDES.map((_, i) => (i === page ? '●' : '○')).join('  ')}
          </AppText>
          <PrimaryButton label={SLIDES[page].cta} onPress={next} />
        </View>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.gutter,
  },
  slideBody: { flex: 1, paddingHorizontal: spacing.gutter, paddingTop: 48 },
  visual: { flex: 1, justifyContent: 'center', paddingVertical: 24 },
  titleGroup: { gap: 4 },
  heroSerif: { fontFamily: fonts.serifSemiBold, color: colors.cream },
  heroMedium: { fontFamily: fonts.serifMedium, color: colors.cream },
  heroItalic: { fontFamily: fonts.serifMediumItalic, color: colors.gold },
  dialCaption: { marginTop: 37 },
  changeList: { gap: 16 },
  changeCard: { flexDirection: 'row', paddingHorizontal: 18, paddingVertical: 16, gap: 18 },
  changeGlyph: { width: 66, fontFamily: fonts.serifMedium, fontSize: 44, lineHeight: 46, color: colors.gold },
  changeText: { flex: 1, gap: 8 },
  changeTitle: { fontFamily: fonts.serifSemiBold, fontSize: 25, lineHeight: 26, color: colors.cream },
  changeBody: { fontSize: 13, lineHeight: 19 },
  luckyGroup: { gap: 20 },
  luckyRow: { flexDirection: 'row', gap: 17 },
  luckyCard: { height: 170 },
  luckyNumberCard: { flex: 1, paddingHorizontal: 20, paddingVertical: 12, justifyContent: 'center', gap: 10 },
  // Figma: both lucky cards are the same width (~164).
  luckyTimeCard: { flex: 1, paddingHorizontal: 16, paddingVertical: 19, justifyContent: 'space-between' },
  luckyBig: { fontFamily: fonts.serifMedium, fontSize: 75, lineHeight: 77, color: colors.gold },
  luckyTime: { fontFamily: fonts.serifMedium, fontSize: 31, lineHeight: 32, color: colors.gold },
  luckyLabel: { fontFamily: fonts.serifMedium, fontSize: 25, lineHeight: 28, color: colors.cream },
  astroCard: { paddingHorizontal: 22, paddingVertical: 16, gap: 12 },
  astroTitle: { fontFamily: fonts.serifMedium, fontSize: 29, lineHeight: 30, color: colors.cream },
  footer: { paddingHorizontal: spacing.gutter, gap: 24, paddingTop: 12 },
});
