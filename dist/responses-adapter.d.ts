import { type ResponsesQuirks } from "@corbits/openai-responses";
import type { AdapterFactory } from "@intx/inference";
export declare const metaResponsesQuirks: ResponsesQuirks;
/**
 * `AdapterFactory` for Meta's Model API Responses endpoint, with Meta's
 * system-prompt placement and reasoning shape baked in via
 * `@corbits/openai-responses`. Per-source `quirks` are ignored: Meta's
 * config is fixed here, not host-supplied.
 */
export declare const createMetaResponsesAdapter: AdapterFactory;
