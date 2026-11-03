import { Router, type Request } from 'express';
import { z } from 'zod';
import { settleEventSchema } from '@empire/shared';
import { prisma } from '../db.js';
import { badRequest, notFound, parse, route } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { postEntry } from '../lib/ledger.js';
import { audit } from '../lib/audit.js';
import { dispatchWithdrawal } from './payments.js';
import { settleEvent } from './sports.js';

export const adminRouter = Router();
adminRouter.use(requireRole('admin', 'finance'));

const actor = (req: Request) => ({ id: req.user!.id, name: req.user!.name });

adminRouter.get(
  '/overview',
  route(async (_req, res) => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [dep, wd, stakes, wins, gStakes, gWins, players] = await Promise.all([
      prisma.payment.aggregate({ where: { type: 'deposit', status: 'completed', createdAt: { gte: since } }, _sum: { amountCents: true } }),
      prisma.payment.aggregate({ where: { type: 'withdrawal', status: 'completed', createdAt: { gte: since } }, _sum: { amountCents: true } }),
      prisma.ledgerEntry.aggregate({ where: { kind: 'bet_stake', createdAt: { gte: since } }, _sum: { amountCents: true } }),
      prisma.ledgerEntry.aggregate({ where: { kind: 'bet_win', createdAt: { gte: since } }, _sum: { amountCents: true } }),
      prisma.ledgerEntry.aggregate({ where: { kind: 'game_stake', createdAt: { gte: since } }, _sum: { amountCents: true } }),
      prisma.ledgerEntry.aggregate({ where: { kind: 'game_win', createdAt: { gte: since } }, _sum: { amountCents: true } }),
      prisma.bet.findMany({ where: { createdAt: { gte: since } }, distinct: ['userId'], select: { userId: true } })
    ]);
    const s = (x: { _sum: { amountCents: number | null } }) => x._sum.amountCents ?? 0;
    res.json({
      depositsCents: s(dep),
      withdrawalsCents: s(wd),
      ggrCents: -s(stakes) - s(wins) + (-s(gStakes) - s(gWins)),
      activePlayers: players.length
    });
  })
);

adminRouter.get(
  '/withdrawals',
  route(async (_req, res) => {
    const items = await prisma.payment.findMany({
      where: { type: 'withdrawal', status: { in: ['pending_review', 'held'] } },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, kycStatus: true, createdAt: true } } }
    });
    res.json({ items });
  })
);

adminRouter.post(
  '/withdrawals/:id/approve',
  route(async (req, res) => {
    const claimed = await prisma.payment.updateMany({
      where: { id: req.params.id, type: 'withdrawal', status: { in: ['pending_review', 'held'] } },
      data: { status: 'processing', reviewedBy: req.user!.id }
    });
    if (claimed.count !== 1) throw notFound('Withdrawal not awaiting review');
    await audit(actor(req), 'withdrawal.approved', req.params.id);
    await dispatchWithdrawal(req.params.id);
    res.json({ payment: await prisma.payment.findUnique({ where: { id: req.params.id } }) });
  })
);

adminRouter.post(
  '/withdrawals/:id/hold',
  route(async (req, res) => {
    const claimed = await prisma.payment.updateMany({ where: { id: req.params.id, type: 'withdrawal', status: 'pending_review' }, data: { status: 'held', reviewedBy: req.user!.id } });
    if (claimed.count !== 1) throw notFound('Withdrawal not awaiting review');
    await audit(actor(req), 'withdrawal.held', req.params.id);
    res.json({ ok: true });
  })
);

adminRouter.post(
  '/withdrawals/:id/reject',
  route(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
    await prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUnique({ where: { id: req.params.id } });
      if (!p || p.type !== 'withdrawal') throw notFound();
      const claimed = await tx.payment.updateMany({ where: { id: p.id, status: { in: ['pending_review', 'held'] } }, data: { status: 'rejected', failureReason: reason, reviewedBy: req.user!.id } });
      if (claimed.count !== 1) throw badRequest('not_reviewable', 'Withdrawal not awaiting review');
      await postEntry(tx, p.userId, p.amountCents, 'withdrawal_refund', { type: 'payment', id: p.id }, reason);
      await audit(actor(req), 'withdrawal.rejected', p.id, { reason }, tx);
    });
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/kyc',
  route(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { kycStatus: 'pending', phoneVerified: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, nationalId: true, dateOfBirth: true, createdAt: true }
    });
    res.json({ users });
  })
);

adminRouter.post(
  '/kyc/:userId',
  route(async (req, res) => {
    const { decision } = parse(z.object({ decision: z.enum(['verified', 'rejected']) }), req.body);
    await prisma.user.update({ where: { id: req.params.userId }, data: { kycStatus: decision } });
    await audit(actor(req), `kyc.${decision}`, req.params.userId);
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/events',
  route(async (_req, res) => {
    // Upcoming/live, plus finished matches the feed couldn't grade (extra time / penalties).
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { status: { in: ['scheduled', 'live'] }, startsAt: { lte: new Date(Date.now() + 2 * 86400_000) } },
          { status: 'finished', markets: { some: { status: { not: 'settled' } } } }
        ]
      },
      orderBy: { startsAt: 'asc' }
    });
    const liabilities = await Promise.all(
      events.map(async (e) => {
        const agg = await prisma.bet.aggregate({
          where: { status: 'open', legs: { some: { selection: { market: { eventId: e.id } } } } },
          _sum: { potentialPayoutCents: true },
          _count: true
        });
        return { ...e, openBets: agg._count, liabilityCents: agg._sum.potentialPayoutCents ?? 0 };
      })
    );
    res.json({ events: liabilities });
  })
);

adminRouter.post(
  '/events/:id/settle',
  requireRole('admin'),
  route(async (req, res) => {
    const { homeScore, awayScore } = parse(settleEventSchema, req.body);
    const result = await settleEvent(req.params.id, homeScore, awayScore);
    await audit(actor(req), 'event.settled', req.params.id, { homeScore, awayScore, ...result });
    res.json(result);
  })
);

adminRouter.get(
  '/audit',
  route(async (_req, res) => {
    res.json({ items: await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }) });
  })
);
