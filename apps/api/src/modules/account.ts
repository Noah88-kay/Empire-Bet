import { Router } from 'express';
import { limitsSchema, selfExcludeSchema } from '@empire/shared';
import { prisma } from '../db.js';
import { forbidden, parse, route } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { publicUser } from './auth.js';

export const accountRouter = Router();
accountRouter.use(requireUser);

/** Lowering a limit applies at once; raising it is a common regulatory cooling-off case, applied after 24h in a later iteration. */
accountRouter.patch(
  '/limits',
  route(async (req, res) => {
    const { weeklyDepositLimitCents } = parse(limitsSchema, req.body);
    const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const raising =
      current.weeklyDepositLimitCents !== null &&
      (weeklyDepositLimitCents === null || weeklyDepositLimitCents > current.weeklyDepositLimitCents);
    if (raising) throw forbidden('Raising or removing a limit needs a 24-hour cooling-off period. Contact support to request it.');
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: { weeklyDepositLimitCents } });
    await audit({ id: user.id, name: user.name }, 'account.limit.set', user.id, { weeklyDepositLimitCents });
    res.json({ user: publicUser(user) });
  })
);

accountRouter.post(
  '/self-exclude',
  route(async (req, res) => {
    const { days } = parse(selfExcludeSchema, req.body);
    const until = new Date(Date.now() + days * 24 * 3600 * 1000);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: { selfExcludedUntil: until } });
    await audit({ id: user.id, name: user.name }, 'account.self_exclude', user.id, { days });
    res.json({ user: publicUser(user) });
  })
);
