import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { canSaveToDownloads, saveToDownloads } from '../../../modules/invoice-downloads';

import { buildInvoiceHtml, INVOICE_PAGE } from '@/lib/invoices/invoiceHtml';
import type { Invoice } from '@/lib/types';

const PDF_MIME_TYPE = 'application/pdf';

/** downloaded = in the phone's Downloads folder; saved = in a folder the user picked. */
export type InvoiceDownloadResult = 'downloaded' | 'saved' | 'shared' | 'cancelled';

export const invoiceFileName = (invoice: Invoice): string =>
  `${invoice.appName}-Invoice-${invoice.invoiceNumber}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');

/*
 * Static imports on purpose: a dynamic import() is a separate chunk that a dev build downloads from
 * Metro when it runs, so with Metro unreachable both buttons failed. The native modules are in the binary.
 */

/** Renders the invoice (same template as the admin dashboard) to an A4 PDF named after its number. */
const createInvoicePdf = async (invoice: Invoice): Promise<FileSystem.File> => {
  const { uri } = await Print.printToFileAsync({ html: buildInvoiceHtml(invoice), ...INVOICE_PAGE });

  // expo-print picks a random file name; give it the one the user should see.
  const pdf = new FileSystem.File(FileSystem.Paths.cache, invoiceFileName(invoice));
  if (pdf.exists) pdf.delete();
  await new FileSystem.File(uri).move(pdf);
  return pdf;
};

/** Opens the system share sheet with the invoice PDF attached. */
export const shareInvoicePdf = async (invoice: Invoice): Promise<void> => {
  const pdf = await createInvoicePdf(invoice);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(pdf.uri, { mimeType: PDF_MIME_TYPE, UTI: 'com.adobe.pdf', dialogTitle: invoice.invoiceNumber });
};

/**
 * Android 10+: saved straight into the phone's Downloads folder (no picker, no permission).
 * Older Android: saved to a folder the user picks. iOS: the share sheet, whose "Save to Files" is the
 * equivalent.
 */
export const downloadInvoicePdf = async (invoice: Invoice): Promise<InvoiceDownloadResult> => {
  if (Platform.OS !== 'android') {
    await shareInvoicePdf(invoice);
    return 'shared';
  }
  const pdf = await createInvoicePdf(invoice);

  if (canSaveToDownloads()) {
    await saveToDownloads(pdf.uri, invoiceFileName(invoice), PDF_MIME_TYPE);
    return 'downloaded';
  }

  let folder: FileSystem.Directory;
  try {
    folder = await FileSystem.Directory.pickDirectoryAsync();
  } catch {
    return 'cancelled'; // the picker rejects when the user backs out of it
  }
  const saved = folder.createFile(invoiceFileName(invoice), PDF_MIME_TYPE);
  await saved.write(await pdf.bytes());
  return 'saved';
};
