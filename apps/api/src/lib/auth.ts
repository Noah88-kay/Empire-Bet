import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from './http.js';

/**
 * JWT authentication.
 * - Access token: 15 min, HS256, carries user id + role. Sent as `Authorization: Bearer <token>`
 *   or the httpOnly `eb_access` cookie (same-origin web app).
 * - Refresh token: 7 days, HS256, carries a jti tracked in the RefreshToken table. Every refresh
 *   rotates it; presenting an already-rotated token revokes the whole family (theft detection).
 *   Logout revokes it. A password change bumps tokenVersion, which kills all refresh tokens.
 */

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

export const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 7 * 24 * 60 * 60;
const ISSUER = 'empire-bet';
const ACCESS_AUD = 'empire-bet:access';
const REFRESH_AUD = 'empire-bet:refresh';

const baseCookie: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.NODE_ENV === 'production'
};

interface AccessClaims { sub: string; role: Role; name: string }
interface RefreshClaims { sub: string; jti: string; fam: string; v: number }

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

type SessionUser = { id: string; role: string; name: string; tokenVersion: number };

function signAccess(user: SessionUser) {
  return jwt.sign({ role: user.role, name: user.name }, config.JWT_ACCESS_SECRET, {
    subject: user.id, issuer: ISSUER, audience: ACCESS_AUD, expiresIn: ACCESS_TTL_S, algorithm: 'HS256'
  });
}

/** Issues a new access + refresh pair, records the refresh jti, and sets the cookies. */
export async function issueSession(req: Request, res: Response, user: SessionUser, familyId?: string): Promise<TokenPair> {
  const jti = crypto.randomUUID();
  const fam = familyId ?? crypto.randomUUID();
  await prisma.refreshToken.create({
    data: {
      id: jti, userId: user.id, familyId: fam,
      expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
      userAgent: req.get('user-agent')?.slice(0, 200)
    }
  });
  const accessToken = signAccess(user);
  const refreshToken = jwt.sign({ fam, v: user.tokenVersion }, config.JWT_REFRESH_SECRET, {
    subject: user.id, jwtid: jti, issuer: ISSUER, audience: REFRESH_AUD, expiresIn: REFRESH_TTL_S, algorithm: 'HS256'
  });
  res.cookie('eb_access', accessToken, { ...baseCookie, maxAge: ACCESS_TTL_S * 1000, path: '/' });
  res.cookie('eb_refresh', refreshToken, { ...baseCookie, maxAge: REFRESH_TTL_S * 1000, path: '/api/auth' });
  return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: ACCESS_TTL_S };
}

export function clearSession(res: Response) {
  res.clearCookie('eb_access', { ...baseCookie, path: '/' });
  res.clearCookie('eb_refresh', { ...baseCookie, path: '/api/auth' });
}

function verifyRefresh(token: string): RefreshClaims | null {
  try {
    return jwt.verify(token, config.JWT_REFRESH_SECRET, { issuer: ISSUER, audience: REFRESH_AUD, algorithms: ['HS256'] }) as RefreshClaims;
  } catch {
    return null;
  }
}

const presentedRefresh = (req: Request): string | undefined =>
  (typeof req.body?.refreshToken === 'string' && req.body.refreshToken) || req.cookies?.eb_refresh;

/** Rotates the refresh token: revokes the presented one and issues a new pair in the same family. */
export async function refreshSession(req: Request, res: Response) {
  const token = presentedRefresh(req);
  if (!token) throw unauthorized();
  const claims = verifyRefresh(token);
  if (!claims) throw unauthorized('Session expired');

  const row = await prisma.refreshToken.findUnique({ where: { id: claims.jti } });
  if (!row || row.userId !== claims.sub || row.expiresAt < new Date()) throw unauthorized('Session expired');

  if (row.revokedAt) {
    // A rotated token was used again: someone else has a copy. End every session in that family.
    await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    clearSession(res);
    throw unauthorized('Session ended for your security. Please log in again.');
  }

  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.tokenVersion !== claims.v || user.status !== 'active') throw unauthorized('Session expired');

  // Claim the row atomically so two parallel refreshes can't both succeed.
  const claimed = await prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (claimed.count !== 1) throw unauthorized('Session expired');
  const tokens = await issueSession(req, res, user, row.familyId);
  await prisma.refreshToken.update({ where: { id: row.id }, data: { replacedBy: verifyRefresh(tokens.refreshToken)?.jti } });
  return { user, tokens };
}

/** Revokes the presented refresh token (this device) and clears cookies. */
export async function revokeSession(req: Request, res: Response) {
  const token = presentedRefresh(req);
  const claims = token ? verifyRefresh(token) : null;
  if (claims) await prisma.refreshToken.updateMany({ where: { id: claims.jti, revokedAt: null }, data: { revokedAt: new Date() } });
  clearSession(res);
}

/** Revokes every refresh token of a user (all devices). */
export async function revokeAllSessions(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

function bearer(req: Request): string | undefined {
  const h = req.get('authorization');
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
  return undefined;
}

/** Attaches req.user when a valid access token is present (Bearer header first, then cookie). */
export function readUser(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req) ?? req.cookies?.eb_access;
  if (token) {
    try {
      const p = jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: ACCESS_AUD, algorithms: ['HS256'] }) as AccessClaims;
      req.user = { id: p.sub, role: p.role, name: p.name };
    } catch {
      /* expired or invalid: anonymous; client refreshes on 401 */
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
