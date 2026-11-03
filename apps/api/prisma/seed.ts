/**
 * Local development seed. Creates demo accounts, fixtures and odds.
 * NEVER run against production. Demo logins:
 *   Player: 0712000482 / demo-player-2026
 *   Admin:  0700000001 / demo-admin-2026
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

const hours = (h: number) => new Date(Date.now() + h * 3600 * 1000);

const fixtures: [string, string, string, number, [number, number, number], { live?: [number, number, number]; featured?: boolean }?][] = [
  ['Premier League', 'Arsenal', 'Liverpool', 30, [2.6, 3.45, 2.7], { featured: true }],
  ['Premier League', 'Chelsea', 'Man United', 4, [2.05, 3.5, 3.4]],
  ['Premier League', 'Man City', 'Tottenham', -1, [1.32, 5.2, 9.0], { live: [63, 2, 1] }],
  ['Premier League', 'Newcastle', 'Aston Villa', 50, [2.2, 3.4, 3.1]],
  ['Kenya Premier League', 'Gor Mahia', 'AFC Leopards', 46, [1.95, 3.1, 4.1]],
  ['Kenya Premier League', 'Tusker FC', 'Kakamega Homeboyz', -0.5, [2.4, 2.9, 3.2], { live: [28, 0, 0] }],
  ['Kenya Premier League', 'Shabana', 'Kariobangi Sharks', 70, [2.3, 3.0, 3.05]],
  ['LaLiga', 'Real Madrid', 'Sevilla', 33, [1.45, 4.6, 6.5]],
  ['LaLiga', 'Barcelona', 'Valencia', 57, [1.38, 5.0, 7.5]],
  ['Serie A', 'Napoli', 'Inter', 80, [2.75, 3.2, 2.6]],
  ['Champions League', 'Bayern Munich', 'PSG', 120, [1.9, 3.8, 3.7]]
];

async function main() {
  await prisma.$transaction([
    prisma.betLeg.deleteMany(),
    prisma.bet.deleteMany(),
    prisma.selection.deleteMany(),
    prisma.market.deleteMany(),
    prisma.event.deleteMany(),
    prisma.gameRound.deleteMany(),
    prisma.seedPair.deleteMany(),
    prisma.ledgerEntry.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.otpCode.deleteMany(),
    prisma.wallet.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.user.deleteMany()
  ]);

  const player = await prisma.user.create({
    data: {
      name: 'Demo Player',
      phone: '254712000482',
      passwordHash: await bcrypt.hash('demo-player-2026', 12),
      dateOfBirth: new Date('1995-06-14'),
      nationalId: '12345678',
      phoneVerified: true,
      kycStatus: 'verified',
      weeklyDepositLimitCents: 10_000_00,
      wallet: { create: { balanceCents: 2_450_00 } }
    }
  });
  await prisma.ledgerEntry.create({
    data: { walletId: player.id, amountCents: 2_450_00, balanceAfter: 2_450_00, kind: 'adjustment', note: 'Dev seed opening balance' }
  });

  await prisma.user.create({
    data: {
      name: 'ops.lead',
      phone: '254700000001',
      passwordHash: await bcrypt.hash('demo-admin-2026', 12),
      dateOfBirth: new Date('1990-01-01'),
      nationalId: '00000001',
      phoneVerified: true,
      kycStatus: 'verified',
      role: 'admin',
      wallet: { create: {} }
    }
  });

  for (const [league, home, away, inHours, odds, extra] of fixtures) {
    await prisma.event.create({
      data: {
        sport: 'Football',
        league,
        home,
        away,
        startsAt: hours(inHours),
        status: extra?.live ? 'live' : 'scheduled',
        minute: extra?.live?.[0],
        homeScore: extra?.live?.[1],
        awayScore: extra?.live?.[2],
        featured: extra?.featured ?? false,
        markets: {
          create: {
            type: '1X2',
            selections: {
              create: [
                { code: '1', label: home, odds: odds[0] },
                { code: 'X', label: 'Draw', odds: odds[1] },
                { code: '2', label: away, odds: odds[2] }
              ]
            }
          }
        }
      }
    });
  }
  console.log(`Seeded 2 users and ${fixtures.length} fixtures.`);
}

main().finally(() => prisma.$disconnect());
