import { type } from "arktype";
import {
  META_API_KEY_LIFETIME_MS,
  META_API_KEY_MINT_URL,
  META_CLIENT_ID,
  META_DEVICE_AUTHORIZATION_URL,
  META_DEVICE_TOKEN_URL,
  META_TOKEN_TIMEOUT_MS,
} from "./constants.js";

export const META_DEVICE_FLOW_CANCEL_MESSAGE = "Login cancelled";
const TIMEOUT_MESSAGE = "Device flow timed out";
const SLOW_DOWN_TIMEOUT_MESSAGE =
  "Device flow timed out after one or more slow_down responses. This is often caused by clock drift in WSL or VM environments. Please sync or restart the VM clock and try again.";
const MINIMUM_INTERVAL_MS = 1000;
// RFC 8628 section 3.2: if the authorization server omits `interval`, the client must use 5 seconds.
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
// RFC 8628 section 3.5: `slow_down` means the polling interval must increase by 5 seconds.
const SLOW_DOWN_INTERVAL_INCREMENT_MS = 5000;

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

// The device authorization endpoint's JSON payload. Unknown keys are
// rejected: a renamed `device_code` field must fail loudly rather than be
// silently treated as absent.
const DeviceAuthorizationPayload = type({
  device_code: "string > 0",
  user_code: "string > 0",
  "verification_uri?": "string",
  "verification_uri_complete?": "string",
  "interval?": "number",
  "expires_in?": "number",
  "+": "reject",
});
type DeviceAuthorizationPayload = typeof DeviceAuthorizationPayload.infer;

// The token polling endpoint's JSON payload — either an access_token on
// success or an RFC 8628 error body. Fields are permissive here: the
// success/failure branch is decided by `error` presence, and both shapes
// carry extra fields the other branch does not.
const DeviceTokenPayload = type({
  "access_token?": "string",
  "error?": "string",
  "error_description?": "string",
  "interval?": "number",
});
type DeviceTokenPayload = typeof DeviceTokenPayload.infer;

// The mint endpoint's JSON payload. `action_url` is nullable: Meta sends it
// only when a setup step is outstanding, otherwise `null` is returned. The
// error detail keys are permissive because the exact failure shape varies.
const MintPayload = type({
  "api_key?": "string",
  "action_url?": "string | null",
  "error_description?": "string",
  "detail?": "string",
  "message?": "string",
  "error?": "string",
});
type MintPayload = typeof MintPayload.infer;

/** FetchLike mirrors `fetch`'s callable shape without importing it. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function requestSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(META_TOKEN_TIMEOUT_MS), signal]);
}

async function readJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const json: unknown = await response.json();
    return json !== null && typeof json === "object"
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function errorDetail(json: Record<string, unknown> | null): string {
  for (const key of ["error_description", "detail", "message", "error"]) {
    const value = json?.[key];
    if (typeof value === "string" && value.trim()) return `: ${value.trim()}`;
  }
  return "";
}

/** The verification URI is opened in the user's browser; only http(s) URLs are trusted. */
function trustedHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * Starts an RFC 8628 device authorization against Meta. Returns the device
 * code, user code, and the trusted http(s) verification URI the user must
 * open. Aborts with `META_DEVICE_FLOW_CANCEL_MESSAGE` when `signal` aborts.
 */
