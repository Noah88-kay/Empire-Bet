import bcrypt from 'bcryptjs';
import { normaliseKePhone } from '@empire/shared';
import { config, smsEnabled } from '../config.js';
import { prisma } from '../db.js';
import { audit } from './audit.js';

const MIN_ADMIN_PASSWORD = 8;

/**
 * Makes ADMIN_PHONE / ADMIN_NAME / ADMIN_PASSWORD a working admin login on every start:
 * creates the account if missing, promotes it if that phone signed up as a player, and
 * sets the password if it differs. Remove ADMIN_PASSWORD from the environment afterwards.
 */
export async function ensureBootstrapAdmin() {
  const { ADMIN_PHONE, ADMIN_NAME, ADMIN_PASSWORD } = config;
  if (!ADMIN_PHONE && !ADMIN_PASSWORD) return;
  const phone = normaliseKePhone(ADMIN_PHONE ?? '');
  if (!phone) return console.warn(`[bootstrap] ADMIN_PHONE "${ADMIN_PHONE}" is not a valid Kenyan mobile number; no admin set up.`);
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD) {
    return console.warn(`[bootstrap] ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD} characters; no admin set up.`);
  }
  const name = ADMIN_NAME?.trim() || 'Admin';

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        name, phone, role: 'admin', phoneVerified: true, kycStatus: 'verified', status: 'active',
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
        dateOfBirth: new Date('1970-01-01'), nationalId: 'staff', wallet: { create: {} }
      }
    });
    await audit('system', 'staff.account.bootstrapped', user.id);
    return console.log(`[bootstrap] Admin account created for +${phone}.`);
  }

  const passwordChanged = !(await bcrypt.compare(ADMIN_PASSWORD, existing.passwordHash));
  const needsUpdate = passwordChanged || existing.role !== 'admin' || !existing.phoneVerified || existing.status !== 'active';
  if (!needsUpdate) return console.log(`[bootstrap] Admin +${phone} already set up.`);

  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: 'admin',
      phoneVerified: true,
      status: 'active',
      ...(passwordChanged ? { passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), tokenVersion: { increment: 1 } } : {})
    }
  });
  await audit('system', 'staff.account.bootstrap_updated', existing.id, { promoted: existing.role !== 'admin', passwordChanged });
  console.log(`[bootstrap] Admin +${phone} updated (${existing.role !== 'admin' ? 'promoted to admin' : 'role kept'}${passwordChanged ? ', password set' : ''}).`);
}

/** With no SMS provider, nobody can receive a code: release accounts stuck on the verify step. */
export async function releaseUnverifiedPhones() {
  if (smsEnabled) return;
  const r = await prisma.user.updateMany({ where: { phoneVerified: false }, data: { phoneVerified: true } });
  if (r.count) console.log(`[auth] SMS not configured: marked ${r.count} pending account(s) as phone-verified.`);
}
