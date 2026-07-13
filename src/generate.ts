import { streamText, type LanguageModelV1 } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { mistral } from "@ai-sdk/mistral";
import { groq } from "@ai-sdk/groq";
import { xai } from "@ai-sdk/xai";
import { deepseek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { MAX_DIFF_CHARS, PROVIDERS, SYSTEM_PROMPT, modelNameOf, providerOf } from "./config.js";
import {
  buildChangeSummaryPrompt,
  buildChecklistCommitPrompt,
  buildUserPrompt,
  cleanMessage,
  renderDiffChunk,
} from "./format.js";
import type { StagedDiffChunk } from "./git.js";
import type { ReleasePleaseContext } from "./releasePlease.js";

const CHANGE_SUMMARY_SYSTEM_PROMPT = `You summarize staged git diff chunks for a later commit-message writer.

Output format:
- <path or related paths>: <concise effect of the staged change>

Rules:
- cover every file in the provided diff batch
- ignore files that are not in the provided diff batch
- group files only when they clearly implement one intent
- include important behavior, API, docs, test, build, config, and release-impact details
- if the diff is truncated or binary, state the best inference from the batch path, status, and available diff
- output ONLY bullets - no heading, preamble, markdown fences, or final commit message`;

const MAX_SUMMARY_BATCH_CHARS = 50_000;
const SUMMARY_CONCURRENCY = 4;

function cloudflareBaseURL(): string {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required for Cloudflare AI Gateway");
  }
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID ?? "default";
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`;
}

function getModel(modelId: string): LanguageModelV1 {
  const provider = providerOf(modelId);
  const name = modelNameOf(modelId);
  const spec = PROVIDERS[provider];
  if (!spec) {
    throw new Error(`unknown provider "${provider}"`);
  }

  switch (provider) {
    case "openai":
      return openai(name);
    case "anthropic":
      return anthropic(name);
    case "google":
      return google(name);
    case "mistral":
      return mistral(name);
    case "groq":
      return groq(name);
    case "xai":
      return xai(name);
    case "deepseek":
      return deepseek(name);
    case "cloudflare": {
      const compat = createOpenAICompatible({
        name: "cloudflare",
        baseURL: cloudflareBaseURL(),
        apiKey: process.env.CLOUDFLARE_AI_GATEWAY_API_KEY ?? "",
      });
      return compat(name);
    }
    default: {
      if (!spec.baseURL) {
        throw new Error(
          `provider "${provider}" is OpenAI-compatible but has no baseURL configured`,
        );
      }
      const apiKey = process.env[spec.envVar];
      const compat = createOpenAICompatible({
        name: provider,
        baseURL: spec.baseURL,
        apiKey: apiKey ?? "",
      });
      return compat(name);
    }
  }
}

export interface GenerateOptions {
  modelId: string;
  diff: string;
  files: string;
  summary?: string;
  diffChunks?: readonly StagedDiffChunk[];
  /** Reuse a checklist from a previous generation instead of re-summarizing. */
  checklist?: string;
  hint?: string;
  releasePlease?: ReleasePleaseContext;
  initialCommit?: boolean;
  onChunk?: (chunk: string) => void;
  onSummaryProgress?: (done: number, total: number) => void;
}

export interface GenerateResult {
  message: string;
  /** Set when batched summarization ran; pass back in to skip it on regeneration. */
  checklist?: string;
  usage: GenerationUsage;
}

export interface GenerationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
}

function summaryBatches(chunks: readonly StagedDiffChunk[]): StagedDiffChunk[][] {
  const batches: StagedDiffChunk[][] = [];
  let batch: StagedDiffChunk[] = [];
  let batchChars = 0;

  for (const chunk of chunks) {
    const chunkChars = renderDiffChunk(chunk).length;
    if (batch.length > 0 && batchChars + chunkChars > MAX_SUMMARY_BATCH_CHARS) {
      batches.push(batch);
      batch = [];
      batchChars = 0;
    }
    batch.push(chunk);
    batchChars += chunkChars;
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}

interface StreamedText {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

async function readStreamedText(
  model: LanguageModelV1,
  system: string,
  prompt: string,
  maxTokens: number,
  onChunk?: (chunk: string) => void,
): Promise<StreamedText> {
  const result = streamText({
    model,
    system,
    prompt,
    maxTokens,
  });

  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
    onChunk?.(chunk);
  }

  // Some OpenAI-compatible endpoints report no usage; the SDK then yields NaN.
  const usage = await result.usage;
  return {
    text,
    promptTokens: Number.isFinite(usage?.promptTokens) ? usage.promptTokens : 0,
    completionTokens: Number.isFinite(usage?.completionTokens) ? usage.completionTokens : 0,
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function summarizeChanges(
  model: LanguageModelV1,
  chunks: readonly StagedDiffChunk[],
  hint: string | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<{ checklist: string; promptTokens: number; completionTokens: number; requests: number }> {
  const batches = summaryBatches(chunks);
  let done = 0;

  const results = await mapWithConcurrency(batches, SUMMARY_CONCURRENCY, async (batch, i) => {
    const prompt = buildChangeSummaryPrompt(batch, hint);
    const streamed = await readStreamedText(model, CHANGE_SUMMARY_SYSTEM_PROMPT, prompt, 1536);
    onProgress?.(++done, batches.length);
    return { ...streamed, summary: `Batch ${i + 1}:\n${cleanMessage(streamed.text)}` };
  });

  return {
    checklist: results.map((r) => r.summary).join("\n\n"),
    promptTokens: results.reduce((sum, r) => sum + r.promptTokens, 0),
    completionTokens: results.reduce((sum, r) => sum + r.completionTokens, 0),
    requests: batches.length,
  };
}

export async function generateMessage(opts: GenerateOptions): Promise<GenerateResult> {
  const {
    modelId,
    diff,
    files,
    summary,
    diffChunks,
    hint,
    releasePlease,
    initialCommit,
    onChunk,
    onSummaryProgress,
  } = opts;
  const model = getModel(modelId);

  const combinedDiff =
    !initialCommit && diffChunks && diffChunks.length > 0
      ? diffChunks.map((chunk) => chunk.diff).join("\n")
      : diff;

  let checklist = opts.checklist;
  let promptTokens = 0;
  let completionTokens = 0;
  let requests = 0;

  if (
    checklist === undefined &&
    !initialCommit &&
    diffChunks &&
    diffChunks.length > 0 &&
    combinedDiff.length > MAX_DIFF_CHARS
  ) {
    const summarized = await summarizeChanges(model, diffChunks, hint, onSummaryProgress);
    checklist = summarized.checklist;
    promptTokens += summarized.promptTokens;
    completionTokens += summarized.completionTokens;
    requests += summarized.requests;
  }

  const prompt =
    checklist !== undefined
      ? buildChecklistCommitPrompt(checklist, files, summary, hint, releasePlease)
      : buildUserPrompt(
          combinedDiff,
          files,
          hint,
          releasePlease,
          initialCommit ? "initial-summary" : "diff",
          summary,
        );

  const streamed = await readStreamedText(
    model,
    SYSTEM_PROMPT,
    prompt,
    2048,
    onChunk,
  );
  promptTokens += streamed.promptTokens;
  completionTokens += streamed.completionTokens;
  requests += 1;

  return {
    message: cleanMessage(streamed.text),
    checklist,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      requests,
    },
  };
}
