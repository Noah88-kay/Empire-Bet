import { Router } from 'express';
import crypto from 'node:crypto';
import { combineOdds, placeBetSchema, potentialPayoutCents } from '@empire/shared';
import { config } from '../config.js';
import { prisma, type Tx } from '../db.js';
import { badRequest, conflict, parse, route } from '../lib/http.js';
import { requirePlayable, requireUser } from '../lib/auth.js';
import { postEntry } from '../lib/ledger.js';

export const eventsRouter = Router();
export const betsRouter = Router();

const eventInclude = { markets: { include: { selections: { orderBy: { code: 'asc' as const } } } } };

// 1X2 codes sort as "1","2","X"; present them as 1, X, 2.
const ORDER: Record<string, number> = { '1': 0, X: 1, '2': 2 };
function shapeEvent(e: Awaited<ReturnType<typeof loadEvents>>[number]) {
  const market = e.markets.find((m) => m.type === '1X2');
  return {
    id: e.id,
    sport: e.sport,
    league: e.league,
    leagueCode: e.leagueCode,
    home: e.home,
    away: e.away,
    startsAt: e.startsAt,
    status: e.status,
    minute: e.minute,
    clock: e.clock,
    homeScore: e.homeScore,
    awayScore: e.awayScore,
    featured: e.featured,
    source: e.source,
    oddsSource: e.oddsSource,
    oddsUpdatedAt: e.oddsUpdatedAt,
    syncedAt: e.syncedAt,
    market: market && {
      id: market.id,
      status: market.status,
      selections: [...market.selections].sort((a, b) => ORDER[a.code] - ORDER[b.code]).map((s) => ({ id: s.id, code: s.code, label: s.label, odds: s.odds }))
    }
  };
}

function loadEvents(where: object, orderBy: object = { startsAt: 'asc' }) {
  return prisma.event.findMany({ where, include: eventInclude, orderBy });
}

eventsRouter.get(
  '/',
  route(async (req, res) => {
    const sport = typeof req.query.sport === 'string' ? req.query.sport : undefined;
    const sportFilter = sport ? { sport } : {};
    const horizon = new Date(Date.now() + (config.FEED_DAYS_AHEAD + 1) * 86400_000);
    const events = await loadEvents({ status: { in: ['scheduled', 'live'] }, startsAt: { lte: horizon }, ...sportFilter });
    // Live first, then by kickoff.
    events.sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || a.startsAt.getTime() - b.startsAt.getTime());
    const counts = await prisma.event.groupBy({ by: ['sport'], where: { status: { in: ['scheduled', 'live'] }, startsAt: { lte: horizon } }, _count: true });
    const feed = await prisma.feedState.findUnique({ where: { id: 'espn' } });
    res.json({
      events: events.map(shapeEvent),
      sports: counts.map((c) => ({ sport: c.sport, count: c._count })),
      feed: feed && { lastOkAt: feed.lastOkAt, lastError: feed.lastError }
    });
  })
);

eventsRouter.get(
  '/results',
  route(async (_req, res) => {
    const since = new Date(Date.now() - 3 * 86400_000);
    const events = await loadEvents({ status: { in: ['finished', 'cancelled'] }, startsAt: { gte: since } }, { startsAt: 'desc' });
    res.json({ events: events.map(shapeEvent) });
  })
);

// ---------- Bets ----------

betsRouter.use(requireUser);

const ticketNo = () => 'EB-' + crypto.randomInt(10_000_000, 99_999_999).toString();

betsRouter.post(
  '/',
  route(async (req, res) => {
    const input = parse(placeBetSchema, req.body);
    await requirePlayable(req.user!.id);

    const ids = input.selections.map((s) => s.selectionId);
    if (new Set(ids).size !== ids.length) throw badRequest('duplicate_selection', 'The same selection is on the slip twice');

    const selections = await prisma.selection.findMany({ where: { id: { in: ids } }, include: { market: { include: { event: true } } } });
    if (selections.length !== ids.length) throw badRequest('unknown_selection', 'A selection is no longer available');

    const eventIds = selections.map((s) => s.market.eventId);
    if (new Set(eventIds).size !== eventIds.length) throw badRequest('same_event', 'Only one pick per match in a multi bet');

    const changed: { selectionId: string; odds: number }[] = [];
    for (const s of selections) {
      // Pre-match only: odds come from a pre-match feed, so betting closes at kickoff.
      const ev = s.market.event;
      if (s.market.status !== 'open' || ev.status !== 'scheduled' || ev.startsAt.getTime() <= Date.now()) {
        throw conflict('market_closed', `${s.market.event.home} v ${s.market.event.away} is not open for betting`);
      }
      const sent = input.selections.find((x) => x.selectionId === s.id)!;
      if (Math.abs(sent.odds - s.odds) > 1e-9) changed.push({ selectionId: s.id, odds: s.odds });
    }
    if (changed.length && !input.acceptOddsChanges) throw conflict('odds_changed', 'Odds have changed', { changed });

    const totalOdds = combineOdds(selections.map((s) => s.odds));
    const potential = potentialPayoutCents(input.stakeCents, totalOdds);

    const bet = await prisma.$transaction(async (tx) => {
      const b = await tx.bet.create({
        data: {
          ticket: ticketNo(),
          userId: req.user!.id,
          stakeCents: input.stakeCents,
          totalOdds,
          potentialPayoutCents: potential,
          legs: { create: selections.map((s) => ({ selectionId: s.id, odds: s.odds })) }
        }
      });
      await postEntry(tx, req.user!.id, -input.stakeCents, 'bet_stake', { type: 'bet', id: b.id }, b.ticket);
      return b;
    });
    res.status(201).json({ bet });
  })
);

