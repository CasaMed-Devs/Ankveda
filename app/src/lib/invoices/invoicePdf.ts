import { Platform } from 'react-native';
import type { File as FileSystemFile } from 'expo-file-system';

import { buildInvoiceHtml, INVOICE_PAGE } from '@/lib/invoices/invoiceHtml';
import type { Invoice } from '@/lib/types';

const PDF_MIME_TYPE = 'application/pdf';

export type InvoiceDownloadResult = 'saved' | 'shared' | 'cancelled';

export const invoiceFileName = (invoice: Invoice): string =>
  `${invoice.appName}-Invoice-${invoice.invoiceNumber}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Loaded lazily (like react-native-razorpay): an app binary built before these native modules were
 * added doesn't contain them, and a top-level import would crash the whole invoice screen instead of
 * just failing the download with a clear message.
 */
const loadPdfModules = async () => {
  try {
    const [Print, Sharing, FileSystem] = await Promise.all([import('expo-print'), import('expo-sharing'), import('expo-file-system')]);
    return { Print, Sharing, FileSystem };
  } catch {
    throw new Error('Please update the app to download invoices.');
  }
};

/** Renders the invoice (same template as the admin dashboard) to an A4 PDF named after its number. */
const createInvoicePdf = async (invoice: Invoice): Promise<FileSystemFile> => {
  const { Print, FileSystem } = await loadPdfModules();
  const { uri } = await Print.printToFileAsync({ html: buildInvoiceHtml(invoice), ...INVOICE_PAGE });

  // expo-print picks a random file name; give it the one the user should see.
  const pdf = new FileSystem.File(FileSystem.Paths.cache, invoiceFileName(invoice));
  if (pdf.exists) pdf.delete();
  await new FileSystem.File(uri).move(pdf);
  return pdf;
};

/** Opens the system share sheet with the invoice PDF attached. */
export const shareInvoicePdf = async (invoice: Invoice): Promise<void> => {
  const { Sharing } = await loadPdfModules();
  const pdf = await createInvoicePdf(invoice);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(pdf.uri, { mimeType: PDF_MIME_TYPE, UTI: 'com.adobe.pdf', dialogTitle: invoice.invoiceNumber });
};

/**
 * Android: saves the PDF to a folder the user picks. iOS: the share sheet, whose "Save to Files" is
 * the equivalent.
 */
export const downloadInvoicePdf = async (invoice: Invoice): Promise<InvoiceDownloadResult> => {
  if (Platform.OS !== 'android') {
    await shareInvoicePdf(invoice);
    return 'shared';
  }
  const { FileSystem } = await loadPdfModules();
  const pdf = await createInvoicePdf(invoice);

  let folder: InstanceType<typeof FileSystem.Directory>;
  try {
    folder = await FileSystem.Directory.pickDirectoryAsync();
  } catch {
    return 'cancelled'; // the picker rejects when the user backs out of it
  }
  const saved = folder.createFile(invoiceFileName(invoice), PDF_MIME_TYPE);
  await saved.write(await pdf.bytes());
  return 'saved';
};
