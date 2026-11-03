import { prisma, type Tx } from '../db.js';

export async function audit(
  actor: { id?: string; name: string } | 'system',
  action: string,
  target?: string,
  meta?: Record<string, unknown>,
  tx?: Tx
) {
  const db = tx ?? prisma;
  await db.auditLog.create({
    data: {
      actorId: actor === 'system' ? null : actor.id,
      actor: actor === 'system' ? 'system' : actor.name,
      action,
      target,
      meta: meta ? JSON.stringify(meta) : undefined
    }
  });
}
