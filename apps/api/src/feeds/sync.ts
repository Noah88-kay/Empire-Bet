import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { settleEvent, voidEvent } from '../modules/sports.js';
import { fetchDay, type FeedEvent } from './espn.js';

const FEED_ID = 'espn';
const leagues = () => config.FEED_LEAGUES.split(',').map((s) => s.trim()).filter(Boolean);
const FEATURED_LEAGUES = ['uefa.champions', 'eng.1', 'esp.1'];

const dayOffset = (n: number) => new Date(Date.now() + n * 86400_000);

/** Applies one feed event: upsert fixture, refresh odds, open/suspend the market, settle or void when it ends. */
async function applyEvent(f: FeedEvent) {
  const now = new Date();
  const existing = await prisma.event.findUnique({
    where: { externalId: f.externalId },
    include: { markets: { include: { selections: true } } }
  });

  const data = {
    league: f.league,
    leagueCode: f.leagueCode,
    home: f.home,
    away: f.away,
    startsAt: f.startsAt,
    minute: f.minute,
    clock: f.clock,
    homeScore: f.homeScore,
    awayScore: f.awayScore,
    syncedAt: now,
    // finished/cancelled are written by settleEvent/voidEvent so grading happens exactly once
    ...(f.status === 'scheduled' || f.status === 'live' ? { status: f.status } : {})
  };

  let event = existing;
  if (!event) {
    event = await prisma.event.create({
      data: {
        ...data,
        status: f.status === 'scheduled' || f.status === 'live' ? f.status : 'scheduled',
        source: 'espn',
        externalId: f.externalId,
        sport: 'Football',
        markets: {
          create: {
            type: '1X2',
            status: 'suspended',
            selections: {
              create: [
                { code: '1', label: f.home, odds: f.odds?.home ?? 1 },
                { code: 'X', label: 'Draw', odds: f.odds?.draw ?? 1 },
                { code: '2', label: f.away, odds: f.odds?.away ?? 1 }
              ]
            }
          }
        }
      },
      include: { markets: { include: { selections: true } } }
    });
  } else {
    await prisma.event.update({ where: { id: event.id }, data });
  }

  const market = event.markets.find((m) => m.type === '1X2');
  if (!market || market.status === 'settled') return;

  // Odds: only move them while the match hasn't started.
  if (f.odds && f.status === 'scheduled') {
    const next: Record<string, number> = { '1': f.odds.home, X: f.odds.draw, '2': f.odds.away };
    for (const s of market.selections) {
      if (Math.abs(s.odds - next[s.code]) > 1e-9) await prisma.selection.update({ where: { id: s.id }, data: { odds: next[s.code] } });
    }
    await prisma.event.update({ where: { id: event.id }, data: { oddsSource: f.odds.source, oddsUpdatedAt: now } });
  }

  const hasOdds = !!f.odds || (event.oddsUpdatedAt !== null && event.oddsUpdatedAt !== undefined);
  const shouldOpen = f.status === 'scheduled' && f.startsAt > now && hasOdds;
  const wanted = shouldOpen ? 'open' : 'suspended';
  if (market.status !== wanted && (f.status === 'scheduled' || f.status === 'live')) {
    await prisma.market.update({ where: { id: market.id }, data: { status: wanted } });
  }

  if (f.status === 'finished') {
    if (f.needsReview) {
      await prisma.event.update({ where: { id: event.id }, data: { status: 'finished' } });
      await prisma.market.update({ where: { id: market.id }, data: { status: 'suspended' } });
      if (market.status !== 'suspended') await audit('system', 'feed.needs_manual_settlement', event.id, { reason: 'extra time / penalties' });
      return;
    }
    const r = await settleEvent(event.id, f.homeScore ?? 0, f.awayScore ?? 0);
    if (r.settled > 0 || market.status !== 'settled') await audit('system', 'feed.event.settled', event.id, { score: `${f.homeScore}-${f.awayScore}`, bets: r.settled });
  } else if (f.status === 'cancelled') {
    const r = await voidEvent(event.id);
    await audit('system', 'feed.event.voided', event.id, { bets: r.settled });
  }
}

async function runDays(days: number[]) {
  const started = new Date();
  let seen = 0;
  const errors: string[] = [];
  for (const league of leagues()) {
    for (const d of days) {
      try {
        const events = await fetchDay(league, dayOffset(d));
        for (const e of events) {
          await applyEvent(e);
          seen++;
        }
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
  }
  await suspendStartedMarkets();
  await prisma.feedState.upsert({
    where: { id: FEED_ID },
    create: { id: FEED_ID, lastRunAt: started, lastOkAt: errors.length ? null : new Date(), lastError: errors[0] ?? null, eventsSeen: seen },
    update: { lastRunAt: started, ...(errors.length < leagues().length * days.length ? { lastOkAt: new Date() } : {}), lastError: errors[0] ?? null, eventsSeen: seen }
  });
  return { seen, errors };
}

/** Safety net: close betting at kickoff even if the feed is late to flip the status. */
async function suspendStartedMarkets() {
  await prisma.market.updateMany({
    where: { status: 'open', event: { startsAt: { lte: new Date() } } },
    data: { status: 'suspended' }
  });
}

async function pickFeatured() {
  const candidates = await prisma.event.findMany({
    where: { status: 'scheduled', startsAt: { gt: new Date(), lte: dayOffset(3) }, markets: { some: { status: 'open' } } },
    orderBy: { startsAt: 'asc' }
  });
  const pick = FEATURED_LEAGUES.map((l) => candidates.find((c) => c.leagueCode === l)).find(Boolean) ?? candidates[0];
  await prisma.event.updateMany({ where: { featured: true }, data: { featured: false } });
  if (pick) await prisma.event.update({ where: { id: pick.id }, data: { featured: true } });
}

let liveBusy = false;
let fullBusy = false;

export async function fullSync() {
  if (fullBusy) return;
  fullBusy = true;
  try {
    const days = Array.from({ length: config.FEED_DAYS_AHEAD + 2 }, (_, i) => i - 1); // yesterday … +N days
    const r = await runDays(days);
    await pickFeatured();
    console.log(`[feed] full sync: ${r.seen} events, ${r.errors.length} errors`);
  } finally {
    fullBusy = false;
  }
}

export async function liveSync() {
  if (liveBusy || fullBusy) return;
  liveBusy = true;
  try {
    await runDays([-1, 0]);
  } finally {
    liveBusy = false;
  }
}

export function startFeed() {
  if (config.FEED_MODE === 'off') {
    console.log('[feed] disabled (FEED_MODE=off)');
    return;
  }
  const safe = (fn: () => Promise<unknown>) => () => fn().catch((e) => console.error('[feed]', e));
  safe(fullSync)();
  setInterval(safe(liveSync), config.FEED_LIVE_INTERVAL_S * 1000);
  setInterval(safe(fullSync), config.FEED_FULL_INTERVAL_S * 1000);
  setInterval(safe(suspendStartedMarkets), 10_000);
  console.log(`[feed] ESPN sync on: ${leagues().join(', ')}`);
}
