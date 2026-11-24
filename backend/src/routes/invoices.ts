import { Router } from 'express';

import { uidOf } from '../lib/auth';
import { handle } from '../lib/http';
import { listInvoices, toPublicInvoice } from '../services/invoice';

export const invoicesRouter = Router();

/**
 * The signed-in user's tax invoices (trial and subscription payments), newest first.
 * Fully refunded payments are not listed; admin grants never have an invoice.
 * The app renders each one to PDF on-device with the same template the admin dashboard uses.
 */
invoicesRouter.get(
  '/invoices',
  handle(async (req, res) => {
    const invoices = await listInvoices(uidOf(req));
    res.json({ invoices: invoices.map(toPublicInvoice) });
  }),
);
