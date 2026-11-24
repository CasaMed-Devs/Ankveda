import type { ReportInput, ReportType } from '@/lib/types';

export type ReportField = keyof ReportInput;

export type ReportTypeConfig = {
  type: ReportType;
  index: string;
  title: string;
  tagline: string;
  eyebrow: string;
  heading: string;
  subtitle: string;
  info?: string;
  cta: string;
  fields: ReportField[];
  labels?: Partial<Record<ReportField, string>>;
};

// Copy taken from Figma frames 08–13; "car" follows the same pattern (intro slide 2).
export const REPORT_TYPES: ReportTypeConfig[] = [
  {
    type: 'name',
    index: '01',
    title: 'Name numerology',
    tagline: 'The energy behind your identity',
    eyebrow: 'Name numerology',
    heading: 'The energy in\nyour name.',
    subtitle: 'Every letter carries a vibration. Find yours.',
    info: 'Explore your name number, natural qualities and its relationship with your birth numbers.',
    cta: 'Reveal my numbers',
    fields: ['fullName', 'dob'],
  },
  {
    type: 'phone',
    index: '02',
    title: 'Phone number',
    tagline: 'A connection that aligns with you',
    eyebrow: 'Phone numerology',
    heading: 'Make every\nconnection count.',
    subtitle: 'Explore the number you carry every day.',
    info: 'Enter 10 digits, without the country code. We’ll compare this number with your birth numbers.',
    cta: 'Analyse phone number',
    fields: ['phone', 'dob'],
  },
  {
    type: 'birthdate',
    index: '03',
    title: 'Birth date',
    tagline: 'Your strengths, purpose and life path',
    eyebrow: 'Birth date numerology',
    heading: 'Your numbers.\nYour nature.',
    subtitle: 'Discover the story in the day you were born.',
    info: 'Your birth date is all we need to explore your birth number, life path and natural strengths.',
    cta: 'Explore my birth numbers',
    fields: ['dob'],
  },
  {
    type: 'compatibility',
    index: '04',
    title: 'Compatibility',
    tagline: 'Discover how your energies connect',
    eyebrow: 'Compatibility',
    heading: 'Two stories.\nOne connection.',
    subtitle: 'Explore the way your energies work together.',
    cta: 'Explore compatibility',
    fields: ['fullName', 'dob', 'partnerName', 'partnerDob'],
    labels: { fullName: 'Your full name', dob: 'Your date of birth' },
  },
  {
    type: 'career',
    index: '05',
    title: 'Career',
    tagline: 'Find direction in your working life',
    eyebrow: 'Career numerology',
    heading: 'Purpose meets\npossibility.',
    subtitle: 'Find a little clarity for your next chapter.',
    info: 'Connect your natural strengths with the way you work.',
    cta: 'Explore career insights',
    fields: ['fullName', 'dob', 'careerFocus'],
  },
  {
    type: 'future',
    index: '06',
    title: 'Future',
    tagline: 'Bring intention to the road ahead',
    eyebrow: 'Future numerology',
    heading: 'A little alignment.\nFor the road ahead.',
    subtitle: 'Make space for the possibilities ahead.',
    info: 'Explore your personal cycles and meaningful timing. Guidance, not a fixed prediction.',
    cta: 'Explore my future',
    fields: ['dob', 'period'],
  },
  {
    type: 'car',
    index: '07',
    title: 'Car number',
    tagline: 'Choose a number for smoother journeys',
    eyebrow: 'Car numerology',
    heading: 'A number for\nsmoother journeys.',
    subtitle: 'See how your vehicle number aligns with you.',
    info: 'We’ll compare your vehicle number with your birth numbers.',
    cta: 'Analyse car number',
    fields: ['carNumber', 'dob'],
  },
];

export const FIELD_LABELS: Record<ReportField, string> = {
  fullName: 'Full name',
  dob: 'Date of birth',
  phone: 'Mobile number',
  partnerName: 'Their full name',
  partnerDob: 'Their date of birth',
  careerFocus: 'Career focus · optional',
  period: 'Period to explore',
  carNumber: 'Vehicle number',
};

export const PERIOD_OPTIONS = [
  { value: '12m', label: 'The next 12 months' },
  { value: '6m', label: 'The next 6 months' },
  { value: '3m', label: 'The next 3 months' },
] as const;

export const UNLOCK_BENEFITS = [
  'Your strengths & natural tendencies',
  'Personal number relationships',
  'Supportive numbers, colours & dates',
  'Personal guidance & practical remedies',
];

export const PREVIEW_SECTIONS = [
  { title: 'Your core numbers', body: 'Discover the numbers at the heart of your story.' },
  { title: 'Your natural strengths', body: 'See the qualities your numbers bring forward.' },
  { title: 'Guidance made personal', body: 'Practical remedies, colours and dates for you.' },
];

export const getReportType = (type: string | undefined): ReportTypeConfig | undefined =>
  REPORT_TYPES.find((r) => r.type === type);

export const isReportType = (value: string | undefined): value is ReportType => !!getReportType(value);
