export declare const META_DEVICE_FLOW_CANCEL_MESSAGE = "Login cancelled";
/** A device authorization issued by Meta's RFC 8628 endpoint. */
export type MetaDeviceAuthorization = {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    /**
     * The authorize response's `expires_in` (RFC 8628 device-code lifetime).
     * Surfaced for polling deadlines; it intentionally does NOT bound the
     * minted Model API key's lifetime (that is `META_API_KEY_LIFETIME_MS`,
     * a client-side policy — see {@link mintMetaApiKey}).
     */
    expiresInSeconds?: number;
};
/** Injectable clock so tests control the expiry baseline. */
export type NowFn = () => number;
/** Injectable sleep so tests skip real wall-clock waits. */
export type SleepFn = (ms: number, signal: AbortSignal) => Promise<void>;
/** FetchLike mirrors `fetch`'s callable shape without importing it. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
/**
 * Starts an RFC 8628 device authorization against Meta. Returns the device
 * code, user code, and the trusted http(s) verification URI the user must
 * open. Aborts with `META_DEVICE_FLOW_CANCEL_MESSAGE` when `signal` aborts.
 */
export declare function startMetaDeviceAuthorization(signal: AbortSignal, fetchImpl?: FetchLike): Promise<MetaDeviceAuthorization>;
export type DeviceTokenPollResult = {
    status: "pending";
} | {
    status: "slow_down";
    intervalSeconds?: number;
} | {
    status: "failed";
    message: string;
} | {
    status: "complete";
    value: string;
};
export type PollMetaDeviceTokenOptions = {
    now?: NowFn;
    sleep?: SleepFn;
};
/**
 * Polls Meta's device token endpoint until the user approves. Returns the
 * identity token (`access_token`), which is NOT usable for inference — it
 * must be exchanged for a Model API key via {@link mintMetaApiKey}. Handles
 * `authorization_pending`, `slow_down`, `access_denied`, and `expired_token`.
 * Aborts with `META_DEVICE_FLOW_CANCEL_MESSAGE` when `signal` aborts at any
 * point during polling — during the initial wait, a poll interval sleep, or
 * an in-flight token-poll request.
 */
export declare function pollMetaDeviceToken(device: MetaDeviceAuthorization, signal: AbortSignal, fetchImpl?: FetchLike, opts?: PollMetaDeviceTokenOptions): Promise<string>;
export type MintMetaApiKeyResult = {
    apiKey: string;
    expiresAt: number;
};
export type MintMetaApiKeyOptions = {
    now?: NowFn;
};
/**
 * Exchanges a Meta identity token for a short-lived Model API key
 * (`LLM|...`), valid about a day. 401/403 means the identity token is dead
 * and the session must be restarted with a fresh device login.
 */
export declare function mintMetaApiKey(identityToken: string, signal: AbortSignal, fetchImpl?: FetchLike, opts?: MintMetaApiKeyOptions): Promise<MintMetaApiKeyResult>;
