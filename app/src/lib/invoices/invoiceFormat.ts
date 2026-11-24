import type { Invoice } from '@/lib/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "24 Nov 2026" in Indian time — the same date the PDF prints. */
export const formatInvoiceDate = (iso: string): string => {
  const ist = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${String(ist.getUTCDate()).padStart(2, '0')} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
};

/** "₹49.00" for the in-app screens (the PDF itself prints "Rs 49.00", like the Astro108 template). */
export const formatInvoiceAmount = (rupees: number): string =>
  `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "+91 98765 43210" */
export const formatInvoicePhone = (phoneNumber: string): string => {
  const match = /^\+91(\d{10})$/.exec(phoneNumber.trim());
  return match ? `+91 ${match[1]!.slice(0, 5)} ${match[1]!.slice(5)}` : phoneNumber;
};

export const invoiceCustomerName = (invoice: Invoice): string => invoice.customer.name ?? `${invoice.appName} User`;
