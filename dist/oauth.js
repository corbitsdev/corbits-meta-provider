import { baseTokensFromResponse, } from "@corbits/oauth-core";
import { META_DEVICE_FLOW_CANCEL_MESSAGE, mintMetaApiKey, pollMetaDeviceToken, startMetaDeviceAuthorization, } from "./device-flow.js";
import { META_API_KEY_LIFETIME_MS } from "./constants.js";
/**
 * Runs the full Meta device login: device authorization, poll until
 * approval, then mint a Model API key. The minted key is `access`, the
 * identity token is `refresh`, and expiry is now + 24h. Aborts with
 * `META_DEVICE_FLOW_CANCEL_MESSAGE` when `signal` aborts.
 */
export async function metaDeviceLogin(signal, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const now = opts.now ?? Date.now;
    try {
        const device = await startMetaDeviceAuthorization(signal, fetchImpl);
        opts.notify?.({
            type: "device_code",
            userCode: device.userCode,
            verificationUri: device.verificationUri,
            ...(device.intervalSeconds !== undefined
                ? { intervalSeconds: device.intervalSeconds }
                : {}),
            ...(device.expiresInSeconds !== undefined
                ? { expiresInSeconds: device.expiresInSeconds }
                : {}),
        });
        const identityToken = await pollMetaDeviceToken(device, signal, fetchImpl, {
            now,
            ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
        });
        opts.notify?.({
            type: "progress",
            message: "Enabling Meta Model API access...",
        });
        const minted = await mintMetaApiKey(identityToken, signal, fetchImpl, {
            now,
        });
        // Normalize the minted credential into the standard BaseTokens /
        // oauth_token shape: access = minted key, refresh = identity token,
        // expires = now + 24h.
        return metaTokensFromResponse({
            access_token: minted.apiKey,
            refresh_token: identityToken,
            expires_in: META_API_KEY_LIFETIME_MS / 1000,
        }, now());
    }
    catch (err) {
        // An in-flight fetch rejects with a DOMException on abort; the login UI
        // matches on this message.
        if (signal.aborted) {
            throw new Error(META_DEVICE_FLOW_CANCEL_MESSAGE, { cause: err });
        }
        throw err;
    }
}
/**
 * Maps a raw token endpoint response onto {@link MetaOAuthTokens}, carrying
 * `id_token` through as `idToken`.
 */
export function metaTokensFromResponse(response, now, previousRefresh) {
    const base = baseTokensFromResponse(response, now, previousRefresh);
    return {
        ...base,
        ...(response.id_token !== undefined ? { idToken: response.id_token } : {}),
    };
}
/**
 * Refreshes a Meta credential by re-minting a Model API key from the stored
 * identity token (`refreshSecret`). The identity token itself is not
 * renewable; a 401/403 on mint throws and the caller must re-login. An
 * optional signal aborts the mint request; when it aborts, rejects with
 * `META_DEVICE_FLOW_CANCEL_MESSAGE` (same contract as
 * {@link metaDeviceLogin}). When omitted, a fresh (never aborted) signal is
 * used so callers without one keep the previous behavior.
 */
export async function refreshMetaTokens(refreshSecret, now, fetchImpl = fetch, signal) {
    try {
        const minted = await mintMetaApiKey(refreshSecret, signal ?? new AbortController().signal, fetchImpl, { now: () => now });
        return metaTokensFromResponse({
            access_token: minted.apiKey,
            refresh_token: refreshSecret,
            expires_in: META_API_KEY_LIFETIME_MS / 1000,
        }, now, refreshSecret);
    }
    catch (err) {
        // An in-flight mint fetch rejects with a DOMException on abort; the
        // login UI matches on this message. When no signal is passed, aborts
        // cannot occur and this branch is unreachable.
        if (signal?.aborted) {
            throw new Error(META_DEVICE_FLOW_CANCEL_MESSAGE, { cause: err });
        }
        throw err;
    }
}
/**
 * Optional host wrapper for the hub's background refresher. Meta's device
 * flow is self-contained (no oauth-core PKCE machinery), so the wrapper
 * exposes only `refresh` — the hub calls it with the stored identity token
 * to re-mint the Model API key. `exchange` is deliberately absent: Meta has
 * no authorization-code exchange.
 */
export async function metaOAuthProvider(opts = {}) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    return {
        refresh: (refreshSecret, now, signal) => refreshMetaTokens(refreshSecret, now, fetchImpl, signal),
    };
}
