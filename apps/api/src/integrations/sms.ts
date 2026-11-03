import { config, smsEnabled } from '../config.js';

/**
 * Sends an SMS. With SMS_MODE=africastalking (plus AT_USERNAME / AT_API_KEY) it uses
 * Africa's Talking; otherwise the message is only printed in the server log.
 */
export async function sendSms(phone: string, message: string) {
  if (!smsEnabled) {
    console.log(`\n[sms → +${phone}] ${message}\n`);
    return;
  }
  const host = config.AT_USERNAME === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
  const body = new URLSearchParams({ username: config.AT_USERNAME!, to: `+${phone}`, message });
  if (config.AT_SENDER_ID) body.set('from', config.AT_SENDER_ID);
  const res = await fetch(`${host}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: config.AT_API_KEY!, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000)
  });
  const json = (await res.json().catch(() => null)) as { SMSMessageData?: { Recipients?: { status: string }[] } } | null;
  const status = json?.SMSMessageData?.Recipients?.[0]?.status;
  if (!res.ok || status !== 'Success') throw new Error(`SMS not sent (${res.status} ${status ?? 'no status'})`);
}
