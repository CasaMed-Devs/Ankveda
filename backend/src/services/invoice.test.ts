import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeGstBreakdown,
  cycleEnd,
  describeInvoice,
  formatInvoiceNumber,
  invoiceMonthKey,
  invoicePeriod,
  isInvoiceable,
} from './invoice';
import { buildInvoiceHtml } from './invoiceHtml';
import type { Invoice } from './invoice';

const DAY = 86_400_000;
const plan = { name: 'Ankveda Premium', priceInPaise: 29900, period: 'monthly' as const, interval: 1, trialDays: 5, trialPriceInPaise: 4900 };

test('GST split always adds back to exactly what was paid', () => {
  for (const rupees of [49, 299, 199, 1, 0.01, 99.99, 4999]) {
    const g = computeGstBreakdown(rupees);
    assert.equal(Math.round((g.taxableValue + g.cgst + g.sgst) * 100), Math.round(rupees * 100), `₹${rupees}`);
    assert.equal(g.cgst, g.sgst);
  }
  assert.deepEqual(computeGstBreakdown(49), { taxableValue: 41.52, cgst: 3.74, sgst: 3.74 });
  assert.deepEqual(computeGstBreakdown(299), { taxableValue: 253.38, cgst: 22.81, sgst: 22.81 });
});

test('invoice numbers: Ankveda series, IST month, zero padded', () => {
  assert.equal(formatInvoiceNumber('202611', 1), 'ANK-202611-000001');
  assert.equal(formatInvoiceNumber('202612', 123456), 'ANK-202612-123456');
  // 30 Nov 2026 23:00 IST is still November; 30 Nov 19:00 UTC is already 1 Dec in India.
  assert.equal(invoiceMonthKey(new Date('2026-11-30T17:30:00Z')), '202611');
  assert.equal(invoiceMonthKey(new Date('2026-11-30T19:00:00Z')), '202612');
});

test('descriptions come from the plan the user bought', () => {
  assert.equal(describeInvoice('trial', plan), '5-day Trial · Ankveda Premium');
  assert.equal(describeInvoice('monthly', plan), 'Ankveda Premium (1 month)');
  assert.equal(describeInvoice('monthly', { ...plan, interval: 3 }), 'Ankveda Premium (3 months)');
  assert.equal(describeInvoice('monthly', { ...plan, period: 'yearly' }), 'Ankveda Premium (1 year)');
});

test('billing periods: trial ends at the first charge; months clamp at month end', () => {
  const paid = new Date('2026-11-01T10:00:00Z');
  const sub = { startAt: paid.getTime() + 5 * DAY, currentPeriodStart: null, currentPeriodEnd: null, planSnapshot: plan };
  assert.equal(invoicePeriod('trial', paid, sub).end.getTime(), paid.getTime() + 5 * DAY);
  // No usable first-charge date → paid date + trial days.
  assert.equal(invoicePeriod('trial', paid, { ...sub, startAt: null }).end.getTime(), paid.getTime() + 5 * DAY);
  // Monthly: Razorpay's own period when this payment opened it…
  const opened = { ...sub, currentPeriodStart: paid.getTime(), currentPeriodEnd: paid.getTime() + 30 * DAY };
  assert.equal(invoicePeriod('monthly', paid, opened).end.getTime(), paid.getTime() + 30 * DAY);
  // …otherwise one plan cycle from the payment.
  assert.equal(invoicePeriod('monthly', paid, sub).end.toISOString(), '2026-12-01T10:00:00.000Z');
  assert.equal(cycleEnd(new Date('2027-01-31T00:00:00Z'), 'monthly', 1).toISOString(), '2027-02-28T00:00:00.000Z');
  assert.equal(cycleEnd(new Date('2026-11-01T00:00:00Z'), 'yearly', 1).toISOString(), '2027-11-01T00:00:00.000Z');
});

test('only paid payments are invoiced; fully refunded ones only for the admin', () => {
  assert.equal(isInvoiceable({ status: 'captured', amountInPaise: 4900 }), true);
  assert.equal(isInvoiceable({ status: 'partially_refunded', amountInPaise: 29900 }), true);
  assert.equal(isInvoiceable({ status: 'refunded', amountInPaise: 29900 }), false);
  assert.equal(isInvoiceable({ status: 'refunded', amountInPaise: 29900 }, true), true);
  for (const status of ['created', 'authorized', 'failed'] as const) {
    assert.equal(isInvoiceable({ status, amountInPaise: 29900 }, true), false, status);
  }
  assert.equal(isInvoiceable({ status: 'captured', amountInPaise: 0 }), false);
});

test('template renders the dynamic values (and escapes user input)', () => {
  const invoice = {
    id: 'pay_1',
    invoiceNumber: 'ANK-202611-000007',
    type: 'trial',
    description: '5-day Trial · Ankveda Premium',
    status: 'paid',
    paymentId: 'pay_1',
    subscriptionId: 'sub_1',
    paymentMethod: 'upi',
    paidAt: '2026-11-24T10:00:00.000Z',
    periodStart: '2026-11-24T10:00:00.000Z',
    periodEnd: '2026-11-29T10:00:00.000Z',
    currency: 'INR',
    amount: 49,
    ...computeGstBreakdown(49),
    halfGstRatePercent: 9,
    customer: { name: 'Aarav <Sharma>', phoneNumber: '+919876543210' },
    appName: 'Ankveda',
    sac: { code: '998439', description: 'Other on-line contents' },
    seller: {
      brandName: 'HouseofTech',
      legalName: 'HouseofTech Innovation Pvt Ltd',
      addressLines: ['F-118, Adani Galeria, Sector 89A, Gurgaon', 'Haryana, India, 122505'],
      gstin: '06AALCP3434H1ZE',
      state: 'Haryana',
      stateCode: '06',
      supportEmail: 'support@houseoftech.ai',
    },
  } as Invoice;
  const html = buildInvoiceHtml(invoice);
  assert.match(html, /ANK-202611-000007/);
  assert.match(html, /Rs 49\.00/);
  assert.match(html, /Period 24 Nov 2026 &ndash; 29 Nov 2026/);
  assert.match(html, /\+91 9876543210/);
  assert.match(html, /Aarav &lt;Sharma&gt;/);
  assert.doesNotMatch(html, /<Sharma>/);
});
