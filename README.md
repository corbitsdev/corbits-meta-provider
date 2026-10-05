# @corbits/meta-provider

Meta (Muse Spark) for `@intx/inference`: the RFC 8628 device flow that mints a short-lived Model API key, the token mapping for `@corbits/oauth-core`, and a Responses API adapter for Meta's Model API built on `@corbits/openai-responses`. An inference provider for Corbits and Interchange agents that also works in any host that runs `@intx/inference`.

## Why @corbits/meta-provider?

1. **Two real Meta auth paths, one package.** Plain `META_API_KEY` bearer credentials work directly against `https://api.meta.ai/v1`. Meta Muse subscriptions authenticate with the RFC 8628 device flow: the user authorizes on a device URL, the provider polls, then exchanges the resulting identity token at the Model API key-mint endpoint for a short-lived `LLM|...` key (~24h).
2. **The exact request Meta accepts.** The system prompt rides as a leading `developer` message with parts-shaped content, reasoning is requested at `auto` summary depth with effort forwarded from the `metaReasoningEffort` option, and `response_format` is never sent (Meta uses `text.format`).
3. **Refresh is a re-mint.** The identity token is stored as the credential's `refresh` and the minted key as `access`; the hub's standard refresher re-mints the key when it expires. The identity token itself is not renewable — a 401/403 on mint means the session is dead and the user must sign in again.

## Install

```bash
bun add @corbits/meta-provider @corbits/oauth-core@^0.2.0 @corbits/openai-responses@^0.2.0 @intx/inference@^0.4.0 @intx/types@^0.4.0
```

Runs on Bun >= 1.2 or Node >= 24.

## Quickstart: API key (`META_API_KEY`)

Needs `META_API_KEY` set to a Meta Model API key (the Muse Code convention).

```ts
import { createDependencies, runInference } from "@intx/inference";
import {
  createMetaResponsesAdapter,
  META_API_KEY_ENV,
  META_BASE_URL,
  META_DEFAULT_MODELS,
  META_PROVIDER,
} from "@corbits/meta-provider";

const apiKey = process.env[META_API_KEY_ENV];
if (apiKey === undefined) throw new Error(`${META_API_KEY_ENV} is not set`);

const deps = createDependencies({
  has: (provider) => provider === META_PROVIDER,
  resolve: createMetaResponsesAdapter,
});

let seq = 0;
for await (const event of runInference({
  deps,
  source: {
    id: "meta",
    provider: META_PROVIDER,
    baseURL: META_BASE_URL,
    credentialId: "meta",
    model: META_DEFAULT_MODELS[0],
  },
  turns: [
    {
      role: "user",
      timestamp: Date.now(),
      content: [{ type: "text", text: "Say hello." }],
    },
  ],
  inferenceOptions: {
    providerOptions: { metaReasoningEffort: "low" },
  },
  nextSeq: () => seq++,
  readMaterial: () => ({ secret: apiKey }),
})) {
  if (event.type === "inference.text.delta")
    process.stdout.write(event.data.token);
  if (event.type === "inference.error")
    throw new Error(event.data.error.message);
}
process.stdout.write("\n");
```

## Quickstart: device login → mint → inference

Needs a Meta Muse subscription. Run the device login on the hub (or any
process that can show the user a URL):

```ts
import {
  metaDeviceLogin,
  META_DEVICE_FLOW_CANCEL_MESSAGE,
} from "@corbits/meta-provider";

const controller = new AbortController();
const tokens = await metaDeviceLogin(controller.signal, {
  notify: (event) => {
    if (event.type === "device_code") {
      console.log(`Open ${event.verificationUri} and enter ${event.userCode}`);
    }
  },
});
// tokens.access = "LLM|..." (the Model API key, ~24h)
// tokens.refresh = the identity token (not renewable)
// tokens.expiresAt = now + 24h
```

Store the credential in the Interchange `oauth_token` shape:

```ts
await saveCredential("meta", {
  type: "oauth",
  access: tokens.access,
  refresh: tokens.refresh,
  expires: tokens.expiresAt,
});
```

