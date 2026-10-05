/** The provider id Meta's Responses adapter registers under. */
export declare const META_PROVIDER = "meta";
export declare const META_CLIENT_ID = "1031625952748946";
export declare const META_AUTH_HOST = "https://auth.meta.com";
export declare const META_DEVICE_AUTHORIZATION_URL = "https://auth.meta.com/oidc/device/authorization/";
export declare const META_DEVICE_TOKEN_URL = "https://auth.meta.com/oidc/device/token/";
/** Exchanges a Meta identity token for a short-lived Model API key. */
export declare const META_API_KEY_MINT_URL = "https://api.meta.ai/muse-code/key";
/** Base URL for inference against Meta's Model API (Responses endpoint). */
export declare const META_BASE_URL = "https://api.meta.ai/v1";
/** Env var holding a plain Meta Model API key (`LLM|...` or equivalent). */
export declare const META_API_KEY_ENV = "META_API_KEY";
export declare const META_API_KEY_LIFETIME_MS: number;
export declare const META_DEFAULT_MODELS: readonly ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1", "muse-spark-1.2-contributor", "muse-spark-1.3-contributor"];
export declare const META_RESPONSES_PATH = "/responses";
export declare const META_TOKEN_TIMEOUT_MS = 30000;
/** `InferenceOptions.providerOptions` key carrying the reasoning effort. */
export declare const META_REASONING_EFFORT_OPTION = "metaReasoningEffort";
