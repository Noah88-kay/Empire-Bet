// Runs the API tests against a throwaway SQLite database so dev data is never touched.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const env = { ...process.env, DATABASE_URL: 'file:./test.db', FEED_MODE: 'off' };
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });
const cleanup = () => rmSync(new URL('../prisma/test.db', import.meta.url), { force: true });

cleanup();
try {
  run('npx prisma db push --skip-generate');
  run('npx tsx --env-file=.env --test src/**/*.test.ts');
} finally {
  cleanup();
}
