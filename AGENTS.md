# AGENTS.md

## Purpose

`@corbits/meta-provider` gives an Interchange host Meta (Muse Spark)'s two
auth paths — a plain `META_API_KEY` bearer credential and the RFC 8628 device
flow that mints a short-lived Model API key — plus a Responses-protocol
adapter configured for Meta's Model API. It composes `@corbits/oauth-core`
and `@corbits/openai-responses` rather than reimplementing OAuth or the
Responses wire protocol.

## Layout

- `src/constants.ts` — endpoints, client id, headers, model catalog, timeouts.
- `src/device-flow.ts` — RFC 8628 device authorization + token polling + API key mint (ported from pi, injectable fetch/time/sleep).
- `src/oauth.ts` — device-login orchestration, token-response mapping (`idToken` carry-through), refresh (re-mint).
- `src/responses-adapter.ts` — `metaResponsesQuirks` and `createMetaResponsesAdapter`, Meta's config for `@corbits/openai-responses`.
- `src/index.ts` — the public surface; nothing else is imported by consumers.
- `src/*.test.ts` — unit tests, excluded from the build.
- `e2e/live.test.ts` — the opt-in live suite (`META_LIVE_API_KEY` / `META_LIVE_ACCESS_TOKEN`).

## Rules

- Consume `@intx/*` (`^0.4.0`) and the two `@corbits/*` packages (`^0.2.0`) as peer dependencies, pinned exactly in `devDependencies` — never vendor or fork them.
- Parse every trust boundary with arktype; never `as T` untrusted input.
- `exactOptionalPropertyTypes` is on: omit optional keys, never assign `undefined` to them.
- No product strings baked in; the Meta wire headers (client id, `x-api-version` on mint) are Meta wire requirements, not branding.
- Tests exist only for load-bearing risk: the exact wire request shape Meta accepts, and device-flow failure/abort handling.
- Relative imports in `src/` carry explicit `.js` suffixes so the emitted ESM runs under Node; never add a build-time rewrite script or a bundler.
- Time, randomness, and `fetch` stay injectable so callers can test without patching globals.
- No `@ai-sdk/*`. No PKCE loopback: Meta is device-flow only.

## Local development

```sh
bun install && bun run check
```

To work against an unpushed local checkout of `@corbits/oauth-core` or
`@corbits/openai-responses`, `bun link` it here; never commit a lockfile
written against the link.
