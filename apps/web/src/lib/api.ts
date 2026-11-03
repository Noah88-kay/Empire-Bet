export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

/** JSON fetch against the API. On 401 it refreshes the session once and retries. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return api<T>(path, init, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? 'Something went wrong', e.details);
  }
  return data as T;
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