betsRouter.get(
  '/',
  route(async (req, res) => {
    const status = req.query.status === 'settled' ? { in: ['won', 'lost', 'void'] } : 'open';
    const bets = await prisma.bet.findMany({
      where: { userId: req.user!.id, status },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { legs: { include: { selection: { include: { market: { include: { event: true } } } } } } }
    });
    res.json({
      bets: bets.map((b) => ({
        id: b.id,
        ticket: b.ticket,
        stakeCents: b.stakeCents,
        totalOdds: b.totalOdds,
        potentialPayoutCents: b.potentialPayoutCents,
        payoutCents: b.payoutCents,
        status: b.status,
        createdAt: b.createdAt,
        legs: b.legs.map((l) => {
          const e = l.selection.market.event;
          return { id: l.id, pick: l.selection.label, odds: l.odds, result: l.result, match: `${e.home} v ${e.away}`, eventStatus: e.status, score: e.homeScore !== null ? `${e.homeScore}-${e.awayScore}` : null };
        })
      }))
    });
  })
);

// ---------- Settlement ----------

/**
 * Grades the 1X2 market on the final score (or voids it) and settles every bet whose legs are all graded.
 * Idempotent: an event whose markets are already settled is left alone.
 */
async function gradeEvent(eventId: string, grade: (code: string) => 'won' | 'lost' | 'void', eventData: object) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.update({ where: { id: eventId }, data: eventData, include: eventInclude });
    const toGrade = event.markets.filter((m) => m.status !== 'settled');
    if (toGrade.length === 0) return { settled: 0 };
    const selectionIds: string[] = [];
    for (const m of toGrade) {
      await tx.market.update({ where: { id: m.id }, data: { status: 'settled' } });
      for (const s of m.selections) {
        const result = grade(s.code);
        await tx.selection.update({ where: { id: s.id }, data: { result } });
        await tx.betLeg.updateMany({ where: { selectionId: s.id }, data: { result } });
        selectionIds.push(s.id);
      }
    }
    const affected = await tx.bet.findMany({ where: { status: 'open', legs: { some: { selectionId: { in: selectionIds } } } }, include: { legs: true } });
    let settled = 0;
    for (const bet of affected) if (await settleBetIfComplete(tx, bet)) settled++;
    return { settled };
  });
}

export async function settleEvent(eventId: string, homeScore: number, awayScore: number) {
  const winning = homeScore > awayScore ? '1' : homeScore < awayScore ? '2' : 'X';
  const r = await gradeEvent(eventId, (code) => (code === winning ? 'won' : 'lost'), { status: 'finished', homeScore, awayScore });
  return { winning, ...r };
}

/** Postponed / cancelled / abandoned: every pick on it counts as odds 1.00; all-void bets are refunded. */
export async function voidEvent(eventId: string) {
  return gradeEvent(eventId, () => 'void', { status: 'cancelled' });
}

async function settleBetIfComplete(
  tx: Tx,
  bet: { id: string; userId: string; ticket: string; stakeCents: number; legs: { result: string; odds: number }[] }
) {
  if (bet.legs.some((l) => l.result === 'lost')) {
    await tx.bet.update({ where: { id: bet.id }, data: { status: 'lost', payoutCents: 0, settledAt: new Date() } });
    return true;
  }
  if (bet.legs.some((l) => l.result === 'pending')) return false;

  if (bet.legs.every((l) => l.result === 'void')) {
    const claimed = await tx.bet.updateMany({ where: { id: bet.id, status: 'open' }, data: { status: 'void', payoutCents: bet.stakeCents, settledAt: new Date() } });
    if (claimed.count === 1) await postEntry(tx, bet.userId, bet.stakeCents, 'bet_void', { type: 'bet', id: bet.id }, bet.ticket);
    return true;
  }

  // Void legs count as 1.00, so the payout is recomputed from the legs that actually won.
  const effectiveOdds = combineOdds(bet.legs.filter((l) => l.result === 'won').map((l) => l.odds));
  const gross = potentialPayoutCents(bet.stakeCents, effectiveOdds);
  const tax = Math.floor(Math.max(0, gross - bet.stakeCents) * config.WINNINGS_TAX_RATE);
  const payout = gross - tax;
  const claimed = await tx.bet.updateMany({ where: { id: bet.id, status: 'open' }, data: { status: 'won', payoutCents: payout, settledAt: new Date() } });
  if (claimed.count === 1) await postEntry(tx, bet.userId, payout, 'bet_win', { type: 'bet', id: bet.id }, bet.ticket);
  return true;
}
