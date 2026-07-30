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

export interface TotpEnrollResult {
  /** Base32 shared secret — show it as a manual-entry fallback alongside the QR. */
  secret: string;
  /** The `otpauth://` URI the QR code encodes. */
  otpauthUrl: string;
  /** A ready-to-display QR code as a PNG data URI — `<img src={qrCode}>`, no QR library needed. */
  qrCode: string;
  /** `true` when a CONFIRMED enrollment already existed for this phone before this call
   *  (a re-enroll requires passing `replace: true`, or the server responds 409). */
  alreadyEnrolled: boolean;
}

export interface TotpVerifyResult {
  verified: boolean;
  /** Present only on a wrong-code attempt — tries left before a temporary block. */
  attemptsRemaining?: number;
  /** `true` only on the exact call that confirms a brand-new enrollment (no "send"
   *  step for TOTP, so this is the one-time "setup just completed" signal). Absent
   *  on every other verify, and absent entirely in test mode. */
  firstConfirm?: boolean;
}

export interface TotpDisableResult {
  disabled: boolean;
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
  /** Your secret key (`sk_…`). A **test-mode** key runs the sandbox for BOTH auth
   *  methods, but differently: `otp.*` never sends a message, charges nothing, and
   *  the code is always `123456`; `totp.*` never touches the database or bills
   *  either, but `enroll` always returns the SAME fixed, public demo secret and
   *  `verify` checks a REAL rotating code against it (not a static string) — add
   *  the returned secret to any authenticator app to get a genuinely valid code. */
  apiKey: string;
  /** Override the API base URL. Defaults to `https://api.authevo.dev`. */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to 30000. */
  timeoutMs?: number;
  /** Inject a custom `fetch` (e.g. for testing or a proxy). Defaults to the global fetch. */
  fetch?: typeof fetch;
}
