/**
 * Creates (or promotes) a back-office account. Run once after the first deploy, e.g. in the Render shell:
 *   ADMIN_PHONE=07XXXXXXXX ADMIN_NAME="Ops Lead" ADMIN_PASSWORD='a-long-password' ADMIN_ROLE=admin npm run create-admin -w @empire/api
 * ADMIN_ROLE: admin (default) or finance.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { normaliseKePhone } from '@empire/shared';

const prisma = new PrismaClient();

async function main() {
  const phone = normaliseKePhone(process.env.ADMIN_PHONE ?? '');
  const name = process.env.ADMIN_NAME?.trim();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const role = process.env.ADMIN_ROLE ?? 'admin';
  if (!phone || !name || password.length < 12 || !['admin', 'finance'].includes(role)) {
    console.error('Set ADMIN_PHONE (Kenyan mobile), ADMIN_NAME, ADMIN_PASSWORD (12+ chars) and optionally ADMIN_ROLE=admin|finance.');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { phone },
    update: { role, name, passwordHash, phoneVerified: true, tokenVersion: { increment: 1 } },
    create: {
      name,
      phone,
      passwordHash,
      role,
      phoneVerified: true,
      kycStatus: 'verified',
      dateOfBirth: new Date('1970-01-01'),
      nationalId: 'staff',
      wallet: { create: {} }
    }
  });
  await prisma.auditLog.create({ data: { actor: 'system', action: 'staff.account.upserted', target: user.id, meta: JSON.stringify({ role }) } });
  console.log(`${role} account ready for ${name}. Log in with that phone number.`);
}

main().finally(() => prisma.$disconnect());