Then inference uses the minted key as the bearer against the **same**
`https://api.meta.ai/v1` — no proxy needed (unlike xAI's CLI chat proxy):

```ts
import { createDependencies, runInference } from "@intx/inference";
import {
  createMetaResponsesAdapter,
  META_BASE_URL,
  META_PROVIDER,
} from "@corbits/meta-provider";

const deps = createDependencies({
  has: (provider) => provider === META_PROVIDER,
  resolve: createMetaResponsesAdapter,
});

let seq = 0;
for await (const event of runInference({
  deps,
  source: {
    id: "meta",
    provider: META_PROVIDER,
    baseURL: META_BASE_URL,
    credentialId: "meta",
    model: "muse-spark-1.3",
  },
  turns: [
    {
      role: "user",
      timestamp: Date.now(),
      content: [{ type: "text", text: "Say hello." }],
    },
  ],
  nextSeq: () => seq++,
  readMaterial: () => ({ secret: tokens.access }),
})) {
  if (event.type === "inference.text.delta")
    process.stdout.write(event.data.token);
  if (event.type === "inference.error")
    throw new Error(event.data.error.message);
}
process.stdout.write("\n");
```

If `metaDeviceLogin` rejects with `META_DEVICE_FLOW_CANCEL_MESSAGE`
(`"Login cancelled"`), the user aborted; show it as a cancelled login.

## Where it fits

[Interchange](https://github.com/faremeter/interchange) runs AI agents as principals (accounts that hold their own identity, permissions and credentials). Corbits packages add what an agent product needs around it.

- **Runs in:** the agent sidecar (the runtime next to each agent) for inference, and the hub (the multi-tenant control plane) for login and token refresh.
- **Plugs into:** the [`@intx/inference`](https://github.com/faremeter/interchange/tree/main/packages/inference) adapter registry, as the factory for the `meta` provider id.
- **Pairs with:** [`@corbits/oauth-core`](https://github.com/corbitsdev/corbits-oauth-core) for the token shape and hub refresher, and [`@corbits/openai-responses`](https://github.com/corbitsdev/corbits-openai-responses), the wire protocol underneath.

## Hub login / refresh

Meta's device flow is self-contained in this package — it does not ride
`@corbits/oauth-core`'s PKCE loopback machinery. A host drives it directly
with `metaDeviceLogin` (login route) and `refreshMetaTokens` (background
refresher, re-mint). For hosts that key the refresher off
`OAuthLoginProviders`, `metaOAuthProvider()` supplies the `refresh` entry:

```ts
import type { OAuthLoginProviders } from "@corbits/oauth-core/hub";
import { META_PROVIDER, metaOAuthProvider } from "@corbits/meta-provider";

const meta = await metaOAuthProvider();
export const providers: OAuthLoginProviders = {
  [META_PROVIDER]: {
    refresh: (refreshSecret, now) => meta.refresh(refreshSecret, now),
  } as OAuthLoginProviders[string],
};
```

`metaDeviceLogin`'s `notify` callback is where a host surfaces the device
code / verification URL to the user (the browser flow, a CLI banner, etc.).
A 401/403 from `refreshMetaTokens` means the identity token is dead; surface
"re-login required" and start a fresh `metaDeviceLogin`.

Load the adapter in the sidecar from an operator-configured `AdapterManifest`:

```ts
import { createDependencies, type AdapterManifest } from "@intx/inference";
import { loadAdapterRegistry } from "@intx/inference/providers";

const manifest: AdapterManifest = [
  {
    provider: "meta",
    specifier: "@corbits/meta-provider",
    export: "createMetaResponsesAdapter",
  },
];
export const deps = createDependencies(await loadAdapterRegistry(manifest));
```

Each Meta source points at `META_BASE_URL` and picks a model from
`META_DEFAULT_MODELS`. Pass reasoning effort as
`providerOptions[META_REASONING_EFFORT_OPTION]` (`minimal | low | medium |
high | max`).

## Models

| Model                        | Notes                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `muse-spark-1.3` (default)   | 1,048,576 context / 131,072 output; reasoning effort incl. `max` |
| `muse-spark-1.2`             | 1,048,576 context / 131,072 output; reasoning                    |
| `muse-spark-1.1`             | 1,048,576 context / 131,072 output; reasoning                    |
| `muse-spark-1.2-contributor` | Contributor variant                                              |
| `muse-spark-1.3-contributor` | Contributor variant                                              |

## Reference

| Export                                                 | Description                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `createMetaResponsesAdapter`                           | `AdapterFactory` for Meta's Model API. Per-source `quirks` are ignored.                                                   |
| `metaResponsesQuirks`                                  | The `ResponsesQuirks` the adapter is built from.                                                                          |
| `startMetaDeviceAuthorization(signal, fetch?)`         | Starts an RFC 8628 device authorization; returns `{ deviceCode, userCode, verificationUri, ... }`.                        |
| `pollMetaDeviceToken(device, signal, fetch?, opts?)`   | Polls until approval; returns the identity token (not usable for inference).                                              |
| `mintMetaApiKey(identityToken, signal, fetch?, opts?)` | Exchanges the identity token for `{ apiKey, expiresAt }` (`LLM\|...`, ~24h).                                              |
| `metaDeviceLogin(signal, opts?)`                       | Full device login → `MetaOAuthTokens`. Aborts with `"Login cancelled"`.                                                   |
| `metaTokensFromResponse(response, now, prevRefresh?)`  | Maps a token response to `MetaOAuthTokens`, carrying `id_token` as `idToken`.                                             |
| `refreshMetaTokens(refresh, now, fetch?, signal?)`     | Re-mints a Model API key from the identity token. 401/403 → re-login. An optional signal aborts the mint request.         |
| `metaOAuthProvider(opts?)`                             | Optional host wrapper exposing the hub refresher's `refresh`, which forwards an optional AbortSignal to the mint request. |
| `MetaOAuthTokens`                                      | Type (`access` = minted key, `refresh` = identity token, `expiresAt` = now + 24h).                                        |
| `META_PROVIDER`                                        | The `"meta"` provider id.                                                                                                 |
| `META_BASE_URL`                                        | `https://api.meta.ai/v1`, the base URL for inference.                                                                     |
| `META_API_KEY_ENV`                                     | `"META_API_KEY"`.                                                                                                         |
| `META_API_KEY_MINT_URL`                                | `https://api.meta.ai/muse-code/key`.                                                                                      |
| `META_DEFAULT_MODELS`                                  | The Muse Spark model ids, `muse-spark-1.3` first (default).                                                               |
| `META_REASONING_EFFORT_OPTION`                         | `providerOptions` key sent as `reasoning.effort`.                                                                         |
| `META_DEVICE_FLOW_CANCEL_MESSAGE`                      | `"Login cancelled"` — the abort error message.                                                                            |

The endpoint / client-id constants behind the device flow
(`META_CLIENT_ID`, `META_AUTH_HOST`, `META_DEVICE_AUTHORIZATION_URL`,
`META_DEVICE_TOKEN_URL`, `META_TOKEN_TIMEOUT_MS`, `META_API_KEY_LIFETIME_MS`,
`META_RESPONSES_PATH`) are exported too.

## Env vars

| Var                      | Used by                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `META_API_KEY`           | The plain API-key quickstart; the host reads it as the bearer secret. |
| `META_LIVE_API_KEY`      | Opt-in live e2e suite (plain key).                                    |
| `META_LIVE_ACCESS_TOKEN` | Opt-in live e2e suite (identity token to mint from).                  |
| `META_LIVE_MODEL`        | Optional live-model override (default: `muse-spark-1.3`).             |

## Live e2e

```sh
META_LIVE_API_KEY=<api key> bun run test:e2e
# or, with a Muse subscription identity token:
META_LIVE_ACCESS_TOKEN=<identity token> bun run test:e2e
```

Never runs in CI by default; it is skipped unless one of the two live env
vars is set.

## License

[LGPL-2.1-only](https://github.com/corbitsdev/corbits-meta-provider/blob/main/LICENSE)
