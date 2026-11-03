export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

// Same origin by default (API serves the site). Set VITE_API_URL when the API lives elsewhere.
const API_BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api`;

// ---- JWT token store ----
// Access token lives in memory only; the refresh token is kept so a reload stays signed in.
// (The server also sets httpOnly cookies, which cover same-origin use on their own.)
const REFRESH_KEY = 'eb_rt';
let accessToken: string | null = null;

export interface TokenResponse { accessToken?: string; refreshToken?: string }

export function saveTokens(t: TokenResponse) {
  if (t.accessToken) accessToken = t.accessToken;
  try {
    if (t.refreshToken) localStorage.setItem(REFRESH_KEY, t.refreshToken);
  } catch {
    /* storage blocked: cookies still work */
  }
}

export function clearTokens() {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

function storedRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

let refreshing: Promise<boolean> | null = null;

/** Rotates the refresh token once, even if many requests hit 401 at the same time. */
async function tryRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const rt = storedRefresh();
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rt ? { refreshToken: rt } : {})
    }).catch(() => null);
    if (!res?.ok) {
      clearTokens();
      return false;
    }
    saveTokens(await res.json());
    return true;
  })().finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

/** JSON fetch against the API with the JWT attached. On 401 it refreshes once and retries. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  const isAuthCall = /^\/auth\/(login|register|refresh|logout)/.test(path);
  if (res.status === 401 && retry && !isAuthCall) {
    if (await tryRefresh()) return api<T>(path, init, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? 'Something went wrong', e.details);
  }
  if (data && typeof data === 'object' && 'accessToken' in data) saveTokens(data as TokenResponse);
  return data as T;
}

/** Revokes this device's refresh token on the server and forgets the tokens locally. */
export async function logout() {
  const rt = storedRefresh();
  await api('/auth/logout', { body: rt ? { refreshToken: rt } : {} }).catch(() => undefined);
  clearTokens();
}

// ---- Response types ----

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: 'player' | 'finance' | 'admin';
  phoneVerified: boolean;
  kycStatus: 'pending' | 'verified' | 'rejected';
  weeklyDepositLimitCents: number | null;
  selfExcludedUntil: string | null;
}

export interface SelectionDto { id: string; code: '1' | 'X' | '2'; label: string; odds: number }
export interface EventDto {
  id: string;
  sport: string;
  league: string;
  leagueCode: string | null;
  home: string;
  away: string;
  startsAt: string;
  status: 'scheduled' | 'live' | 'finished' | 'cancelled';
  minute: number | null;
  clock: string | null;
  homeScore: number | null;
  awayScore: number | null;
  featured: boolean;
  source: string;
  oddsSource: string | null;
  oddsUpdatedAt: string | null;
  syncedAt: string | null;
  market?: { id: string; status: string; selections: SelectionDto[] };
}

export interface WalletDto { balanceCents: number; bonusCents: number; weeklyDepositLimitCents: number | null; depositedThisWeekCents: number }
export interface PaymentDto {
  id: string;
  type: 'deposit' | 'withdrawal';
  amountCents: number;
  status: string;
  mpesaReceipt: string | null;
  failureReason: string | null;
  createdAt: string;
}
export interface LedgerDto { id: string; amountCents: number; balanceAfter: number; kind: string; note: string | null; refId: string | null; createdAt: string }

export interface BetDto {
  id: string;
  ticket: string;
  stakeCents: number;
  totalOdds: number;
  potentialPayoutCents: number;
  payoutCents: number | null;
  status: 'open' | 'won' | 'lost' | 'void';
  createdAt: string;
  legs: { id: string; pick: string; odds: number; result: string; match: string; eventStatus: string; score: string | null }[];
}
