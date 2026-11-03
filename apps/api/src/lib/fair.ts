import crypto from 'node:crypto';

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomSeed = () => crypto.randomBytes(32).toString('hex');

/**
 * Provably fair float in [0, 1): HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`),
 * first 52 bits as a fraction. Players can recompute it once the server seed is revealed.
 */
export function fairFloat(serverSeed: string, clientSeed: string, nonce: number): number {
  const hmac = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');
  const int = parseInt(hmac.slice(0, 13), 16);
  return int / 2 ** 52;
}

/** Dice roll 0.00–99.99 */
export const diceRoll = (f: number) => Math.floor(f * 10000) / 100;
