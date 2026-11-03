import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Safaricom Daraja client.
 * - mock: no network; a simulated callback fires a few seconds later (local dev only).
 * - sandbox / production: real STK push (deposits) and B2C (withdrawals).
 */

export interface StkResult {
  checkoutRequestId: string;
  success: boolean;
  receipt?: string;
  amountKes?: number;
  reason?: string;
}
export interface B2cResult {
  conversationId: string;
  success: boolean;
  receipt?: string;
  reason?: string;
}

type Handlers = { stk: (r: StkResult) => Promise<void>; b2c: (r: B2cResult) => Promise<void> };
let handlers: Handlers | null = null;
/** The payments module registers its callback handlers so mock mode can drive the same code path. */
export function registerMpesaHandlers(h: Handlers) {
  handlers = h;
}

const baseUrl = () => (config.MPESA_MODE === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
export const callbackPath = () => `/api/payments/mpesa/${config.MPESA_CALLBACK_SECRET}`;
const callbackUrl = (suffix: string) => `${config.MPESA_CALLBACK_BASE_URL}${callbackPath()}/${suffix}`;

let cachedToken: { value: string; expires: number } | null = null;
async function token(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
  const basic = Buffer.from(`${config.MPESA_CONSUMER_KEY}:${config.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: string };
  cachedToken = { value: body.access_token, expires: Date.now() + (Number(body.expires_in) - 60) * 1000 };
  return cachedToken.value;
}

async function darajaPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = (await res.json()) as T & { errorMessage?: string };
  if (!res.ok) throw new Error(`Daraja ${path} failed: ${body.errorMessage ?? res.status}`);
  return body;
}

const timestamp = () => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const mockId = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const mockReceipt = () => 'S' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 9);

export async function stkPush(params: { phone: string; amountKes: number; reference: string }): Promise<{ checkoutRequestId: string }> {
  if (config.MPESA_MODE === 'mock') {
    const checkoutRequestId = mockId('ws_CO');
    setTimeout(() => {
      void handlers?.stk({ checkoutRequestId, success: true, receipt: mockReceipt(), amountKes: params.amountKes });
    }, 3000);
    return { checkoutRequestId };
  }
  const ts = timestamp();
  const password = Buffer.from(`${config.MPESA_SHORTCODE}${config.MPESA_PASSKEY}${ts}`).toString('base64');
  const body = await darajaPost<{ CheckoutRequestID: string; ResponseCode: string; ResponseDescription: string }>(
    '/mpesa/stkpush/v1/processrequest',
    {
      BusinessShortCode: config.MPESA_SHORTCODE,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: params.amountKes,
      PartyA: params.phone,
      PartyB: config.MPESA_SHORTCODE,
      PhoneNumber: params.phone,
      CallBackURL: callbackUrl('stk'),
      AccountReference: 'EmpireBet',
      TransactionDesc: params.reference
    }
  );
  if (body.ResponseCode !== '0') throw new Error(body.ResponseDescription);
  return { checkoutRequestId: body.CheckoutRequestID };
}

export async function b2cPayout(params: { phone: string; amountKes: number; reference: string }): Promise<{ conversationId: string }> {
  if (config.MPESA_MODE === 'mock') {
    const conversationId = mockId('AG');
    setTimeout(() => {
      void handlers?.b2c({ conversationId, success: true, receipt: mockReceipt() });
    }, 3000);
    return { conversationId };
  }
  const body = await darajaPost<{ ConversationID: string; ResponseCode: string; ResponseDescription: string }>(
    '/mpesa/b2c/v1/paymentrequest',
    {
      InitiatorName: config.MPESA_B2C_INITIATOR,
      SecurityCredential: config.MPESA_B2C_SECURITY_CREDENTIAL,
      CommandID: 'BusinessPayment',
      Amount: params.amountKes,
      PartyA: config.MPESA_B2C_SHORTCODE,
      PartyB: params.phone,
      Remarks: 'Empire Bet withdrawal',
      QueueTimeOutURL: callbackUrl('b2c-timeout'),
      ResultURL: callbackUrl('b2c-result'),
      Occasion: params.reference
    }
  );
  if (body.ResponseCode !== '0') throw new Error(body.ResponseDescription);
  return { conversationId: body.ConversationID };
}

// ---- Parsers for Daraja callback bodies ----

export function parseStkCallback(body: any): StkResult | null {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return null;
  const items: { Name: string; Value?: string | number }[] = cb.CallbackMetadata?.Item ?? [];
  const get = (n: string) => items.find((i) => i.Name === n)?.Value;
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    success: Number(cb.ResultCode) === 0,
    receipt: get('MpesaReceiptNumber')?.toString(),
    amountKes: get('Amount') !== undefined ? Number(get('Amount')) : undefined,
    reason: cb.ResultDesc
  };
}

export function parseB2cResult(body: any): B2cResult | null {
  const r = body?.Result;
  if (!r?.ConversationID) return null;
  return { conversationId: r.ConversationID, success: Number(r.ResultCode) === 0, receipt: r.TransactionID, reason: r.ResultDesc };
}