export async function startMetaDeviceAuthorization(
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<MetaDeviceAuthorization> {
  let response: Response;
  try {
    response = await fetchImpl(META_DEVICE_AUTHORIZATION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ client_id: META_CLIENT_ID }).toString(),
      signal: requestSignal(signal),
    });
  } catch (err) {
    // An in-flight fetch rejects with a DOMException on abort; the login UI
    // matches on this message.
    if (signal.aborted) {
      throw new Error(META_DEVICE_FLOW_CANCEL_MESSAGE, { cause: err });
    }
    throw err;
  }
  const json = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Meta device authorization failed with status ${response.status}${errorDetail(json)}`,
    );
  }
  const parsed = DeviceAuthorizationPayload(json ?? {});
  if (parsed instanceof type.errors) {
    throw new Error(
      `Invalid Meta device authorization response: ${parsed.summary}`,
    );
  }
  const verificationUri =
    trustedHttpUrl(parsed.verification_uri_complete) ??
    trustedHttpUrl(parsed.verification_uri);
  if (verificationUri === null) {
    throw new Error(
      `Invalid Meta device authorization response: missing trusted verification_uri`,
    );
  }
  const intervalSeconds = positiveNumber(parsed.interval);
  // The authorize `expires_in` bounds only the device-code polling window;
  // it does not bound the minted Model API key's lifetime. The mint response
  // carries no explicit lifetime, so the stored credential expires at
  // now + META_API_KEY_LIFETIME_MS (see mintMetaApiKey).
  const expiresInSeconds = positiveNumber(parsed.expires_in);
  return {
    deviceCode: parsed.device_code,
    userCode: parsed.user_code,
    verificationUri,
    ...(intervalSeconds !== undefined ? { intervalSeconds } : {}),
    ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
  };
}

export type DeviceTokenPollResult =
  | { status: "pending" }
  | { status: "slow_down"; intervalSeconds?: number }
  | { status: "failed"; message: string }
  | { status: "complete"; value: string };

type DevicePollOptions = {
  intervalSeconds?: number;
  expiresInSeconds?: number;
  waitBeforeFirstPoll?: boolean;
  poll: () => Promise<DeviceTokenPollResult>;
  signal: AbortSignal;
  now: NowFn;
  sleep: SleepFn;
};

function abortableSleep(
  ms: number,
  signal: AbortSignal,
  cancelMessage: string,
  sleep: SleepFn,
): Promise<void> {
  return sleep(ms, signal).then(
    () => undefined,
    (err: unknown) => {
      if (signal.aborted) throw new Error(cancelMessage);
      throw err;
    },
  );
}

async function pollOAuthDeviceCodeFlow(
  options: DevicePollOptions,
): Promise<string> {
  const deadline =
    typeof options.expiresInSeconds === "number"
      ? options.now() + options.expiresInSeconds * 1000
      : Number.POSITIVE_INFINITY;
  let intervalMs = Math.max(
    MINIMUM_INTERVAL_MS,
    Math.floor(
      (options.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000,
    ),
  );

  let slowDownResponses = 0;
  if (options.waitBeforeFirstPoll === true) {
    const remainingMs = deadline - options.now();
    if (remainingMs > 0) {
      await abortableSleep(
        Math.min(intervalMs, remainingMs),
        options.signal,
        META_DEVICE_FLOW_CANCEL_MESSAGE,
        options.sleep,
      );
    }
  }

  while (options.now() < deadline) {
    if (options.signal.aborted) {
      throw new Error(META_DEVICE_FLOW_CANCEL_MESSAGE);
    }

    let result: DeviceTokenPollResult;
    try {
      result = await options.poll();
    } catch (err) {
      // An in-flight fetch rejects with a DOMException on abort; the login
      // UI matches on this message. This keeps the abort contract
      // deterministic regardless of whether the abort lands during sleep or
      // during the token-poll fetch.
      if (options.signal.aborted) {
        throw new Error(META_DEVICE_FLOW_CANCEL_MESSAGE, { cause: err });
      }
      throw err;
    }
    if (result.status === "complete") {
      return result.value;
    }
    if (result.status === "failed") {
      throw new Error(result.message);
    }
    if (result.status === "slow_down") {
      slowDownResponses += 1;
      // Use the server-provided interval when given; otherwise apply RFC 8628
      // section 3.5: increase by 5 seconds.
      intervalMs =
        typeof result.intervalSeconds === "number" &&
        Number.isFinite(result.intervalSeconds) &&
        result.intervalSeconds > 0
          ? Math.max(
              MINIMUM_INTERVAL_MS,
              Math.floor(result.intervalSeconds * 1000),
            )
          : Math.max(
              MINIMUM_INTERVAL_MS,
              intervalMs + SLOW_DOWN_INTERVAL_INCREMENT_MS,
            );
    }

    const remainingMs = deadline - options.now();
    if (remainingMs <= 0) {
      break;
    }

    await abortableSleep(
      Math.min(intervalMs, remainingMs),
      options.signal,
      META_DEVICE_FLOW_CANCEL_MESSAGE,
      options.sleep,
    );
  }

  throw new Error(
    slowDownResponses > 0 ? SLOW_DOWN_TIMEOUT_MESSAGE : TIMEOUT_MESSAGE,
  );
}

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
export async function pollMetaDeviceToken(
  device: MetaDeviceAuthorization,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
  opts: PollMetaDeviceTokenOptions = {},
): Promise<string> {
  const now: NowFn = opts.now ?? Date.now;
  const sleep: SleepFn =
    opts.sleep ??
    ((ms, sig) =>
      abortableSleepNative(ms, sig, META_DEVICE_FLOW_CANCEL_MESSAGE));
  return pollOAuthDeviceCodeFlow({
    ...(device.intervalSeconds !== undefined
      ? { intervalSeconds: device.intervalSeconds }
      : {}),
    ...(device.expiresInSeconds !== undefined
      ? { expiresInSeconds: device.expiresInSeconds }
      : {}),
    waitBeforeFirstPoll: true,
    signal,
    now,
    sleep,
    poll: async () => {
      const response = await fetchImpl(META_DEVICE_TOKEN_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: device.deviceCode,
          client_id: META_CLIENT_ID,
        }).toString(),
        signal: requestSignal(signal),
      });
      const json = await readJson(response);
      const parsed = DeviceTokenPayload(json ?? {});
      if (parsed instanceof type.errors) {
        return {
          status: "failed",
          message: `Invalid Meta device token response: ${parsed.summary}`,
        };
      }
      if (
        response.ok &&
        typeof parsed.access_token === "string" &&
        parsed.access_token.length > 0
      ) {
        return { status: "complete", value: parsed.access_token };
      }
      switch (parsed.error) {
        case "authorization_pending":
          return { status: "pending" };
        case "slow_down": {
          const intervalSeconds = positiveNumber(parsed.interval);
          return {
            status: "slow_down",
            ...(intervalSeconds !== undefined ? { intervalSeconds } : {}),
          };
        }
        case "access_denied":
          return { status: "failed", message: "Meta login was denied." };
        case "expired_token":
          return {
            status: "failed",
            message: "Meta device authorization expired. Please restart login.",
          };
        default:
          return {
            status: "failed",
            message: `Meta device token request failed with status ${response.status}${errorDetail(json)}`,
          };
      }
    },
  });
}

function abortableSleepNative(
  ms: number,
  signal: AbortSignal,
  cancelMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(cancelMessage));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(new Error(cancelMessage));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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
export async function mintMetaApiKey(
  identityToken: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
  opts: MintMetaApiKeyOptions = {},
): Promise<MintMetaApiKeyResult> {
  const now: NowFn = opts.now ?? Date.now;
  const response = await fetchImpl(META_API_KEY_MINT_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${identityToken}`,
      "content-type": "application/json",
      "x-api-version": "1.0.0",
    },
    body: "{}",
    signal: requestSignal(signal),
  });
  const json = await readJson(response);
  if (response.status === 401 || response.status === 403) {
    // Identity token is not renewable; only a fresh device flow helps.
    throw new Error(
      `Meta session expired (status ${response.status}). Re-run device login to sign in again.${errorDetail(json)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Meta API key mint failed with status ${response.status}${errorDetail(json)}`,
    );
  }
  const parsed = MintPayload(json ?? {});
  if (parsed instanceof type.errors) {
    throw new Error(`Invalid Meta API key mint response: ${parsed.summary}`);
  }
  if (typeof parsed.api_key !== "string" || parsed.api_key.length === 0) {
    const actionUrl = trustedHttpUrl(parsed.action_url);
    throw new Error(
      `Meta did not issue an API key.${actionUrl ? ` Complete setup at ${actionUrl}` : ""}`,
    );
  }
  return {
    apiKey: parsed.api_key,
    expiresAt: now() + META_API_KEY_LIFETIME_MS,
  };
}
