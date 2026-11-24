import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PrimaryButton } from '@/components/Buttons';
import { Card } from '@/components/Cards';
import { FooterNote, Screen } from '@/components/Screen';
import { toast } from '@/components/Toast';
import { formatInvoiceAmount, formatInvoiceDate, formatInvoicePhone, invoiceCustomerName } from '@/lib/invoices/invoiceFormat';
import { downloadInvoicePdf, shareInvoicePdf } from '@/lib/invoices/invoicePdf';
import { useInvoices } from '@/lib/queries';
import type { Invoice } from '@/lib/types';
import { colors } from '@/theme/tokens';

type PdfAction = 'download' | 'share';

/** One tax invoice + Download PDF / Share (rendered on-device from the same template as the dashboard). */
export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Same query as the list, so arriving from there renders instantly from cache.
  const invoices = useInvoices();
  const invoice = invoices.data?.find((item) => item.id === id);
  const [busy, setBusy] = useState<PdfAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: PdfAction) => {
    if (!invoice) return;
    setBusy(action);
    setError(null);
    try {
      if (action === 'share') await shareInvoicePdf(invoice);
      else if ((await downloadInvoicePdf(invoice)) === 'saved') toast.success(`Invoice ${invoice.invoiceNumber} saved as a PDF.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the invoice PDF. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      headerAction={{ label: 'Invoices', onPress: () => router.back() }}
      footer={
        invoice ? (
          <>
            {error ? <FooterNote color={colors.danger}>{error}</FooterNote> : null}
            <PrimaryButton label="Download invoice (PDF)" onPress={() => void run('download')} loading={busy === 'download'} disabled={busy !== null} />
            <View style={styles.gap} />
            <PrimaryButton label="Share invoice" tone="card" onPress={() => void run('share')} loading={busy === 'share'} disabled={busy !== null} />
          </>
        ) : undefined
      }
    >
      {invoice ? (
        <InvoiceDetails invoice={invoice} />
      ) : invoices.isLoading ? (
        <ActivityIndicator color={colors.gold} style={styles.loader} />
      ) : (
        <Card style={styles.card}>
          <AppText variant="subtitle">Invoice not found</AppText>
          <AppText variant="small">This invoice is no longer available.</AppText>
        </Card>
      )}
    </Screen>
  );
}

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <View style={styles.detailRow}>
    <AppText variant="small" style={styles.detailLabel}>
      {label}
    </AppText>
    <AppText variant="bodyCream" style={styles.detailValue} selectable>
      {value}
    </AppText>
  </View>
);

const InvoiceDetails = ({ invoice }: { invoice: Invoice }) => {
  const { seller } = invoice;
  return (
    <View style={styles.stack}>
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <AppText variant="eyebrow">Tax invoice</AppText>
          <View style={styles.paid}>
            <AppText variant="eyebrow" color={colors.onGold}>
              Paid
            </AppText>
          </View>
        </View>
        <AppText variant="display" style={styles.amount}>
          {formatInvoiceAmount(invoice.amount)}
        </AppText>
        <AppText variant="small">
          {invoice.invoiceNumber} · {formatInvoiceDate(invoice.paidAt)}
        </AppText>
        <View style={styles.divider} />
        <AppText variant="subtitle">{seller.legalName}</AppText>
        {seller.addressLines.map((line) => (
          <AppText key={line} variant="small">
            {line}
          </AppText>
        ))}
        <AppText variant="small">
          GSTIN {seller.gstin} · {seller.state} ({seller.stateCode})
        </AppText>
        <AppText variant="small">{seller.supportEmail}</AppText>
      </Card>

      <Card style={styles.card}>
        <AppText variant="eyebrow">Billed to</AppText>
        <AppText variant="subtitle">{invoiceCustomerName(invoice)}</AppText>
        <AppText variant="small">{formatInvoicePhone(invoice.customer.phoneNumber)}</AppText>
        <View style={styles.divider} />
        <AppText variant="eyebrow">Service</AppText>
        <AppText variant="subtitle">{invoice.appName}</AppText>
        <AppText variant="small">{invoice.description} · Delivered digitally in the app</AppText>
      </Card>

      <Card style={styles.card}>
        <Row label="Invoice number" value={invoice.invoiceNumber} />
        <Row label="Plan" value={invoice.description} />
        {invoice.subscriptionId ? <Row label="Subscription ID" value={invoice.subscriptionId} /> : null}
        <Row label="Period" value={`${formatInvoiceDate(invoice.periodStart)} – ${formatInvoiceDate(invoice.periodEnd)}`} />
        <Row label="Payment date" value={formatInvoiceDate(invoice.paidAt)} />
        <Row label="Payment ID" value={invoice.paymentId} />
        {invoice.paymentMethod ? <Row label="Paid with" value={invoice.paymentMethod.toUpperCase()} /> : null}
        <Row label="SAC" value={`${invoice.sac.code} · ${invoice.sac.description}`} />
        <View style={styles.divider} />
        <Row label="Taxable value" value={formatInvoiceAmount(invoice.taxableValue)} />
        <Row label={`CGST @ ${invoice.halfGstRatePercent}%`} value={formatInvoiceAmount(invoice.cgst)} />
        <Row label={`SGST @ ${invoice.halfGstRatePercent}%`} value={formatInvoiceAmount(invoice.sgst)} />
        <View style={styles.total}>
          <AppText variant="bodyCream" color={colors.onGold} style={styles.totalText}>
            Total paid
          </AppText>
          <AppText variant="bodyCream" color={colors.onGold} style={styles.totalText}>
            {formatInvoiceAmount(invoice.amount)}
          </AppText>
        </View>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  stack: { gap: 14 },
  loader: { marginTop: 40 },
  card: { padding: 18, gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  paid: { backgroundColor: colors.gold, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 2 },
  amount: { marginVertical: 4 },
  divider: { height: 1, backgroundColor: colors.ringMuted, marginVertical: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 5 },
  detailLabel: { flexShrink: 0 },
  detailValue: { flex: 1, textAlign: 'right' },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.gold,
  },
  totalText: { fontWeight: '700' },
  gap: { height: 12 },
});
