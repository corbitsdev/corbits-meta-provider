// Live calls against Meta's Model API. Opt in by setting META_LIVE_API_KEY
// (a plain Meta Model API key) or META_LIVE_ACCESS_TOKEN (a Meta identity
// token to mint a key from). META_LIVE_MODEL is optional and must be one of
// META_DEFAULT_MODELS.

import { describe, expect, test } from "bun:test";
import { createDependencies, runInference } from "@intx/inference";
import type { InferenceEvent, InferenceSource } from "@intx/types/runtime";
import {
  createMetaResponsesAdapter,
  META_API_KEY_ENV,
  META_BASE_URL,
  META_DEFAULT_MODELS,
  META_PROVIDER,
  mintMetaApiKey,
} from "../src/index";

const apiKey = process.env["META_LIVE_API_KEY"] ?? "";
const accessToken = process.env["META_LIVE_ACCESS_TOKEN"] ?? "";
const model = process.env["META_LIVE_MODEL"] ?? META_DEFAULT_MODELS[0];

async function liveSecret(): Promise<string> {
  if (apiKey !== "") return apiKey;
  if (accessToken !== "") {
    const minted = await mintMetaApiKey(
      accessToken,
      new AbortController().signal,
    );
    return minted.apiKey;
  }
  throw new Error(
    `set ${META_API_KEY_ENV} or META_LIVE_ACCESS_TOKEN to run the live suite`,
  );
}

const deps = createDependencies({
  has: (provider) => provider === META_PROVIDER,
  resolve: createMetaResponsesAdapter,
});

describe.skipIf(apiKey === "" && accessToken === "")(
  "live Meta Model API",
  () => {
    test("streams a text turn", async () => {
      const secret = await liveSecret();
      const source: InferenceSource = {
        id: `meta:${model}`,
        provider: META_PROVIDER,
        baseURL: META_BASE_URL,
        credentialId: "meta",
        model,
      };
      let seq = 0;
      const events: InferenceEvent[] = [];
      for await (const ev of runInference({
        turns: [
          {
            role: "user",
            timestamp: 0,
            content: [{ type: "text", text: "Reply with the word pong." }],
          },
        ],
        source,
        inferenceOptions: {
          providerOptions: { metaReasoningEffort: "low" },
        },
        nextSeq: () => seq++,
        readMaterial: () => ({ secret }),
        deps,
      }))
        events.push(ev);
      const done = events.find((e) => e.type === "inference.done");
      if (done?.type !== "inference.done")
        throw new Error(
          `expected inference.done, got ${JSON.stringify(events)}`,
        );
      const text = done.data.turn.content.find((b) => b.type === "text");
      expect(text?.type === "text" && text.text.toLowerCase()).toContain(
        "pong",
      );
    }, 60_000);
  },
);
