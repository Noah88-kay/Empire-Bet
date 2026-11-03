import { Router, type Request } from 'express';
import { depositSchema, withdrawSchema } from '@empire/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound, parse, route } from '../lib/http.js';
import { requirePlayable, requireUser } from '../lib/auth.js';
import { postEntry } from '../lib/ledger.js';
import { audit } from '../lib/audit.js';
import { b2cPayout, parseB2cResult, parseStkCallback, registerMpesaHandlers, stkPush, type B2cResult, type StkResult } from '../integrations/mpesa.js';

export const walletRouter = Router();
export const mpesaCallbackRouter = Router();

// ---------- Callback handlers (shared by real Daraja webhooks and mock mode) ----------

export async function handleStkResult(r: StkResult) {
  const payment = await prisma.payment.findUnique({ where: { checkoutRequestId: r.checkoutRequestId } });
  if (!payment || payment.type !== 'deposit' || payment.status !== 'initiated') return; // unknown or already processed: idempotent

  if (!r.success) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: r.reason ?? 'Cancelled' } });
    return;
  }
  if (r.amountKes !== undefined && r.amountKes * 100 !== payment.amountCents) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'held', failureReason: `Amount mismatch: got KES ${r.amountKes}` } });
    await audit('system', 'payment.deposit.amount_mismatch', payment.id, { expected: payment.amountCents, got: r.amountKes });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'initiated' },
      data: { status: 'completed', mpesaReceipt: r.receipt }
    });
    if (claimed.count !== 1) return;
    await postEntry(tx, payment.userId, payment.amountCents, 'deposit', { type: 'payment', id: payment.id }, r.receipt);
  });
}

export async function handleB2cResult(r: B2cResult) {
  const payment = await prisma.payment.findUnique({ where: { conversationId: r.conversationId } });
  if (!payment || payment.type !== 'withdrawal' || payment.status !== 'processing') return;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'processing' },
      data: r.success ? { status: 'completed', mpesaReceipt: r.receipt } : { status: 'failed', failureReason: r.reason }
    });
    if (claimed.count !== 1) return;
    // Funds were debited when the withdrawal was requested; a failed payout gives them back.
    if (!r.success) await postEntry(tx, payment.userId, payment.amountCents, 'withdrawal_refund', { type: 'payment', id: payment.id }, r.reason);
  });
}

registerMpesaHandlers({ stk: handleStkResult, b2c: handleB2cResult });

/** Sends an approved withdrawal to M-Pesa. Funds are already held in the ledger. */
export async function dispatchWithdrawal(paymentId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  try {
    const { conversationId } = await b2cPayout({ phone: payment.phone, amountKes: payment.amountCents / 100, reference: payment.id });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'processing', conversationId } });
  } catch (err) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: (err as Error).message } });
      await postEntry(tx, payment.userId, payment.amountCents, 'withdrawal_refund', { type: 'payment', id: payment.id }, 'Payout request failed');
    });
  }
}

// ---------- Player wallet ----------

walletRouter.use(requireUser);

walletRouter.get(
  '/',
  route(async (req, res) => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: req.user!.id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const deposited = await prisma.payment.aggregate({
      where: { userId: req.user!.id, type: 'deposit', status: { in: ['initiated', 'completed'] }, createdAt: { gte: weekAgo } },
      _sum: { amountCents: true }
    });
    res.json({
      balanceCents: wallet.balanceCents,
      bonusCents: wallet.bonusCents,
      weeklyDepositLimitCents: user.weeklyDepositLimitCents,
      depositedThisWeekCents: deposited._sum.amountCents ?? 0
    });
  })
);

walletRouter.get(
  '/transactions',
  route(async (req, res) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const payments = await prisma.payment.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 20 });
    res.json({ entries, payments });
  })
);

walletRouter.get(
  '/payments/:id',
  route(async (req: Request, res) => {
    const payment = await prisma.payment.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!payment) throw notFound();
    res.json({ payment });
  })
);

walletRouter.post(
  '/deposit',
  route(async (req, res) => {
    const { amountCents } = parse(depositSchema, req.body);
    const user = await requirePlayable(req.user!.id);

    if (user.weeklyDepositLimitCents !== null) {
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const agg = await prisma.payment.aggregate({
        where: { userId: user.id, type: 'deposit', status: { in: ['initiated', 'completed'] }, createdAt: { gte: weekAgo } },
        _sum: { amountCents: true }
      });
      if ((agg._sum.amountCents ?? 0) + amountCents > user.weeklyDepositLimitCents) {
        throw forbidden('This deposit would go over your weekly deposit limit.');
      }
    }

    const payment = await prisma.payment.create({
      data: { userId: user.id, type: 'deposit', amountCents, phone: user.phone, status: 'initiated' }
    });
    try {
      const { checkoutRequestId } = await stkPush({ phone: user.phone, amountKes: amountCents / 100, reference: `Deposit ${payment.id}` });
      const updated = await prisma.payment.update({ where: { id: payment.id }, data: { checkoutRequestId } });
      res.status(202).json({ payment: updated });
    } catch (err) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: (err as Error).message } });
      throw badRequest('mpesa_unavailable', 'M-Pesa did not accept the request. Try again shortly.');
    }
  })
);

walletRouter.post(
  '/withdraw',
  route(async (req, res) => {
    const { amountCents } = parse(withdrawSchema, req.body);
    const user = await requirePlayable(req.user!.id);
    if (user.kycStatus !== 'verified') throw forbidden('We need to verify your ID before your first withdrawal. This usually takes a few hours.');

    const autoApprove = amountCents <= config.AUTO_APPROVE_WITHDRAWAL_KES * 100;
    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: { userId: user.id, type: 'withdrawal', amountCents, phone: user.phone, status: autoApprove ? 'processing' : 'pending_review' }
      });
      await postEntry(tx, user.id, -amountCents, 'withdrawal', { type: 'payment', id: p.id });
      return p;
    });

    if (autoApprove) await dispatchWithdrawal(payment.id);
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    res.status(202).json({ payment: fresh });
  })
);

// ---------- Daraja webhooks (secret path; always 200 so Safaricom stops retrying) ----------

mpesaCallbackRouter.post(
  '/stk',
  route(async (req, res) => {
    const r = parseStkCallback(req.body);
    if (r) await handleStkResult(r);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  })
);
mpesaCallbackRouter.post(
  '/b2c-result',
  route(async (req, res) => {
    const r = parseB2cResult(req.body);
    if (r) await handleB2cResult(r);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  })
);
mpesaCallbackRouter.post(
  '/b2c-timeout',
  route(async (req, res) => {
    const r = parseB2cResult(req.body);
    if (r) await audit('system', 'payment.withdrawal.timeout', r.conversationId);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  })
);
