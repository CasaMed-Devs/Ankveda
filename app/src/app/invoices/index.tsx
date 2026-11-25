import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Cards';
import { Heading } from '@/components/Heading';
import { Loader } from '@/components/Loader';
import { Screen } from '@/components/Screen';
import { ApiError } from '@/lib/api';
import { formatInvoiceAmount, formatInvoiceDate } from '@/lib/invoices/invoiceFormat';
import { useInvoices } from '@/lib/queries';
import type { Invoice } from '@/lib/types';
import { colors } from '@/theme/tokens';

/** Profile → Invoices: one GST tax invoice per trial / subscription payment, newest first. */
export default function Invoices() {
  const invoices = useInvoices();

  return (
    <Screen headerAction={{ label: 'Profile', onPress: () => router.back() }}>
      <Heading eyebrow="Invoices" title={'Your payments,\non record.'} subtitle="A tax invoice for every trial and subscription payment." />

      <View style={styles.list}>
        {invoices.isLoading ? (
          <Loader size="md" style={styles.loader} />
        ) : invoices.isError ? (
          <Card style={styles.empty} onPress={() => void invoices.refetch()}>
            <AppText variant="subtitle">Could not load invoices</AppText>
            <AppText variant="small">
              {invoices.error instanceof ApiError ? invoices.error.message : 'Please check your connection.'} Tap to try again.
            </AppText>
          </Card>
        ) : !invoices.data?.length ? (
          <Card style={styles.empty}>
            <AppText variant="subtitle">No invoices yet</AppText>
            <AppText variant="small">Invoices for your trial and subscription payments will appear here.</AppText>
          </Card>
        ) : (
          invoices.data.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} />)
        )}
      </View>
    </Screen>
  );
}

const InvoiceRow = ({ invoice }: { invoice: Invoice }) => (
  <Card
    onPress={() => router.push({ pathname: '/invoices/[id]', params: { id: invoice.id } })}
    style={styles.row}
    accessibilityLabel={`${invoice.description}, ${formatInvoiceAmount(invoice.amount)}, ${formatInvoiceDate(invoice.paidAt)}`}
  >
    <View style={styles.rowText}>
      <AppText variant="subtitle" numberOfLines={2}>
        {invoice.description}
      </AppText>
      <AppText variant="small">
        {invoice.invoiceNumber} · {formatInvoiceDate(invoice.paidAt)}
      </AppText>
    </View>
    <View style={styles.rowAmount}>
      <AppText variant="bodyCream" color={colors.gold}>
        {formatInvoiceAmount(invoice.amount)}
      </AppText>
      <AppText variant="arrow">→</AppText>
    </View>
  </Card>
);

const styles = StyleSheet.create({
  list: { marginTop: 32, gap: 12 },
  loader: { marginTop: 24 },
  empty: { padding: 18, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 18 },
  rowText: { flex: 1, gap: 4 },
  rowAmount: { alignItems: 'flex-end', gap: 2 },
});
