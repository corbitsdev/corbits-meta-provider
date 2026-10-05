import { describe, expect, test } from "bun:test";
import {
  META_DEVICE_FLOW_CANCEL_MESSAGE,
  metaDeviceLogin,
  metaOAuthProvider,
  mintMetaApiKey,
  pollMetaDeviceToken,
  refreshMetaTokens,
  startMetaDeviceAuthorization,
} from "./index.js";

const CLIENT_ID = "1031625952748946";
const DEVICE_AUTHORIZATION_URL =
  "https://auth.meta.com/oidc/device/authorization/";
const DEVICE_TOKEN_URL = "https://auth.meta.com/oidc/device/token/";
const MINT_URL = "https://api.meta.ai/muse-code/key";
const DAY_MS = 24 * 60 * 60 * 1000;

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const noopSleep = (): Promise<void> => Promise.resolve();

describe("Meta device flow", () => {
  test("logs in with the device flow and mints a Model API key", async () => {
    const startTime = Date.parse("2026-09-03T00:00:00Z");
    let now = startTime;
    const pollResponses = [
      jsonResponse({ error: "authorization_pending" }, 400),
      jsonResponse({ access_token: "identity-token", token_type: "Bearer" }),
    ];
    const events: Array<Record<string, unknown>> = [];

    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = getUrl(input);
      if (url === DEVICE_AUTHORIZATION_URL) {
        expect(init?.method).toBe("POST");
        expect(new URLSearchParams(String(init?.body)).get("client_id")).toBe(
          CLIENT_ID,
        );
        return jsonResponse({
          device_code: "device-code-123",
          user_code: "ABCD-1234",
          verification_uri: "https://auth.meta.com/oauth/device/",
          verification_uri_complete:
            "https://auth.meta.com/oauth/device/?code=ABCD-1234",
          interval: 5,
          expires_in: 600,
        });
      }
      if (url === DEVICE_TOKEN_URL) {
        const params = new URLSearchParams(String(init?.body));
        expect(params.get("grant_type")).toBe(
          "urn:ietf:params:oauth:grant-type:device_code",
        );
        expect(params.get("client_id")).toBe(CLIENT_ID);
        expect(params.get("device_code")).toBe("device-code-123");
        const response = pollResponses.shift();
        if (!response) throw new Error("Unexpected extra token poll");
        return response;
      }
      if (url === MINT_URL) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer identity-token",
        });
        expect(init?.headers).toMatchObject({ "x-api-version": "1.0.0" });
        expect(init?.body).toBe("{}");
        return jsonResponse({ api_key: "LLM|minted-key" });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    // Polls happen at simulated times: the first poll is after the initial
    // wait, the second after the interval elapses.
    const tokens = await metaDeviceLogin(new AbortController().signal, {
      fetchImpl,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      notify: (event) => events.push({ ...event }),
    });

    expect(events[0]).toEqual({
      type: "device_code",
      userCode: "ABCD-1234",
      verificationUri: "https://auth.meta.com/oauth/device/?code=ABCD-1234",
      intervalSeconds: 5,
      expiresInSeconds: 600,
    });
    expect(events[1]).toEqual({
      type: "progress",
      message: "Enabling Meta Model API access...",
    });
    expect(tokens).toEqual({
      access: "LLM|minted-key",
      refresh: "identity-token",
      expiresAt: startTime + 10000 + DAY_MS,
    });
  });

  test("startMetaDeviceAuthorization prefers verification_uri_complete", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({
        device_code: "d",
        user_code: "U",
        verification_uri: "https://auth.meta.com/oauth/device/",
        verification_uri_complete:
          "https://auth.meta.com/oauth/device/?code=ABCD",
      });
    const device = await startMetaDeviceAuthorization(
      new AbortController().signal,
      fetchImpl,
    );
    expect(device.verificationUri).toBe(
      "https://auth.meta.com/oauth/device/?code=ABCD",
    );
  });

  test("rejects a non-http(s) verification_uri", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({
        device_code: "d",
        user_code: "U",
        verification_uri: "javascript:alert(1)",
      });
    await expect(
      startMetaDeviceAuthorization(new AbortController().signal, fetchImpl),
    ).rejects.toThrow("missing trusted verification_uri");
  });

  test("rejects a malformed device authorization payload", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ device_code: 42, user_code: "U" });
    await expect(
      startMetaDeviceAuthorization(new AbortController().signal, fetchImpl),
    ).rejects.toThrow("Invalid Meta device authorization response");
  });

  test("rejects a device authorization payload with extra keys", async () => {
    // Unknown keys are rejected: a renamed `device_code` must fail loudly
    // rather than be silently treated as absent.
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({
        device_code: "d",
        user_code: "U",
        verification_uri: "https://auth.meta.com/oauth/device/",
        deviceCode: "renamed",
      });
    await expect(
      startMetaDeviceAuthorization(new AbortController().signal, fetchImpl),
    ).rejects.toThrow("Invalid Meta device authorization response");
  });

  test("handles access_denied during polling", async () => {
    let calls = 0;
    const fetchImpl = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      const url = getUrl(input);
      if (url === DEVICE_AUTHORIZATION_URL) {
        return jsonResponse({
          device_code: "d",
          user_code: "U",
          verification_uri: "https://auth.meta.com/oauth/device/",
        });
      }
      if (url === DEVICE_TOKEN_URL) {
        calls += 1;
        return jsonResponse({ error: "access_denied" }, 400);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    await expect(
      metaDeviceLogin(new AbortController().signal, {
        fetchImpl,
        sleep: noopSleep,
      }),
    ).rejects.toThrow("Meta login was denied.");
    expect(calls).toBe(1);
  });

  test("handles expired_token during polling", async () => {
    const fetchImpl = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      const url = getUrl(input);
      if (url === DEVICE_AUTHORIZATION_URL) {
        return jsonResponse({
          device_code: "d",
          user_code: "U",
          verification_uri: "https://auth.meta.com/oauth/device/",
        });
      }
      if (url === DEVICE_TOKEN_URL) {
        return jsonResponse({ error: "expired_token" }, 400);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    await expect(
      metaDeviceLogin(new AbortController().signal, {
        fetchImpl,
        sleep: noopSleep,
      }),
    ).rejects.toThrow(
      "Meta device authorization expired. Please restart login.",
    );
  });

  test("slow_down increases the poll interval and completes", async () => {
    let now = 0;
    const pollResponses = [
      jsonResponse({ error: "slow_down", interval: 1 }, 400),
      jsonResponse({ access_token: "identity-token" }),
    ];
    const fetchImpl = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      const url = getUrl(input);
      if (url === DEVICE_AUTHORIZATION_URL) {
        return jsonResponse({
          device_code: "d",
          user_code: "U",
          verification_uri: "https://auth.meta.com/oauth/device/",
          interval: 1,
          expires_in: 60,
        });
      }
      if (url === DEVICE_TOKEN_URL) {
        const response = pollResponses.shift();
        if (!response) throw new Error("Unexpected extra token poll");
        return response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    const identity = await import("./index.js").then((m) =>
      m.pollMetaDeviceToken(
        {
          deviceCode: "d",
          userCode: "U",
          verificationUri: "https://auth.meta.com/oauth/device/",
          intervalSeconds: 1,
          expiresInSeconds: 60,
        },
        new AbortController().signal,
        fetchImpl,
        {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        },
      ),
    );
    expect(identity).toBe("identity-token");
    // First poll after initial 1s wait; server's interval=1 stays 1s.
    expect(now).toBeGreaterThanOrEqual(2_000);
  });

  test("aborts with 'Login cancelled' when the signal aborts during polling", async () => {
    const controller = new AbortController();
    const fetchImpl = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      const url = getUrl(input);
      if (url === DEVICE_AUTHORIZATION_URL) {
        return jsonResponse({
          device_code: "d",
          user_code: "U",
          verification_uri: "https://auth.meta.com/oauth/device/",
        });
      }
      if (url === DEVICE_TOKEN_URL) {
        // Abort while a poll is in flight.
        controller.abort();
        throw new Error("fetch aborted");
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    await expect(
      metaDeviceLogin(controller.signal, { fetchImpl, sleep: noopSleep }),
    ).rejects.toThrow(META_DEVICE_FLOW_CANCEL_MESSAGE);
  });

  test("startMetaDeviceAuthorization normalizes an in-flight authorize abort", async () => {
    const controller = new AbortController();
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        // Reject like a real in-flight fetch when the request's signal aborts.
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("fetch aborted")),
          { once: true },
        );
      });
    const promise = startMetaDeviceAuthorization(controller.signal, fetchImpl);
    controller.abort();
    await expect(promise).rejects.toThrow(META_DEVICE_FLOW_CANCEL_MESSAGE);
  });

  test("pollMetaDeviceToken normalizes an in-flight token-poll abort", async () => {
    const controller = new AbortController();
    let markFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      markFetchStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        // Reject like a real in-flight fetch when the request's signal aborts.
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("fetch aborted")),
          { once: true },
        );
      });
    };
    const promise = pollMetaDeviceToken(
      {
        deviceCode: "d",
        userCode: "U",
        verificationUri: "https://auth.meta.com/oauth/device/",
        intervalSeconds: 1,
        expiresInSeconds: 60,
      },
      controller.signal,
      fetchImpl,
      { now: () => 0, sleep: noopSleep },
    );
    // Wait until the poll fetch is actually in flight, then abort so the
    // abort lands during the fetch (not during the initial wait).
    await fetchStarted;
    controller.abort();
    await expect(promise).rejects.toThrow(META_DEVICE_FLOW_CANCEL_MESSAGE);
  });

  test("polling reaches expires_in with no approval and throws the timeout message", async () => {
    let now = 0;
    const fetchImpl = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      const url = getUrl(input);
      if (url === DEVICE_TOKEN_URL) {
        return jsonResponse({ error: "authorization_pending" }, 400);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    await expect(
      pollMetaDeviceToken(
        {
          deviceCode: "d",
          userCode: "U",
          verificationUri: "https://auth.meta.com/oauth/device/",
          intervalSeconds: 1,
          expiresInSeconds: 2,
        },
        new AbortController().signal,
        fetchImpl,
        {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        },
      ),
    ).rejects.toThrow("Device flow timed out");
  });

  test("polling past expires_in after slow_down throws the slow-down timeout message", async () => {
    let now = 0;
    const pollResponses = [
      jsonResponse({ error: "slow_down", interval: 1 }, 400),
      jsonResponse({ error: "authorization_pending" }, 400),
    ];
    const fetchImpl = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      const url = getUrl(input);
      if (url === DEVICE_TOKEN_URL) {
        const response = pollResponses.shift();
        if (!response) throw new Error("Unexpected extra token poll");
        return response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    await expect(
      pollMetaDeviceToken(
        {
          deviceCode: "d",
          userCode: "U",
          verificationUri: "https://auth.meta.com/oauth/device/",
          intervalSeconds: 1,
          expiresInSeconds: 3,
        },
        new AbortController().signal,
        fetchImpl,
        {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        },
      ),
    ).rejects.toThrow(
      "Device flow timed out after one or more slow_down responses",
    );
  });

  test("rejects a malformed token-poll payload", async () => {
    const fetchImpl = async (
      input: string | URL | Request,
    ): Promise<Response> => {
      const url = getUrl(input);
      if (url === DEVICE_TOKEN_URL) {
        return jsonResponse({ access_token: 42 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    await expect(
      pollMetaDeviceToken(
        {
          deviceCode: "d",
          userCode: "U",
          verificationUri: "https://auth.meta.com/oauth/device/",
        },
        new AbortController().signal,
        fetchImpl,
        { sleep: noopSleep },
      ),
    ).rejects.toThrow("Invalid Meta device token response");
  });

  test("re-mints the API key from the stored identity token on refresh", async () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(getUrl(input)).toBe(MINT_URL);
      expect(init?.headers).toMatchObject({
        authorization: "Bearer identity-token",
      });
      return jsonResponse({ api_key: "LLM|fresh-key" });
    };
    const tokens = await refreshMetaTokens("identity-token", now, fetchImpl);
    expect(tokens).toEqual({
      access: "LLM|fresh-key",
      refresh: "identity-token",
      expiresAt: now + DAY_MS,
    });
  });

  test("reports the setup URL when Meta issues no key", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({
        require_payment: true,
        action_url: "https://dev.meta.ai/billing",
      });
    await expect(
      mintMetaApiKey("identity-token", new AbortController().signal, fetchImpl),
    ).rejects.toThrow("Complete setup at https://dev.meta.ai/billing");
  });

  test("accepts a nullable action_url on a successful mint (live backend quirk)", async () => {
    // Meta's mint endpoint returns `action_url: null` on the happy path; the
    // schema must accept null rather than rejecting the whole response.
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ api_key: "LLM|minted-key", action_url: null });
    const minted = await mintMetaApiKey(
      "identity-token",
      new AbortController().signal,
      fetchImpl,
    );
    expect(minted).toEqual({
      apiKey: "LLM|minted-key",
      expiresAt: expect.any(Number),
    });
  });

  test("mint with no key and a null action_url still reports no setup step", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ action_url: null });
    await expect(
      mintMetaApiKey("identity-token", new AbortController().signal, fetchImpl),
    ).rejects.toThrow("Meta did not issue an API key.");
  });

  test("401 on mint surfaces re-login", async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ error: "invalid_token" }, 401);
    await expect(
      refreshMetaTokens("dead-token", Date.now(), fetchImpl),
    ).rejects.toThrow("Meta session expired (status 401)");
  });

  test("the minted key is the usable access credential (toAuth equivalent)", async () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    const tokens = await refreshMetaTokens("identity-token", now, async () =>
      jsonResponse({ api_key: "LLM|minted-key" }),
    );
    expect(tokens.access).toBe("LLM|minted-key");
    expect(tokens.refresh).toBe("identity-token");
  });

  test("metaOAuthProvider exposes a refresh the hub can drive", async () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    const provider = await metaOAuthProvider({
      fetchImpl: async () => jsonResponse({ api_key: "LLM|hub-key" }),
    });
    const tokens = await provider.refresh("identity-token", now);
    expect(tokens.access).toBe("LLM|hub-key");
    expect(tokens.expiresAt).toBe(now + DAY_MS);
  });

  test("metaOAuthProvider refresh forwards the abort signal to the mint", async () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    const controller = new AbortController();
    let mintInit: RequestInit | undefined;
    const provider = await metaOAuthProvider({
      fetchImpl: async (_input, init) => {
        mintInit = init;
        return new Promise<Response>((_resolve, reject) => {
          // Reject like a real in-flight fetch when the mint's signal aborts.
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("fetch aborted")),
            { once: true },
          );
        });
      },
    });
    const mintPromise = provider.refresh(
      "identity-token",
      now,
      controller.signal,
    );
    expect(mintInit?.signal).toBeDefined();
    // The mint must observe the caller's abort (not a fresh controller's).
    controller.abort();
    await expect(mintPromise).rejects.toThrow(META_DEVICE_FLOW_CANCEL_MESSAGE);
  });
});
