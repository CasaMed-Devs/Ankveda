import { getReportType } from '@/lib/report-types';
import type { Report } from '@/lib/types';

export const reportTitle = (report: Report) => getReportType(report.type)?.title ?? 'Your report';

export const reportStatusLine = (report: Report): string => {
  switch (report.status) {
    case 'complete':
      return report.content?.headline
        ? `${report.input.fullName ?? 'Your reading'} · ${report.content.headline}`
        : 'Your personal reading is ready';
    case 'processing':
      return 'Your numbers are coming together…';
    case 'failed':
      return 'Something went wrong · tap to retry';
    default:
      return 'Preview, progress & your personal insights';
  }
};
