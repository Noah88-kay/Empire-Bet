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

## Deploy on Render

`render.yaml` is a Render Blueprint: one Node web service (the API, which also serves the built React site, so both share one URL) and a PostgreSQL database.

1. Render dashboard → **New → Blueprint** → select this repository (branch `main`).
2. Fill the values marked `sync: false`: `WEB_ORIGIN` and `MPESA_CALLBACK_BASE_URL` (your Render URL, e.g. `https://empire-bet.onrender.com`), `ADMIN_PHONE` / `ADMIN_NAME` / `ADMIN_PASSWORD` (8+ characters) for the first back-office login, and the Daraja credentials (can stay empty for a demo). JWT and callback secrets are generated for you.
3. When the deploy is live, log in with the admin phone and password, then delete `ADMIN_PASSWORD` in the service's Environment tab. (On a paid plan you can instead use `npm run create-admin -w @empire/api` in the Shell.)

`render.yaml` uses Render's **free** plans. Free web services sleep after 15 minutes without visits (the next visit takes about a minute to wake, and the live feed pauses while asleep; it catches up on wake). Free Postgres expires 30 days after creation. Switch to `plan: starter` and `plan: basic-256mb` for an always-on site that keeps its data.

The build switches the Prisma provider from SQLite to PostgreSQL and runs `prisma db push`. Move to `prisma migrate` once the schema settles.

## Authentication (JWT)

- **Access token:** 15 minutes, HS256, carries user id and role. Send it as `Authorization: Bearer <token>`; the web app on the same origin also gets it as an httpOnly cookie.
- **Refresh token:** 7 days. `POST /api/auth/refresh` with `{ "refreshToken": "..." }` (or the cookie) returns a new pair. Every refresh rotates the token; reusing an old one ends that whole login session (stolen-token detection) without affecting other devices.
- `POST /api/auth/logout` revokes the current refresh token; `POST /api/auth/logout-all` revokes every session for the user.
- Login, register and refresh all return `{ user, accessToken, refreshToken, tokenType, expiresIn }`, so mobile apps or a separately hosted front end can use the API (set `VITE_API_URL` for the latter).
- **Phone codes:** SMS verification is only required when a real SMS provider is configured (`SMS_MODE=africastalking` + `AT_USERNAME` + `AT_API_KEY`). Without one, new accounts are usable straight after sign-up.
- **First admin:** `ADMIN_PHONE` / `ADMIN_NAME` / `ADMIN_PASSWORD` (8+ characters) are applied on every start: the account is created, or promoted to admin and given that password if the phone already exists.

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
- [ ] Real Daraja credentials, `MPESA_MODE=production`, a public HTTPS `MPESA_CALLBACK_BASE_URL`; restrict callbacks to Safaricom IPs at the proxy.
- [ ] Africa's Talking account for SMS codes (`SMS_MODE=africastalking`, `AT_USERNAME`, `AT_API_KEY`) so phone numbers are verified again.
- [ ] Licensed odds and results feed replacing the ESPN development feed (and a source for the Kenyan Premier League).
- [ ] ID verification provider for KYC; confirm current tax rules and set `WINNINGS_TAX_RATE`.
- [ ] Not yet built: in-play betting, live push updates (Socket.IO; the UI polls every 15–20 s), cash-out, more markets than 1X2, Crash/Mines/Plinko, slot aggregator, wider test coverage.
