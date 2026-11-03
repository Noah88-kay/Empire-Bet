import type { Tx } from '../db.js';
import { conflict } from './http.js';

export type LedgerKind =
  | 'deposit'
  | 'withdrawal'
  | 'withdrawal_refund'
  | 'bet_stake'
  | 'bet_win'
  | 'bet_void'
  | 'game_stake'
  | 'game_win'
  | 'adjustment';

/**
 * The ONLY way balances change. Must run inside a transaction.
 * Debits use a conditional update so concurrent requests can never overdraw.
 */
export async function postEntry(
  tx: Tx,
  userId: string,
  amountCents: number,
  kind: LedgerKind,
  ref?: { type: string; id: string },
  note?: string
) {
  if (!Number.isInteger(amountCents) || amountCents === 0) throw new Error('Ledger amount must be a non-zero integer');

  if (amountCents < 0) {
    const res = await tx.wallet.updateMany({
      where: { userId, balanceCents: { gte: -amountCents } },
      data: { balanceCents: { increment: amountCents } }
    });
    if (res.count !== 1) throw conflict('insufficient_funds', 'Insufficient balance');
  } else {
    await tx.wallet.update({ where: { userId }, data: { balanceCents: { increment: amountCents } } });
  }

  const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
  return tx.ledgerEntry.create({
    data: {
      walletId: userId,
      amountCents,
      balanceAfter: wallet.balanceCents,
      kind,
      refType: ref?.type,
      refId: ref?.id,
      note
    }
  });
}
