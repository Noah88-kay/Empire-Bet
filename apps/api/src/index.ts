import { config } from './config.js';
import { createApp } from './app.js';
import { startFeed } from './feeds/sync.js';
import { ensureBootstrapAdmin } from './lib/bootstrap.js';

createApp().listen(config.API_PORT, () => {
  console.log(`Empire Bet API on http://localhost:${config.API_PORT} (M-Pesa: ${config.MPESA_MODE})`);
  ensureBootstrapAdmin().catch((e) => console.error('[bootstrap]', e));
  startFeed();
});
