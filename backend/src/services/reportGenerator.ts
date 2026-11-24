import { config } from '../config';
import { logger } from '../lib/logger';

import type { ReportContent, ReportDoc, ReportNumber, ReportSection, ReportType } from '../types';
import { astrologyApi, type AstroRecord } from './astrologyApi';
import {
  ARCHETYPES,
  birthNumber,
  harmony,
  lifePath,
  nameNumber,
  personalYear,
  phoneNumber,
  reduce,
  vehicleNumber,
  type Calculation,
} from './numerology';
import { generateJson, openaiConfigured, STYLE_GUIDE } from './openai';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

type Numbers = {
  primary: { label: string; calc: Calculation };
  numbers: ReportNumber[];
  facts: Record<string, unknown>;
};

const PERIOD_LABEL = { '3m': 'the next 3 months', '6m': 'the next 6 months', '12m': 'the next 12 months' } as const;

/** Exact numbers for each report type (shown in the hero card and number tiles). */
const computeNumbers = (type: ReportType, report: ReportDoc, profileName: string): Numbers => {
  const input = report.input;
  const dob = input.dob!;
  const birth = birthNumber(dob);
  const path = lifePath(dob);
  const tile = (label: string, c: Calculation) => ({ label, value: String(c.value) });
  const thisYear = new Date().getFullYear();

  switch (type) {
    case 'name': {
      const name = nameNumber(input.fullName!);
      return {
        primary: { label: 'Name number', calc: name },
        numbers: [tile('Birth number', birth), tile('Life path', path), tile('Name number', name)],
        facts: { harmonyNameWithBirth: harmony(name.value, birth.value) },
      };
    }
    case 'phone': {
      const phone = phoneNumber(input.phone!);
      return {
        primary: { label: 'Phone number', calc: phone },
        numbers: [tile('Birth number', birth), tile('Life path', path), tile('Phone number', phone)],
        facts: { phone: input.phone, harmonyWithBirth: harmony(phone.value, birth.value), harmonyWithLifePath: harmony(phone.value, path.value) },
      };
    }
    case 'car': {
      const car = vehicleNumber(input.carNumber!);
      return {
        primary: { label: 'Vehicle number', calc: car },
        numbers: [tile('Birth number', birth), tile('Life path', path), tile('Vehicle number', car)],
        facts: { vehicle: input.carNumber, harmonyWithBirth: harmony(car.value, birth.value), harmonyWithLifePath: harmony(car.value, path.value) },
      };
    }
    case 'birthdate':
      return {
        primary: { label: 'Life path', calc: path },
        numbers: [tile('Birth number', birth), tile('Life path', path), tile('Personal year', personalYear(dob, thisYear))],
        facts: {},
      };
    case 'career': {
      const name = nameNumber(input.fullName ?? profileName);
      return {
        primary: { label: 'Life path', calc: path },
        numbers: [tile('Birth number', birth), tile('Life path', path), tile('Name number', name)],
        facts: { careerFocus: input.careerFocus || 'not specified' },
      };
    }
    case 'future': {
      const year = personalYear(dob, thisYear);
      return {
        primary: { label: 'Personal year', calc: year },
        numbers: [tile('Birth number', birth), tile('Life path', path), tile(`Year ${thisYear + 1}`, personalYear(dob, thisYear + 1))],
        facts: { period: PERIOD_LABEL[input.period ?? '12m'], currentYear: thisYear },
      };
    }
    case 'compatibility': {
      const theirPath = lifePath(input.partnerDob!);
      const theirBirth = birthNumber(input.partnerDob!);
      const shared = reduce(path.value + theirPath.value);
      return {
        primary: {
          label: 'Shared number',
          calc: { compound: path.value + theirPath.value, value: shared, text: `${path.value} + ${theirPath.value} → ${shared}` },
        },
        numbers: [
          { label: 'Your birth no.', value: String(birth.value) },
          { label: 'Their birth no.', value: String(theirBirth.value) },
          { label: 'Shared number', value: String(shared) },
        ],
        facts: {
          partnerName: input.partnerName,
          yourLifePath: path.value,
          theirLifePath: theirPath.value,
          birthHarmony: harmony(birth.value, theirBirth.value),
          lifePathHarmony: harmony(path.value, theirPath.value),
        },
      };
    }
  }
};

const fetchAstroContext = async (type: ReportType, report: ReportDoc, name: string): Promise<Record<string, AstroRecord>> => {
  const person = { dob: report.input.dob!, name };
  const [table, narrative, favTime] = await Promise.all([
    astrologyApi.numeroTable(person),
    astrologyApi.numeroReport(person),
    type === 'future' || type === 'career' ? astrologyApi.numeroFavTime(person) : Promise.resolve(undefined),
  ]);
  const context: Record<string, AstroRecord> = { numeroTable: table, numeroReport: narrative };
  if (favTime) context.favourableTime = favTime;
  if (type === 'compatibility' && report.input.partnerDob) {
    context.partnerTable = await astrologyApi.numeroTable({ dob: report.input.partnerDob, name: report.input.partnerName ?? 'Partner' });
  }
  return context;
};

