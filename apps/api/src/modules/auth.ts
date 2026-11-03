import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { loginSchema, registerSchema, verifyPhoneSchema, maskPhone } from '@empire/shared';
import { prisma } from '../db.js';
import { badRequest, conflict, parse, route, unauthorized } from '../lib/http.js';
import { clearSession, issueSession, refreshSession, requireUser } from '../lib/auth.js';
import { sendSms } from '../integrations/sms.js';
import { audit } from '../lib/audit.js';

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const hashCode = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

function ageOn(dob: Date, now = new Date()) {
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

async function sendOtp(userId: string, phone: string) {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  await prisma.otpCode.updateMany({ where: { userId, purpose: 'verify_phone', usedAt: null }, data: { usedAt: new Date() } });
  await prisma.otpCode.create({
    data: { userId, purpose: 'verify_phone', codeHash: hashCode(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) }
  });
  await sendSms(phone, `Your Empire Bet code is ${code}. It expires in 10 minutes. Never share it.`);
}

export function publicUser(u: {
  id: string; name: string; phone: string; email: string | null; role: string; phoneVerified: boolean; kycStatus: string;
  weeklyDepositLimitCents: number | null; selfExcludedUntil: Date | null;
}) {
  return {
    id: u.id,
    name: u.name,
    phone: maskPhone(u.phone),
    email: u.email,
    role: u.role,
    phoneVerified: u.phoneVerified,
    kycStatus: u.kycStatus,
    weeklyDepositLimitCents: u.weeklyDepositLimitCents,
    selfExcludedUntil: u.selfExcludedUntil
  };
}

authRouter.post(
  '/register',
  authLimiter,
  route(async (req, res) => {
    const input = parse(registerSchema, req.body);
    const dob = new Date(`${input.dateOfBirth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime())) throw badRequest('invalid_dob', 'Enter a valid date of birth');
    if (ageOn(dob) < 18) throw badRequest('underage', 'You must be 18 or older to register');

    const exists = await prisma.user.findFirst({
      where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] }
    });
    if (exists) throw conflict('account_exists', 'An account with this phone or email already exists');

    const user = await prisma.user.create({
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12),
        dateOfBirth: dob,
        nationalId: input.nationalId,
        wallet: { create: {} }
      }
    });
    await sendOtp(user.id, user.phone);
    await audit({ id: user.id, name: user.name }, 'user.registered', user.id);
    issueSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  })
);

authRouter.post(
  '/login',
  authLimiter,
  route(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { phone: input.phone } });
    // Same error and similar timing whether or not the account exists.
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    if (!user || !ok) throw unauthorized('Wrong phone number or password');
    if (user.status !== 'active') throw unauthorized('This account is suspended. Contact support.');
    issueSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

authRouter.post(
  '/refresh',
  route(async (req, res) => {
    const user = await refreshSession(req, res);
    res.json({ user: publicUser(user) });
  })
);

authRouter.post(
  '/logout',
  route(async (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  })
);

authRouter.get(
  '/me',
  requireUser,
  route(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    res.json({ user: publicUser(user) });
  })
);

authRouter.post(
  '/verify-phone',
  requireUser,
  otpLimiter,
  route(async (req, res) => {
    const { code } = parse(verifyPhoneSchema, req.body);
    const otp = await prisma.otpCode.findFirst({
      where: { userId: req.user!.id, purpose: 'verify_phone', usedAt: null },
      orderBy: { createdAt: 'desc' }
    });
    if (!otp || otp.expiresAt < new Date()) throw badRequest('otp_expired', 'Code expired. Request a new one.');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw badRequest('otp_locked', 'Too many attempts. Request a new code.');
    const a = Buffer.from(otp.codeHash, 'hex');
    const b = Buffer.from(hashCode(code), 'hex');
    if (!crypto.timingSafeEqual(a, b)) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw badRequest('otp_wrong', 'That code is not right');
    }
    await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: { phoneVerified: true } });
    res.json({ user: publicUser(user) });
  })
);

authRouter.post(
  '/resend-otp',
  requireUser,
  otpLimiter,
  route(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.phoneVerified) throw badRequest('already_verified', 'Phone already verified');
    await sendOtp(user.id, user.phone);
    res.json({ ok: true });
  })
);
