import { config } from '../config.js';

/** Swap the console driver for a real gateway (e.g. Africa's Talking) before launch. */
export async function sendSms(phone: string, message: string) {
  if (config.SMS_MODE === 'console') {
    console.log(`\n[sms → +${phone}] ${message}\n`);
    return;
  }
}
