import type { Transaction, WriteBatch } from 'firebase-admin/firestore';

import { refs } from '../../db/firestore';
import type { AdminActor, AuditAction, AuditLogDoc } from '../../types';

type AuditInput = {
  action: AuditAction;
  actor: AdminActor | null;
  targetUserId?: string | null;
  subscriptionId?: string | null;
  planId?: string | null;
  details?: Record<string, unknown>;
};

const entry = (input: AuditInput, now = Date.now()): AuditLogDoc => ({
  action: input.action,
  actor: input.actor,
  targetUserId: input.targetUserId ?? null,
  subscriptionId: input.subscriptionId ?? null,
  planId: input.planId ?? null,
  details: input.details ?? {},
  createdAt: now,
});

/**
 * adminAuditLog is append-only and written only here, by the backend (Admin SDK). Firestore rules
 * deny all client access, so entries cannot be created, changed or deleted by any client.
 */
export const audit = {
  /** Inside a transaction / batch, so the log entry commits atomically with the change it describes. */
  inTx: (tx: Transaction | WriteBatch, input: AuditInput, now = Date.now()) => {
    (tx as Transaction).create(refs.adminAuditLog().doc(), entry(input, now));
  },
  write: (input: AuditInput) => refs.adminAuditLog().doc().create(entry(input)),
};
