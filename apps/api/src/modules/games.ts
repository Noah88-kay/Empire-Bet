import { Router } from 'express';
import { z } from 'zod';
import { COIN_MULTIPLIER, coinSchema, diceMultiplier, diceSchema } from '@empire/shared';
import { prisma, type Tx } from '../db.js';
import { parse, route } from '../lib/http.js';
import { requirePlayable, requireUser } from '../lib/auth.js';
import { postEntry } from '../lib/ledger.js';
import { diceRoll, fairFloat, randomSeed, sha256 } from '../lib/fair.js';

export const gamesRouter = Router();
gamesRouter.use(requireUser);

async function seedPairFor(tx: Tx, userId: string) {
  const existing = await tx.seedPair.findUnique({ where: { userId } });
  if (existing) return existing;
  const serverSeed = randomSeed();
  return tx.seedPair.create({ data: { userId, serverSeed, serverSeedHash: sha256(serverSeed), clientSeed: randomSeed().slice(0, 16) } });
}

/** Debits the stake, rolls one provably fair float, credits any win, records the round. All atomic. */
async function playRound(
  userId: string,
  game: 'dice' | 'coin',
  stakeCents: number,
  resolve: (f: number) => { multiplier: number; outcome: Record<string, unknown> }
) {
  return prisma.$transaction(async (tx) => {
    const seeds = await seedPairFor(tx, userId);
    const nonce = seeds.nonce;
    await tx.seedPair.update({ where: { userId }, data: { nonce: { increment: 1 } } });

    const f = fairFloat(seeds.serverSeed, seeds.clientSeed, nonce);
    const { multiplier, outcome } = resolve(f);
    const payoutCents = Math.floor(stakeCents * multiplier);

    const round = await tx.gameRound.create({
      data: { userId, game, stakeCents, payoutCents, serverSeedHash: seeds.serverSeedHash, clientSeed: seeds.clientSeed, nonce, outcome: JSON.stringify(outcome) }
    });
    await postEntry(tx, userId, -stakeCents, 'game_stake', { type: 'round', id: round.id }, game);
    if (payoutCents > 0) await postEntry(tx, userId, payoutCents, 'game_win', { type: 'round', id: round.id }, game);
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
    return { roundId: round.id, nonce, serverSeedHash: seeds.serverSeedHash, clientSeed: seeds.clientSeed, payoutCents, win: payoutCents > 0, outcome, balanceCents: wallet.balanceCents };
  });
}

gamesRouter.post(
  '/dice',
  route(async (req, res) => {
    const input = parse(diceSchema, req.body);
    await requirePlayable(req.user!.id);
    const mult = diceMultiplier(input.target, input.direction);
    const result = await playRound(req.user!.id, 'dice', input.stakeCents, (f) => {
      const roll = diceRoll(f);
      const win = input.direction === 'over' ? roll > input.target : roll < input.target;
      return { multiplier: win ? mult : 0, outcome: { roll, target: input.target, direction: input.direction, multiplier: mult } };
    });
    res.json(result);
  })
);

gamesRouter.post(
  '/coin',
  route(async (req, res) => {
    const input = parse(coinSchema, req.body);
    await requirePlayable(req.user!.id);
    const result = await playRound(req.user!.id, 'coin', input.stakeCents, (f) => {
      const side = f < 0.5 ? 'heads' : 'tails';
      return { multiplier: side === input.side ? COIN_MULTIPLIER : 0, outcome: { side, pick: input.side, multiplier: COIN_MULTIPLIER } };
    });
    res.json(result);
  })
);

gamesRouter.get(
  '/fairness',
  route(async (req, res) => {
    const seeds = await prisma.$transaction((tx) => seedPairFor(tx, req.user!.id));
    const rounds = await prisma.gameRound.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 20 });
    res.json({ serverSeedHash: seeds.serverSeedHash, clientSeed: seeds.clientSeed, nonce: seeds.nonce, rounds });
  })
);

/** Reveals the current server seed so past rounds can be verified, and starts a new pair. */
gamesRouter.post(
  '/fairness/rotate',
  route(async (req, res) => {
    const { clientSeed } = parse(z.object({ clientSeed: z.string().trim().min(1).max(64).optional() }), req.body ?? {});
    const result = await prisma.$transaction(async (tx) => {
      const old = await seedPairFor(tx, req.user!.id);
      const serverSeed = randomSeed();
      const next = await tx.seedPair.update({
        where: { userId: req.user!.id },
        data: { serverSeed, serverSeedHash: sha256(serverSeed), clientSeed: clientSeed ?? randomSeed().slice(0, 16), nonce: 0 }
      });
      return { revealed: { serverSeed: old.serverSeed, serverSeedHash: old.serverSeedHash, clientSeed: old.clientSeed, lastNonce: old.nonce - 1 }, next: { serverSeedHash: next.serverSeedHash, clientSeed: next.clientSeed } };
    });
    res.json(result);
  })
);
