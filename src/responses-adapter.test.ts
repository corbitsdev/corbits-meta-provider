import { BEARER_CREDENTIAL_SENTINEL } from "@intx/inference";
import type { ConversationTurn, LastCycleSource } from "@intx/types/runtime";
import { type } from "arktype";
import { describe, expect, test } from "bun:test";
import { createMetaResponsesAdapter } from "./index.js";

// Pinned literally rather than imported: the wire path is Meta's Model API
// convention, and this test's job is to guard the exact bytes Meta accepts,
// not to re-export internals to reach them.
const RESPONSES_PATH = "/responses";
const EFFORT_OPTION = "metaReasoningEffort";

const source: LastCycleSource = {
  sourceId: "test/meta",
  provider: "meta",
  model: "muse-spark-1.3",
};
const turns: ConversationTurn[] = [
  { role: "user", timestamp: 0, content: [{ type: "text", text: "hi" }] },
];

// Narrows the parsed request body to the fields this test asserts, without
// an unsafe cast: a body missing or misshaping any of them throws rather
// than silently satisfying the type.
const RequestBody = type({
  input: "unknown[]",
  reasoning: { summary: "string", "effort?": "string" },
  include: "string[]",
  store: "boolean",
  stream: "boolean",
});

// Guards the exact request shape Meta's Model API accepts: the relative
// /responses path, no x-api-version header (OQ-4: it is only required on the
// key-mint endpoint), a leading `developer`-role message with parts-shaped
// content (OQ-2), reasoning at "auto" summary depth with effort forwarded
// from the caller's metaReasoningEffort option (OQ-3), and never a
// `response_format` key (Meta uses `text.format`).
describe("createMetaResponsesAdapter", () => {
  test("produces the header set and body Meta's Model API accepts", () => {
    const adapter = createMetaResponsesAdapter(source);
    const request = adapter.buildRequest(turns, "muse-spark-1.3", {
      systemPrompt: "be helpful",
      maxTokens: 4096,
      temperature: 0.7,
      providerOptions: {
        [EFFORT_OPTION]: "high",
      },
    });

    expect(request.url).toBe(RESPONSES_PATH);
    expect(request.headers).toEqual({
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: BEARER_CREDENTIAL_SENTINEL,
    });
    expect(request.headers).not.toHaveProperty("x-api-version");

    const parsed = RequestBody(JSON.parse(request.body));
    if (parsed instanceof type.errors) throw new Error(parsed.summary);

    expect(parsed.input).toEqual([
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "be helpful" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
    ]);
    expect(parsed.reasoning).toEqual({ summary: "auto", effort: "high" });
    expect(parsed.include).toContain("reasoning.encrypted_content");
    expect(parsed.store).toBe(false);
    expect(parsed.stream).toBe(true);
    expect(parsed).not.toHaveProperty("response_format");
    expect(parsed).not.toHaveProperty("parallel_tool_calls");
  });

  test("omits reasoning.effort when the caller did not set it", () => {
    const adapter = createMetaResponsesAdapter(source);
    const request = adapter.buildRequest(turns, "muse-spark-1.3", {});
    const parsed = RequestBody(JSON.parse(request.body));
    if (parsed instanceof type.errors) throw new Error(parsed.summary);
    expect(parsed.reasoning).toEqual({ summary: "auto" });
  });
});
