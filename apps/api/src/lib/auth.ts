import jwt from 'jsonwebtoken';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from './http.js';

export type Role = 'player' | 'finance' | 'admin';
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 7 * 24 * 60 * 60;

const baseCookie: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.NODE_ENV === 'production'
};

export function issueSession(res: Response, user: { id: string; role: string; name: string; tokenVersion: number }) {
  const access = jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL_S });
  const refresh = jwt.sign({ sub: user.id, v: user.tokenVersion }, config.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL_S });
  res.cookie('eb_access', access, { ...baseCookie, maxAge: ACCESS_TTL_S * 1000, path: '/' });
  res.cookie('eb_refresh', refresh, { ...baseCookie, maxAge: REFRESH_TTL_S * 1000, path: '/api/auth' });
}

export function clearSession(res: Response) {
  res.clearCookie('eb_access', { ...baseCookie, path: '/' });
  res.clearCookie('eb_refresh', { ...baseCookie, path: '/api/auth' });
}

export async function refreshSession(req: Request, res: Response) {
  const token = req.cookies?.eb_refresh;
  if (!token) throw unauthorized();
  let payload: { sub: string; v: number };
  try {
    payload = jwt.verify(token, config.JWT_REFRESH_SECRET) as { sub: string; v: number };
  } catch {
    throw unauthorized('Session expired');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.tokenVersion !== payload.v || user.status !== 'active') throw unauthorized('Session expired');
  issueSession(res, user);
  return user;
}

/** Attaches req.user when a valid access cookie is present. */
export function readUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.eb_access;
  if (token) {
    try {
      const p = jwt.verify(token, config.JWT_ACCESS_SECRET) as { sub: string; role: Role; name: string };
      req.user = { id: p.sub, role: p.role, name: p.name };
    } catch {
      /* expired or invalid: treated as anonymous; client refreshes on 401 */
    }
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

/** Loads the full user and checks they may move money or play. */
export async function requirePlayable(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.status !== 'active') throw forbidden('Your account is suspended. Contact support.');
  if (!user.phoneVerified) throw forbidden('Verify your phone number first.');
  if (user.selfExcludedUntil && user.selfExcludedUntil > new Date()) {
    throw forbidden(`You are on a break until ${user.selfExcludedUntil.toDateString()}.`);
  }
  return user;
}