type WrittenReport = { headline: string; traits: string; sections: ReportSection[] };

const TYPE_BRIEF: Record<ReportType, string> = {
  name: 'Name numerology: what the vibration of their name says about identity, and how it relates to their birth numbers.',
  phone: 'Phone number numerology: whether the mobile number they carry supports them, and gentle guidance if it does not.',
  birthdate: 'Birth date numerology: their nature, strengths, purpose and life path.',
  compatibility: 'Compatibility: how the two people’s energies work together, strengths of the bond and where to be mindful.',
  career: 'Career numerology: natural strengths at work, suitable directions, and timing for growth.',
  future: 'Future numerology: personal cycles and meaningful timing for the period requested. Guidance, never fixed prediction.',
  car: 'Vehicle number numerology: whether the vehicle number suits the owner, for smoother journeys.',
};

const writeReport = async (
  type: ReportType,
  person: { name: string; dob: string },
  numbers: Numbers,
  astro: Record<string, AstroRecord>,
): Promise<WrittenReport> => {
  const system = `${STYLE_GUIDE}
Return JSON: {"headline": string, "traits": string, "sections": [{"eyebrow"?: string, "title": string, "body": string}]}
- headline: 2–4 words naming the archetype of the primary number, e.g. "The humanitarian".
- traits: exactly three single words, each ending with a full stop, e.g. "Compassionate. Creative. Big-hearted."
- sections: exactly 3.
  1) no eyebrow; title 3–6 words; body 2–3 sentences on the core meaning.
  2) eyebrow "FIND YOUR BALANCE"; title a short two-part line like "Give generously. Keep your boundaries."; body 2–3 sentences connecting the numbers.
  3) eyebrow "SUPPORTIVE CHOICES"; title 3–6 words; body 2–3 sentences with practical colours, days, numbers or simple remedies taken from the data.
Use only numbers that appear in the data. Keep each body under 60 words.`;

  const user = JSON.stringify({
    brief: TYPE_BRIEF[type],
    person: { firstName: person.name.split(' ')[0], dateOfBirth: person.dob },
    primary: { label: numbers.primary.label, value: numbers.primary.calc.value, calculation: numbers.primary.calc.text },
    numbers: numbers.numbers,
    facts: numbers.facts,
    astrologyApi: astro,
  });

  const written = await generateJson<WrittenReport>(system, user);
  if (written && written.headline && Array.isArray(written.sections) && written.sections.length > 0) return written;

  // Template fallback (no OpenAI key in development).
  const archetype = ARCHETYPES[numbers.primary.calc.value] ?? ARCHETYPES[9];
  return {
    headline: archetype.title.replace(/\.$/, ''),
    traits: archetype.traits,
    sections: [
      {
        title: 'What your numbers say',
        body: `Your ${numbers.primary.label.toLowerCase()} is ${numbers.primary.calc.value}. ${archetype.message.replace('\n', ' ')}`,
      },
      {
        eyebrow: 'FIND YOUR BALANCE',
        title: 'Honour your nature. Stay open.',
        body: `Your birth number ${numbers.numbers[0]?.value} and life path ${numbers.numbers[1]?.value} work together. Notice where they agree, and give gentle attention where they pull apart.`,
      },
      {
        eyebrow: 'SUPPORTIVE CHOICES',
        title: 'Small choices, steady alignment',
        body: 'Choose colours, days and numbers that feel supportive, and return to this reading when you need a moment of clarity.',
      },
    ],
  };
};

/**
 * Full pipeline: numbers → Astrology API → OpenAI. Reports progress through `onStage`.
 * Reports without a name field (birth date, phone, car, future) use the profile snapshot's name.
 */
export const generateReportContent = async (
  report: ReportDoc,
  onStage: (stage: 'writing') => Promise<void>,
): Promise<{ content: ReportContent; generator: { model: string; astroSource: string } }> => {
  const name = report.input.fullName ?? report.profileSnapshot.fullName;
  const numbers = computeNumbers(report.type, report, name);
  const astro = await fetchAstroContext(report.type, report, name);

  await onStage('writing');
  const written = await writeReport(report.type, { name, dob: report.input.dob! }, numbers, astro);
  const astroSource = String(astro.numeroTable?.source ?? 'astrologyapi');
  logger.info('Report written', { type: report.type, astroSource });

  return {
    content: {
      headline: written.headline,
      traits: written.traits,
      primary: { label: numbers.primary.label, value: String(numbers.primary.calc.value), calculation: numbers.primary.calc.text },
      numbers: numbers.numbers,
      sections: written.sections.slice(0, 4),
      basis: `Chaldean numerology · Based on ${longDate(report.input.dob!)}`,
    },
    generator: { model: openaiConfigured() ? config.openaiModel : 'template', astroSource },
  };
};
