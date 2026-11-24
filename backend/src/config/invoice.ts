/**
 * Static details printed on every tax invoice (same legal entity as the Astro108 app). Kept on the
 * backend, not in the app bundle, so a change of registered address/GSTIN takes effect for every app
 * version at once, and so the tax split is never computed on a device.
 */
export const INVOICE_SELLER = {
  brandName: 'HouseofTech',
  legalName: 'HouseofTech Innovation Pvt Ltd',
  addressLines: ['F-118, Adani Galeria, Sector 89A, Gurgaon', 'Haryana, India, 122505'],
  gstin: '06AALCP3434H1ZE',
  state: 'Haryana',
  stateCode: '06',
  supportEmail: 'support@houseoftech.ai',
} as const;

/** The product name shown in the invoice's "Service" block. */
export const INVOICE_APP_NAME = 'Ankveda';

/**
 * Ankveda's own invoice series. The same GSTIN also bills Astro108 ("INV-…"), and GST requires every
 * invoice number under one GSTIN to be unique — so Ankveda numbers are "ANK-YYYYMM-000001".
 */
export const INVOICE_NUMBER_PREFIX = 'ANK';

export const INVOICE_SAC = { code: '998439', description: 'Other on-line contents' } as const;

/**
 * Prices are GST-inclusive, and every sale is billed as intra-state from the seller's own state (the
 * app never collects a billing address), so the 18% is always split into equal CGST and SGST halves.
 */
export const INVOICE_HALF_GST_RATE_PERCENT = 9;
