import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { errorHandler, notFound } from './lib/http.js';
import { readUser } from './lib/auth.js';
import { callbackPath } from './integrations/mpesa.js';
import { authRouter } from './modules/auth.js';
import { mpesaCallbackRouter, walletRouter } from './modules/payments.js';
import { betsRouter, eventsRouter } from './modules/sports.js';
import { gamesRouter } from './modules/games.js';
import { accountRouter } from './modules/account.js';
import { adminRouter } from './modules/admin.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Daraja webhooks come before auth parsing; their path carries a secret.
  app.use(callbackPath(), mpesaCallbackRouter);

  app.use(readUser);
  app.get('/api/health', (_req, res) => res.json({ ok: true, mpesa: config.MPESA_MODE }));
  app.use('/api/auth', authRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/bets', betsRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}
