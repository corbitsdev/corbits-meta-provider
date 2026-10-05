/** The provider id Meta's Responses adapter registers under. */
export const META_PROVIDER = "meta";

// Muse Code CLI client id (pi-pinned).
export const META_CLIENT_ID = "1031625952748946";

export const META_AUTH_HOST = "https://auth.meta.com";
export const META_DEVICE_AUTHORIZATION_URL = `${META_AUTH_HOST}/oidc/device/authorization/`;
export const META_DEVICE_TOKEN_URL = `${META_AUTH_HOST}/oidc/device/token/`;

/** Exchanges a Meta identity token for a short-lived Model API key. */
export const META_API_KEY_MINT_URL = "https://api.meta.ai/muse-code/key";

/** Base URL for inference against Meta's Model API (Responses endpoint). */
export const META_BASE_URL = "https://api.meta.ai/v1";

/** Env var holding a plain Meta Model API key (`LLM|...` or equivalent). */
export const META_API_KEY_ENV = "META_API_KEY";

// Client-side expiry policy for minted Model API keys: we hard-expire at
// `now + 24h`. This is NOT a server contract — Meta guarantees only "about
// 24h" for key lifetime, and the authorize response's `expires_in` is
// intentionally not used for the minted key's lifetime (see
// `META_API_KEY_LIFETIME_MS` usage in device-flow mint).
export const META_API_KEY_LIFETIME_MS = 24 * 60 * 60 * 1000;

// Order matches an authenticated GET /v1/models from Muse Code; the first
// entry is the host default.
export const META_DEFAULT_MODELS = [
  "muse-spark-1.3",
  "muse-spark-1.2",
  "muse-spark-1.1",
  "muse-spark-1.2-contributor",
  "muse-spark-1.3-contributor",
] as const;

export const META_RESPONSES_PATH = "/responses";

// Bounds each device-flow / mint request so a stalled endpoint aborts rather
// than hanging the caller.
export const META_TOKEN_TIMEOUT_MS = 30_000;

/** `InferenceOptions.providerOptions` key carrying the reasoning effort. */
export const META_REASONING_EFFORT_OPTION = "metaReasoningEffort";
