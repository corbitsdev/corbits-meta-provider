import { type BaseTokens, type TokenResponse } from "@corbits/oauth-core";
import { type FetchLike, type NowFn, type SleepFn } from "./device-flow.js";
/**
 * Tokens for a Meta Muse subscription: the shared base shape plus an
 * optional identity token carry-through. `access` is the minted Model API
 * key (`LLM|...`); `refresh` is the identity token (not renewable — a
 * 401/403 on mint means re-login).
 */
export type MetaOAuthTokens = BaseTokens & {
    idToken?: string;
};
export type MetaDeviceLoginOptions = {
    /** Injectable clock for expiry math. */
    now?: NowFn;
    /** Injectable sleep so tests skip real wall-clock waits. */
    sleep?: SleepFn;
    /** Injectable fetch for tests. */
    fetchImpl?: FetchLike;
    /** Signals the user opening the verification URL, and what to show them. */
    notify?: (event: MetaDeviceLoginEvent) => void;
};
export type MetaDeviceLoginEvent = {
    type: "device_code";
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
} | {
    type: "progress";
    message: string;
};
/**
 * Runs the full Meta device login: device authorization, poll until
 * approval, then mint a Model API key. The minted key is `access`, the
 * identity token is `refresh`, and expiry is now + 24h. Aborts with
 * `META_DEVICE_FLOW_CANCEL_MESSAGE` when `signal` aborts.
 */
export declare function metaDeviceLogin(signal: AbortSignal, opts?: MetaDeviceLoginOptions): Promise<MetaOAuthTokens>;
/**
 * Maps a raw token endpoint response onto {@link MetaOAuthTokens}, carrying
 * `id_token` through as `idToken`.
 */
export declare function metaTokensFromResponse(response: TokenResponse, now: number, previousRefresh?: string): MetaOAuthTokens;
/**
 * Refreshes a Meta credential by re-minting a Model API key from the stored
 * identity token (`refreshSecret`). The identity token itself is not
 * renewable; a 401/403 on mint throws and the caller must re-login. An
 * optional signal aborts the mint request; when it aborts, rejects with
 * `META_DEVICE_FLOW_CANCEL_MESSAGE` (same contract as
 * {@link metaDeviceLogin}). When omitted, a fresh (never aborted) signal is
 * used so callers without one keep the previous behavior.
 */
export declare function refreshMetaTokens(refreshSecret: string, now: number, fetchImpl?: FetchLike, signal?: AbortSignal): Promise<MetaOAuthTokens>;
/**
 * Optional host wrapper for the hub's background refresher. Meta's device
 * flow is self-contained (no oauth-core PKCE machinery), so the wrapper
 * exposes only `refresh` — the hub calls it with the stored identity token
 * to re-mint the Model API key. `exchange` is deliberately absent: Meta has
 * no authorization-code exchange.
 */
export declare function metaOAuthProvider(opts?: {
    fetchImpl?: FetchLike;
}): Promise<{
    refresh: (refreshSecret: string, now: number, signal?: AbortSignal) => Promise<MetaOAuthTokens>;
}>;
