/**
 * ESPN public scoreboard client (no key). Gives real fixtures, kickoff times, live clock,
 * scores, final results and DraftKings pre-match 1X2 prices.
 *
 * It is an unofficial endpoint: fine for development and testing. A licensed operator should
 * swap this for a contracted odds & results feed before launch — the sync job only depends on
 * the FeedEvent shape below.
 */

export type FeedStatus = 'scheduled' | 'live' | 'finished' | 'cancelled';

export interface FeedEvent {
  externalId: string;
  leagueCode: string;
  league: string;
  home: string;
  away: string;
  startsAt: Date;
  status: FeedStatus;
  /** True when a final score includes extra time or penalties, so 90-minute 1X2 can't be graded from it. */
  needsReview: boolean;
  minute: number | null;
  clock: string | null;
  homeScore: number | null;
  awayScore: number | null;
  odds: { home: number; draw: number; away: number; source: string } | null;
}

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

/** American moneyline → decimal odds, 2 dp. */
export function americanToDecimal(ml: number | string | undefined | null): number | null {
  if (ml === undefined || ml === null || ml === '' || ml === 'EVEN') return ml === 'EVEN' ? 2 : null;
  const n = typeof ml === 'number' ? ml : Number(String(ml).replace('+', ''));
  if (!Number.isFinite(n) || n === 0) return null;
  const dec = n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  return Math.round(dec * 100) / 100;
}

function mapStatus(state: string, name: string, completed: boolean): FeedStatus {
  if (/POSTPONED|CANCELED|CANCELLED|ABANDONED/.test(name)) return 'cancelled';
  if (state === 'in') return 'live';
  if (state === 'post') return completed ? 'finished' : 'cancelled';
  return 'scheduled';
}

function parseOdds(o: any): FeedEvent['odds'] {
  if (!o) return null;
  // Prefer the current ("close") moneyline; fall back to the flat fields.
  const home = americanToDecimal(o.moneyline?.home?.close?.odds ?? o.homeTeamOdds?.moneyLine);
  const away = americanToDecimal(o.moneyline?.away?.close?.odds ?? o.awayTeamOdds?.moneyLine);
  const draw = americanToDecimal(o.moneyline?.draw?.close?.odds ?? o.drawOdds?.moneyLine);
  if (!home || !away || !draw) return null;
  return { home, draw, away, source: o.provider?.name ?? 'ESPN' };
}

export function parseScoreboard(json: any, leagueCode: string): FeedEvent[] {
  const league = json?.leagues?.[0]?.name ?? leagueCode;
  return (json?.events ?? []).flatMap((e: any): FeedEvent[] => {
    const c = e.competitions?.[0];
    const home = c?.competitors?.find((t: any) => t.homeAway === 'home');
    const away = c?.competitors?.find((t: any) => t.homeAway === 'away');
    if (!c || !home || !away) return [];
    const type = e.status?.type ?? {};
    const status = mapStatus(type.state, type.name ?? '', !!type.completed);
    const started = status === 'live' || status === 'finished';
    const minute = status === 'live' ? parseInt(String(e.status?.displayClock ?? ''), 10) || null : null;
    const clock = status === 'live' ? (/HALFTIME/.test(type.name) ? 'HT' : e.status?.displayClock ?? null) : status === 'finished' ? type.shortDetail ?? 'FT' : null;
    return [
      {
        externalId: `espn:${e.id}`,
        leagueCode,
        league,
        home: home.team?.displayName ?? 'Home',
        away: away.team?.displayName ?? 'Away',
        startsAt: new Date(e.date),
        status,
        needsReview: /AET|PEN|EXTRA/.test(type.name ?? ''),
        minute,
        clock,
        homeScore: started ? Number(home.score) : null,
        awayScore: started ? Number(away.score) : null,
        odds: parseOdds(c.odds?.[0])
      }
    ];
  });
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

export async function fetchDay(leagueCode: string, day: Date): Promise<FeedEvent[]> {
  const res = await fetch(`${BASE}/${leagueCode}/scoreboard?dates=${ymd(day)}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ESPN ${leagueCode} ${ymd(day)}: HTTP ${res.status}`);
  return parseScoreboard(await res.json(), leagueCode);
}
