import { z } from 'zod';

const envSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  AUTO_APPROVE_WITHDRAWAL_KES: z.coerce.number().default(20000),
  WINNINGS_TAX_RATE: z.coerce.number().min(0).max(1).default(0),
  MPESA_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_B2C_SHORTCODE: z.string().optional(),
  MPESA_B2C_INITIATOR: z.string().optional(),
  MPESA_B2C_SECURITY_CREDENTIAL: z.string().optional(),
  MPESA_CALLBACK_BASE_URL: z.string().optional(),
  MPESA_CALLBACK_SECRET: z.string().min(8),
  // console = codes only printed in the server log; africastalking = real SMS.
  // Phone verification by SMS code is only required when a real provider is configured.
  SMS_MODE: z.enum(['console', 'africastalking']).default('console'),
  AT_USERNAME: z.string().optional(), // "sandbox" for Africa's Talking test accounts
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(), // approved alphanumeric sender ID, optional
  // Live fixtures/scores/odds. "off" leaves events to manual entry in the back office.
  FEED_MODE: z.enum(['espn', 'off']).default('espn'),
  FEED_LEAGUES: z.string().default('eng.1,esp.1,ita.1,ger.1,fra.1,uefa.champions,uefa.europa,ken.1'),
  FEED_DAYS_AHEAD: z.coerce.number().int().min(0).max(14).default(7),
  FEED_LIVE_INTERVAL_S: z.coerce.number().int().min(15).default(30),
  FEED_FULL_INTERVAL_S: z.coerce.number().int().min(60).default(600),
  // Optional: creates the first back-office account on startup if it doesn't exist yet
  // (for hosts without shell access, e.g. Render's free plan). Remove after the first login.
  ADMIN_PHONE: z.string().optional(),
  ADMIN_NAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

/** True only when SMS codes can actually reach a phone. */
export const smsEnabled = config.SMS_MODE === 'africastalking' && !!config.AT_USERNAME && !!config.AT_API_KEY;

if (config.NODE_ENV === 'production') {
  const weak = ['change-me-access', 'change-me-refresh', 'change-me-callback'];
  if (weak.includes(config.JWT_ACCESS_SECRET) || weak.includes(config.JWT_REFRESH_SECRET) || weak.includes(config.MPESA_CALLBACK_SECRET)) {
    console.error('Refusing to start in production with default secrets.');
    process.exit(1);
  }
  if (config.MPESA_MODE === 'mock') {
    console.error('MPESA_MODE=mock is not allowed in production.');
    process.exit(1);
  }
}
