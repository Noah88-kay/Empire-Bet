# Empire Bet

Sports betting and casino platform. React (Vite) front end, Node (Express) API, Prisma ORM, M-Pesa via Safaricom Daraja.

```
apps/
  api/      Node 20+ · Express · Prisma · zod · JWT cookies
  web/      React 18 · Vite · React Router · TanStack Query · Zustand
packages/
  shared/   zod schemas, odds maths and money helpers used by both
```

## Run it locally

Requires Node 20+.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # then set the JWT secrets
npm run db:setup                         # creates the SQLite dev DB and seeds demo data
npm run dev                              # API on :4000, web on :5173
```

Demo logins (local seed only, see `apps/api/prisma/seed.ts`) are a player and an admin account.
In dev, SMS codes are printed in the API terminal and M-Pesa runs in `mock` mode: deposits and withdrawals confirm themselves after ~3 seconds.

## How money works

- All amounts are integer cents. No floats touch balances.
- `apps/api/src/lib/ledger.ts` is the only code that changes a balance. Every change writes a `LedgerEntry` with `balanceAfter`, inside a DB transaction. Debits use a conditional update, so two requests at once can't overdraw.
- Bets: odds are re-checked on the server when placing; if they moved the player must accept the new price. The stake is debited in the same transaction as the bet.
- Settlement: `POST /api/admin/events/:id/settle` grades the 1X2 market and pays winning bets. Replace with the results feed of your odds provider.
- Withdrawals: debited when requested. At or below `AUTO_APPROVE_WITHDRAWAL_KES` with verified ID they go straight to M-Pesa B2C; above it they wait for a finance review. Failed or declined payouts are refunded by ledger entry. **No fees are charged to withdraw.**
- Casino originals (Dice, Coin Toss) run on the server with provably fair seeds (`HMAC-SHA256(serverSeed, clientSeed:nonce)`).

## Live fixtures, scores and odds

`apps/api/src/feeds/` syncs real football data (`FEED_MODE=espn`, the default):

- Leagues in `FEED_LEAGUES` (EPL, LaLiga, Serie A, Bundesliga, Ligue 1, Champions League, Europa League, Kenyan PL), from yesterday to `FEED_DAYS_AHEAD` days out, every `FEED_FULL_INTERVAL_S` (10 min). Today and yesterday refresh every `FEED_LIVE_INTERVAL_S` (30 s) for live clock and scores.
- Odds are DraftKings pre-match 1X2 prices, converted from American to decimal. A match with no prices is listed but can't be bet on; nothing is made up.
- Betting is pre-match only: markets suspend at kickoff (also enforced by a 10 s safety sweep and at bet placement).
- Full time → settled automatically. Postponed/cancelled/abandoned → voided: those picks count as 1.00 and all-void bets are refunded. Matches decided after extra time or penalties are left for manual settlement in the back office, because 1X2 is graded on 90 minutes.
- The source is ESPN's public, unofficial scoreboard. Good for development; a licensed operator must replace it with a contracted odds & results feed. Only `feeds/espn.ts` needs swapping. ESPN currently has no 2026-27 Kenyan Premier League data.

`npm test` runs feed parsing and settlement tests on a throwaway database.

## API overview

| Area | Routes |
| --- | --- |
| Auth | `POST /api/auth/register · login · refresh · logout · verify-phone · resend-otp`, `GET /api/auth/me` |
| Wallet | `GET /api/wallet`, `GET /api/wallet/transactions`, `POST /api/wallet/deposit · withdraw`, `GET /api/wallet/payments/:id` |
| Sports | `GET /api/events`, `GET /api/events/results`, `POST /api/bets`, `GET /api/bets?status=open\|settled` |
| Casino | `POST /api/games/dice · coin`, `GET /api/games/fairness`, `POST /api/games/fairness/rotate` |
| Account | `PATCH /api/account/limits`, `POST /api/account/self-exclude` |
| Admin | `/api/admin/overview · withdrawals · kyc · events · audit` (roles: admin, finance) |
| M-Pesa webhooks | `/api/payments/mpesa/<MPESA_CALLBACK_SECRET>/stk · b2c-result · b2c-timeout` |

## Before going live

- [ ] BCLB licence; fill in every `[PLACEHOLDER]` in the UI (licence no., support contact, helpline).
- [ ] Switch `prisma/schema.prisma` provider to `postgresql`, set `DATABASE_URL`, run migrations (`prisma migrate`).
- [ ] Real Daraja credentials, `MPESA_MODE=production`, a public HTTPS `MPESA_CALLBACK_BASE_URL`; restrict callbacks to Safaricom IPs at the proxy.
- [ ] Real SMS gateway in `apps/api/src/integrations/sms.ts`.
- [ ] Licensed odds and results feed replacing the ESPN development feed (and a source for the Kenyan Premier League).
- [ ] ID verification provider for KYC; confirm current tax rules and set `WINNINGS_TAX_RATE`.
- [ ] Not yet built: in-play betting, live push updates (Socket.IO; the UI polls every 15–20 s), cash-out, more markets than 1X2, Crash/Mines/Plinko, slot aggregator, wider test coverage.
