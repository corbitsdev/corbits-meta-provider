import {
  responsesAdapterFactory,
  type ResponsesQuirks,
} from "@corbits/openai-responses";
import type { AdapterFactory } from "@intx/inference";
import {
  META_REASONING_EFFORT_OPTION,
  META_RESPONSES_PATH,
} from "./constants.js";

// Meta's Model API speaks the OpenAI Responses protocol natively at
// `POST /v1/responses`. The system prompt rides as a leading `developer`
// message with parts-shaped content (Meta's quickstart is developer-style
// and accepts both roles), reasoning is requested at "auto" summary depth
// with effort forwarded from the caller's `metaReasoningEffort` option, and
// `x-api-version` is NOT sent on /v1/responses (it is only required on the
// key-mint endpoint). max_output_tokens / temperature / store /
// parallel_tool_calls stay on their protocol-native defaults (forwarded
// when the caller sets them) because Meta is OpenAI-compatible.
export const metaResponsesQuirks: ResponsesQuirks = {
  path: META_RESPONSES_PATH,
  systemPrompt: { role: "developer", shape: "parts" },
  reasoning: {
    summary: "auto",
    effortOption: META_REASONING_EFFORT_OPTION,
  },
};

/**
 * `AdapterFactory` for Meta's Model API Responses endpoint, with Meta's
 * system-prompt placement and reasoning shape baked in via
 * `@corbits/openai-responses`. Per-source `quirks` are ignored: Meta's
 * config is fixed here, not host-supplied.
 */
export const createMetaResponsesAdapter: AdapterFactory =
  responsesAdapterFactory(metaResponsesQuirks);
