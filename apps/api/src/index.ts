import { config, smsEnabled } from './config.js';
import { createApp } from './app.js';
import { startFeed } from './feeds/sync.js';
import { ensureBootstrapAdmin, releaseUnverifiedPhones } from './lib/bootstrap.js';

createApp().listen(config.API_PORT, () => {
  console.log(`Empire Bet API on http://localhost:${config.API_PORT} (M-Pesa: ${config.MPESA_MODE}, SMS: ${smsEnabled ? 'Africa\'s Talking' : 'off, phone codes not required'})`);
  ensureBootstrapAdmin().catch((e) => console.error('[bootstrap]', e));
  releaseUnverifiedPhones().catch((e) => console.error('[auth]', e));
  startFeed();
});
