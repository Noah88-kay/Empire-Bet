// Runs against a throwaway SQLite file: `npm test` (see package.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { americanToDecimal, parseScoreboard } from './espn.js';
import { prisma } from '../db.js';
import { postEntry } from '../lib/ledger.js';
import { settleEvent, voidEvent } from '../modules/sports.js';

test('american moneyline converts to decimal odds', () => {
  assert.equal(americanToDecimal('-110'), 1.91);
  assert.equal(americanToDecimal('+275'), 3.75);
  assert.equal(americanToDecimal(-165), 1.61);
  assert.equal(americanToDecimal('+400'), 5);
  assert.equal(americanToDecimal('EVEN'), 2);
  assert.equal(americanToDecimal(undefined), null);
});

test('scoreboard parsing maps status, clock and odds', () => {
  const json = {
    leagues: [{ name: 'English Premier League' }],
    events: [
      {
        id: '1',
        date: '2026-11-08T14:00Z',
        status: { displayClock: "63'", type: { state: 'in', name: 'STATUS_SECOND_HALF', completed: false } },
        competitions: [{ competitors: [{ homeAway: 'home', score: '2', team: { displayName: 'A' } }, { homeAway: 'away', score: '1', team: { displayName: 'B' } }] }]
      },
      {
        id: '2',
        date: '2026-11-08T14:00Z',
        status: { type: { state: 'post', name: 'STATUS_POSTPONED', completed: false } },
        competitions: [{ competitors: [{ homeAway: 'home', score: '0', team: { displayName: 'C' } }, { homeAway: 'away', score: '0', team: { displayName: 'D' } }] }]
      },
      {
        id: '3',
        date: '2026-11-08T14:00Z',
        status: { type: { state: 'post', name: 'STATUS_FINAL_PEN', completed: true, shortDetail: 'FT-Pens' } },
        competitions: [
          {
            competitors: [{ homeAway: 'home', score: '1', team: { displayName: 'E' } }, { homeAway: 'away', score: '1', team: { displayName: 'F' } }],
            odds: [{ provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: '-110' } }, draw: { close: { odds: '+275' } }, away: { close: { odds: '+265' } } } }]
          }
        ]
      }
    ]
  };
  const [live, postponed, pens] = parseScoreboard(json, 'eng.1');
  assert.equal(live.status, 'live');
  assert.equal(live.minute, 63);
  assert.equal(live.homeScore, 2);
  assert.equal(postponed.status, 'cancelled');
  assert.equal(pens.status, 'finished');
  assert.equal(pens.needsReview, true);
  assert.deepEqual(pens.odds, { home: 1.91, draw: 3.75, away: 3.65, source: 'DraftKings' });
});

async function makeEvent(name: string, odds: [number, number, number]) {
  return prisma.event.create({
    data: {
      sport: 'Football', league: 'Test', home: `${name} H`, away: `${name} A`, startsAt: new Date(Date.now() + 3600_000),
      markets: { create: { type: '1X2', selections: { create: [{ code: '1', label: 'H', odds: odds[0] }, { code: 'X', label: 'Draw', odds: odds[1] }, { code: '2', label: 'A', odds: odds[2] }] } } }
    },
    include: { markets: { include: { selections: true } } }
  });
}

async function placeBet(userId: string, stakeCents: number, selections: { id: string; odds: number }[]) {
  const total = Math.round(selections.reduce((p, s) => p * s.odds, 1) * 100) / 100;
  return prisma.$transaction(async (tx) => {
    const bet = await tx.bet.create({
      data: {
        ticket: `T-${Math.random().toString(36).slice(2)}`, userId, stakeCents, totalOdds: total, potentialPayoutCents: Math.floor(stakeCents * total),
        legs: { create: selections.map((s) => ({ selectionId: s.id, odds: s.odds })) }
      }
    });
    await postEntry(tx, userId, -stakeCents, 'bet_stake', { type: 'bet', id: bet.id });
    return bet;
  });
}

test('settlement: wins, losses, full void refund and partial void payout', async () => {
  const user = await prisma.user.create({
    data: { name: 'T', phone: `2547${Date.now().toString().slice(-8)}`, passwordHash: 'x', dateOfBirth: new Date('1990-01-01'), nationalId: '1', wallet: { create: { balanceCents: 100_000 } } }
  });
  const a = await makeEvent('A', [2.0, 3.0, 4.0]);
  const b = await makeEvent('B', [1.5, 3.5, 6.0]);
  const sa = a.markets[0].selections.find((s) => s.code === '1')!;
  const sb = b.markets[0].selections.find((s) => s.code === '1')!;

  const single = await placeBet(user.id, 10_000, [sb]); // only on B, which gets postponed
  const multi = await placeBet(user.id, 10_000, [sa, sb]); // A wins, B void → pays at 2.00

  await settleEvent(a.id, 2, 0);
  await voidEvent(b.id);
  // Re-running is a no-op (feed polls the same finished match many times).
  await settleEvent(a.id, 2, 0);
  await voidEvent(b.id);

  const s = await prisma.bet.findUniqueOrThrow({ where: { id: single.id } });
  const m = await prisma.bet.findUniqueOrThrow({ where: { id: multi.id } });
  assert.equal(s.status, 'void');
  assert.equal(s.payoutCents, 10_000);
  assert.equal(m.status, 'won');
  assert.equal(m.payoutCents, 20_000);

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(wallet.balanceCents, 100_000 - 20_000 + 10_000 + 20_000);
});
