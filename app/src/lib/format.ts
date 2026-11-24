const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "16081996" -> "1996-08-16" when it is a real calendar date, otherwise ''. */
export const digitsToIsoDate = (digits: string): string => {
  if (digits.length !== 8) return '';
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (!isValidDate(year, month, day)) return '';
  return `${year}-${pad(month)}-${pad(day)}`;
};

/** "1996-08-16" -> "16081996" */
export const isoDateToDigits = (iso: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}${match[2]}${match[1]}` : '';
};

/** "1996-08-16" -> "16 Aug 1996" */
export const formatLongDate = (iso: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
};

const isValidDate = (year: number, month: number, day: number) => {
  const now = new Date();
  if (year < 1900 || year > now.getFullYear() || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date <= now;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** 49900 -> "₹499", 149900 -> "₹1,499" */
export const formatRupees = (paise: number): string => {
  const rupees = paise / 100;
  const formatted = Number.isInteger(rupees)
    ? rupees.toLocaleString('en-IN')
    : rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₹${formatted}`;
};

export const formatPhone = (digits: string): string =>
  digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : digits;

export const firstName = (fullName: string | undefined): string => fullName?.trim().split(/\s+/)[0] ?? '';
