import { streamText, type LanguageModelV1 } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { mistral } from "@ai-sdk/mistral";
import { groq } from "@ai-sdk/groq";
import { xai } from "@ai-sdk/xai";
import { deepseek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { PROVIDERS, SYSTEM_PROMPT, modelNameOf, providerOf } from "./config.js";
import { buildUserPrompt, cleanMessage } from "./format.js";
import type { ReleasePleaseContext } from "./releasePlease.js";

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
        throw new Error(`provider "${provider}" is OpenAI-compatible but has no baseURL configured`);
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
  hint?: string;
  releasePlease?: ReleasePleaseContext;
  initialCommit?: boolean;
  onChunk?: (chunk: string) => void;
}

export async function generateMessage(opts: GenerateOptions): Promise<string> {
  const { modelId, diff, files, hint, releasePlease, initialCommit, onChunk } = opts;
  const prompt = buildUserPrompt(
    diff,
    files,
    hint,
    releasePlease,
    initialCommit ? "initial-summary" : "diff",
  );

  const result = streamText({
    model: getModel(modelId),
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 1024,
  });

  let message = "";
  for await (const chunk of result.textStream) {
    message += chunk;
    onChunk?.(chunk);
  }

  return cleanMessage(message);
}
