import { config } from './config.js';
import { createApp } from './app.js';

createApp().listen(config.API_PORT, () => {
  console.log(`Empire Bet API on http://localhost:${config.API_PORT} (M-Pesa: ${config.MPESA_MODE})`);
});
