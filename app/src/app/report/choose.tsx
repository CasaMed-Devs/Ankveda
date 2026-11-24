import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { NumberedRow } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { Screen } from '@/components/Screen';
import { REPORT_TYPES } from '@/lib/report-types';

/** 07 · Choose report — six Figma reports + Car number + Astrologer (coming soon). */
export default function ChooseReport() {
  return (
    <Screen>
      <Heading
        eyebrow="Your numerology journey"
        title={'Where would you\nlike to begin?'}
        subtitle="Choose the numbers you want to explore."
      />
      <View style={styles.list}>
        {REPORT_TYPES.map((r) => (
          <NumberedRow
            key={r.type}
            index={r.index}
            title={r.title}
            subtitle={r.tagline}
            onPress={() => router.push({ pathname: '/report/new/[type]', params: { type: r.type } })}
          />
        ))}
        <NumberedRow
          index={String(REPORT_TYPES.length + 1).padStart(2, '0')}
          title="Astrologer"
          subtitle="Personal guidance from an expert"
          badge="Soon"
          onPress={() => router.push('/astrologer')}
        />
      </View>
      <AppText variant="small" align="center" style={styles.note}>
        Choose a report to personalise your reading.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 40, gap: 11 },
  note: { marginTop: 28 },
});
