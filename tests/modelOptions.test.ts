import { describe, expect, it } from "vitest";
import {
  allModelOptions,
  CLOUDFLARE_AI_GATEWAY_MODELS,
  cloudflareModelOptions,
  directModelOptions,
  hasProviderConfig,
} from "../src/modelOptions.js";

describe("model options", () => {
  it("includes direct and Cloudflare model choices", () => {
    expect(directModelOptions().map((option) => option.modelId)).toContain("openai:gpt-4o-mini");
    expect(cloudflareModelOptions().map((option) => option.modelId)).toContain(
      "cloudflare:openai/gpt-4o-mini",
    );
    expect(allModelOptions().length).toBeGreaterThan(directModelOptions().length);
  });

  it("includes every Cloudflare OpenAI-compatible provider in the picker", () => {
    expect(CLOUDFLARE_AI_GATEWAY_MODELS).toEqual([
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4o-mini",
      "groq/llama-3.3-70b-versatile",
      "mistral/mistral-large-latest",
      "cohere/command-r-plus",
      "perplexity/mistral-7b-instruct",
      "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "google-ai-studio/gemini-2.5-flash",
      "google-vertex-ai/google/gemini-2.5-pro",
      "grok/grok-4",
      "deepseek/deepseek-chat",
      "cerebras/llama3.1-8b",
      "baseten/openai/gpt-oss-120b",
      "parallel/speed",
    ]);
  });

  it("treats saved API keys as configured", () => {
    const option = directModelOptions().find((item) => item.provider === "anthropic")!;
    expect(hasProviderConfig(option, {}, { apiKeys: { ANTHROPIC_API_KEY: "key" } })).toBe(true);
  });

  it("requires Cloudflare token and account id", () => {
    const option = cloudflareModelOptions()[0]!;
    expect(hasProviderConfig(option, { CLOUDFLARE_AI_GATEWAY_API_KEY: "key" }, {})).toBe(false);
    expect(
      hasProviderConfig(
        option,
        { CLOUDFLARE_AI_GATEWAY_API_KEY: "key", CLOUDFLARE_ACCOUNT_ID: "account" },
        {},
      ),
    ).toBe(true);
  });
});
