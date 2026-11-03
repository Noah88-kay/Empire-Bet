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
  SMS_MODE: z.enum(['console']).default('console')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

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
