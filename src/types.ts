/** The channel a code was routed over. The backend decides — you always call one endpoint. */
export type OtpChannel = 'whatsapp' | 'telegram';

/** Lifecycle status of an OTP request. `expired` is derived once the code's TTL passes. */
export type OtpStatus = 'sent' | 'delivered' | 'read' | 'verified' | 'failed' | 'expired';

/** Billing tier. `ppsa` = pay per successful auth; `per_message` = charged at send time. */
export type ClientTier = 'ppsa' | 'per_message';

export interface SendResult {
  /** Opaque id for this request — pass to `otp.status()`. */
  messageId: string;
  /** Usually `'sent'`. */
  status: string;
  /** Seconds until the code expires. */
  expiresIn: number;
}

export interface VerifyResult {
  verified: boolean;
  /** Present only on a wrong-code attempt — tries left before a temporary block. */
  attemptsRemaining?: number;
}

export interface DeliverResult {
  messageId: string;
  status: string;
}

export interface StatusResult {
  status: OtpStatus;
  channel: OtpChannel;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/** The authenticated account (`me()`). */
export interface Account {
  email: string;
  /** The publishable `pk_` key (safe for client-side identification). */
  publishableKey: string;
  tier: ClientTier;
  wabaConnected: boolean;
  /** Current credit balance, in USD. */
  creditBalance: number;
}

export interface AuthevoOptions {
  /** Your secret key (`sk_…`). A **test-mode** key runs the sandbox: no message is sent,
   *  nothing is charged, and the verification code is always `123456`. */
  apiKey: string;
  /** Override the API base URL. Defaults to `https://api.authevo.dev`. */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to 30000. */
  timeoutMs?: number;
  /** Inject a custom `fetch` (e.g. for testing or a proxy). Defaults to the global fetch. */
  fetch?: typeof fetch;
}
