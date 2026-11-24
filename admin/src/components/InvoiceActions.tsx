import { Download, FileText, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import { useToast } from '@/components/ui/Overlay';
import { errorMessage, openInvoice } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { TransactionRow } from '@/lib/types';

/**
 * Tax invoice for one payment: number + View (new tab) and PDF (browser print → Save as PDF).
 * Only paid payments have an invoice; admin grants never create a payment, so they never show one.
 */
export const InvoiceActions = ({ tx, compact }: { tx: Pick<TransactionRow, 'id' | 'invoiceNumber' | 'invoiceable' | 'status'>; compact?: boolean }) => {
  const toast = useToast();
  const [busy, setBusy] = useState<'view' | 'pdf' | null>(null);
  if (!tx.invoiceable) return <span className="text-[12px] text-ink-3">{tx.status === 'failed' ? 'No invoice (failed)' : '—'}</span>;

  const open = async (kind: 'view' | 'pdf') => {
    setBusy(kind);
    try {
      await openInvoice(tx.id, { print: kind === 'pdf' });
    } catch (error) {
      toast.error('Could not open the invoice', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const btn = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-link transition-colors hover:bg-surface-3 disabled:opacity-50';
  return (
    <div className={cn('flex flex-col items-start gap-0.5', compact && 'items-end')} onClick={(e) => e.stopPropagation()}>
      <span className="font-mono text-[11px] text-ink-3">{tx.invoiceNumber ?? 'Number on first open'}</span>
      <div className="flex items-center gap-0.5">
        <button type="button" className={btn} onClick={() => void open('view')} disabled={busy !== null} aria-label="View invoice">
          {busy === 'view' ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
          View
        </button>
        <button type="button" className={btn} onClick={() => void open('pdf')} disabled={busy !== null} aria-label="Download invoice as PDF">
          {busy === 'pdf' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          PDF
        </button>
      </div>
    </div>
  );
};
