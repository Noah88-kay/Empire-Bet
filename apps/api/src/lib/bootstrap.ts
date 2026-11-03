import bcrypt from 'bcryptjs';
import { normaliseKePhone } from '@empire/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from './audit.js';

/**
 * Creates the first admin from ADMIN_PHONE / ADMIN_NAME / ADMIN_PASSWORD when no account
 * with that phone exists. Never changes an existing account, so restarts are harmless.
 */
export async function ensureBootstrapAdmin() {
  const { ADMIN_PHONE, ADMIN_NAME, ADMIN_PASSWORD } = config;
  if (!ADMIN_PHONE && !ADMIN_PASSWORD) return;
  const phone = normaliseKePhone(ADMIN_PHONE ?? '');
  if (!phone || !ADMIN_NAME?.trim() || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    console.warn('[bootstrap] ADMIN_PHONE, ADMIN_NAME and ADMIN_PASSWORD (12+ characters) must all be set; no admin created.');
    return;
  }
  if (await prisma.user.findUnique({ where: { phone } })) return;

  const user = await prisma.user.create({
    data: {
      name: ADMIN_NAME.trim(),
      phone,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      role: 'admin',
      phoneVerified: true,
      kycStatus: 'verified',
      dateOfBirth: new Date('1970-01-01'),
      nationalId: 'staff',
      wallet: { create: {} }
    }
  });
  await audit('system', 'staff.account.bootstrapped', user.id);
  console.log('[bootstrap] Admin account created. You can now remove ADMIN_PASSWORD from the environment.');
}
