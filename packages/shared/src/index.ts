import { z } from 'zod';

// ---------- Money ----------
// All money moves as integer cents (KES * 100). Never floats.

export const MIN_STAKE_CENTS = 10_00;
export const MAX_STAKE_CENTS = 500_000_00;
export const MAX_PAYOUT_CENTS = 10_000_000_00;
export const MIN_DEPOSIT_CENTS = 10_00;
export const MAX_DEPOSIT_CENTS = 150_000_00;
export const MIN_WITHDRAWAL_CENTS = 50_00;
export const MAX_WITHDRAWAL_CENTS = 150_000_00;
export const MAX_SELECTIONS = 30;

export const toCents = (kes: number) => Math.round(kes * 100);
export const fromCents = (cents: number) => cents / 100;

export function formatKes(cents: number, withSymbol = true): string {
  const s = (cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? `KES ${s}` : s;
}

// ---------- Odds maths ----------

export function combineOdds(odds: number[]): number {
  return Math.round(odds.reduce((p, o) => p * o, 1) * 100) / 100;
}

export function potentialPayoutCents(stakeCents: number, totalOdds: number): number {
  return Math.min(Math.floor(stakeCents * totalOdds), MAX_PAYOUT_CENTS);
}

// ---------- Phone ----------

/** Normalises 07XXXXXXXX / 01XXXXXXXX / +2547XXXXXXXX to 2547XXXXXXXX (Daraja format). */
export function normaliseKePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  let n = digits;
  if (n.startsWith('0') && n.length === 10) n = '254' + n.slice(1);
  if (n.startsWith('254') && n.length === 12 && /^254(7|1)\d{8}$/.test(n)) return n;
  return null;
}

export function maskPhone(phone: string): string {
  return `+${phone.slice(0, 3)} ${phone.slice(3, 6)} ••• ${phone.slice(-3)}`;
}

// ---------- Request schemas (shared by API validation and web forms) ----------

const phone = z.string().transform((v, ctx) => {
  const n = normaliseKePhone(v);
  if (!n) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Kenyan mobile number' });
    return z.NEVER;
  }
  return n;
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone,
  email: z.string().trim().email().max(120).optional().or(z.literal('').transform(() => undefined)),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  nationalId: z.string().trim().regex(/^\d{6,10}$/, 'Enter a valid ID number'),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) })
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({ phone, password: z.string().min(1).max(128) });
export type LoginInput = z.input<typeof loginSchema>;

export const verifyPhoneSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const placeBetSchema = z.object({
  stakeCents: z.number().int().min(MIN_STAKE_CENTS).max(MAX_STAKE_CENTS),
  selections: z
    .array(z.object({ selectionId: z.string().min(1), odds: z.number().positive() }))
    .min(1)
    .max(MAX_SELECTIONS),
  acceptOddsChanges: z.boolean().default(false)
});
export type PlaceBetInput = z.input<typeof placeBetSchema>;

// M-Pesa only moves whole shillings.
const wholeShillings = (v: number) => v % 100 === 0;
export const depositSchema = z.object({
  amountCents: z.number().int().min(MIN_DEPOSIT_CENTS, 'Minimum deposit is KES 10').max(MAX_DEPOSIT_CENTS).refine(wholeShillings, 'Whole shillings only')
});
export const withdrawSchema = z.object({
  amountCents: z.number().int().min(MIN_WITHDRAWAL_CENTS, 'Minimum withdrawal is KES 50').max(MAX_WITHDRAWAL_CENTS).refine(wholeShillings, 'Whole shillings only')
});

export const diceSchema = z.object({
  stakeCents: z.number().int().min(MIN_STAKE_CENTS).max(50_000_00),
  target: z.number().min(2).max(98),
  direction: z.enum(['over', 'under'])
});
export const coinSchema = z.object({
  stakeCents: z.number().int().min(MIN_STAKE_CENTS).max(50_000_00),
  side: z.enum(['heads', 'tails'])
});

export const limitsSchema = z.object({
  weeklyDepositLimitCents: z.number().int().min(0).max(10_000_000_00).nullable()
});
export const selfExcludeSchema = z.object({ days: z.number().int().refine((d) => [1, 7, 30, 180, 365].includes(d)) });

export const settleEventSchema = z.object({ homeScore: z.number().int().min(0), awayScore: z.number().int().min(0) });

// ---------- House edge for originals ----------

export const HOUSE_EDGE = 0.02;

export function diceMultiplier(target: number, direction: 'over' | 'under'): number {
  const winChance = direction === 'over' ? 100 - target : target;
  return Math.floor(((100 * (1 - HOUSE_EDGE)) / winChance) * 10000) / 10000;
}

export const COIN_MULTIPLIER = 1.96;
