import { PROVIDERS, type ProviderSpec } from "./config.js";
import type { GitaiConfig } from "./configFile.js";

export interface ModelOption {
  provider: string;
  modelId: string;
  spec: ProviderSpec;
}

export const CLOUDFLARE_AI_GATEWAY_MODELS = [
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
] as const;

export function directModelOptions(): ModelOption[] {
  return Object.entries(PROVIDERS)
    .filter(([provider]) => provider !== "cloudflare")
    .map(([provider, spec]) => ({
      provider,
      modelId: `${provider}:${spec.example}`,
      spec,
    }));
}

export function cloudflareModelOptions(): ModelOption[] {
  const spec = PROVIDERS.cloudflare!;
  return CLOUDFLARE_AI_GATEWAY_MODELS.map((model) => ({
    provider: "cloudflare",
    modelId: `cloudflare:${model}`,
    spec,
  }));
}

export function allModelOptions(): ModelOption[] {
  return [...directModelOptions(), ...cloudflareModelOptions()];
}

export function hasProviderConfig(
  option: ModelOption,
  env: NodeJS.ProcessEnv,
  config: GitaiConfig,
): boolean {
  if (option.spec.apiKeyRequired === false) return true;

  const apiKey = env[option.spec.envVar] ?? config.apiKeys?.[option.spec.envVar];
  if (!apiKey) return false;

  for (const requiredEnvVar of option.spec.requiredEnvVars ?? []) {
    if (!(env[requiredEnvVar] ?? config.env?.[requiredEnvVar])) return false;
  }

  return true;
}
