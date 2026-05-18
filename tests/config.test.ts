import { describe, it, expect } from "vitest";
import {
  providerOf,
  modelNameOf,
  validateModel,
  listProviders,
  DEFAULT_MODEL,
  PROVIDERS,
} from "../src/config.js";

describe("providerOf", () => {
  it("extracts provider from a well-formed id", () => {
    expect(providerOf("openai:gpt-4o-mini")).toBe("openai");
    expect(providerOf("anthropic:claude-3-5-haiku-latest")).toBe("anthropic");
  });

  it("returns empty string when no colon is present", () => {
    expect(providerOf("gpt-4o-mini")).toBe("");
  });

  it("returns empty string when id starts with colon", () => {
    expect(providerOf(":gpt-4o")).toBe("");
  });

  it("handles model names that contain colons (slashes too — openrouter)", () => {
    expect(providerOf("openrouter:anthropic/claude-3.5-sonnet")).toBe("openrouter");
    expect(providerOf("openai:foo:bar")).toBe("openai");
  });
});

describe("modelNameOf", () => {
  it("returns everything after the first colon", () => {
    expect(modelNameOf("openai:gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(modelNameOf("openrouter:anthropic/claude-3.5-sonnet")).toBe(
      "anthropic/claude-3.5-sonnet",
    );
  });

  it("returns empty string when there is no model part", () => {
    expect(modelNameOf("openai")).toBe("");
    expect(modelNameOf("openai:")).toBe("");
  });
});

describe("validateModel", () => {
  it.each([
    ["openai:gpt-4o-mini", "openai", "OPENAI_API_KEY"],
    ["anthropic:claude-3-5-haiku-latest", "anthropic", "ANTHROPIC_API_KEY"],
    ["google:gemini-1.5-flash", "google", "GOOGLE_GENERATIVE_AI_API_KEY"],
    ["mistral:mistral-small-latest", "mistral", "MISTRAL_API_KEY"],
    ["groq:llama-3.3-70b-versatile", "groq", "GROQ_API_KEY"],
    ["xai:grok-2-latest", "xai", "XAI_API_KEY"],
    ["deepseek:deepseek-chat", "deepseek", "DEEPSEEK_API_KEY"],
    ["kimi:moonshot-v1-8k", "kimi", "MOONSHOT_API_KEY"],
    ["qwen:qwen-plus", "qwen", "DASHSCOPE_API_KEY"],
    ["minimax:MiniMax-Text-01", "minimax", "MINIMAX_API_KEY"],
    ["openrouter:anthropic/claude-3.5-sonnet", "openrouter", "OPENROUTER_API_KEY"],
    ["cloudflare:openai/gpt-4o-mini", "cloudflare", "CLOUDFLARE_AI_GATEWAY_API_KEY"],
    ["ollama:llama3.2", "ollama", "OLLAMA_API_KEY"],
  ])("resolves %s to provider=%s env=%s", (id, provider, envVar) => {
    const r = validateModel(id);
    expect(r.provider).toBe(provider);
    expect(r.spec.envVar).toBe(envVar);
  });

  it("throws on missing model name", () => {
    expect(() => validateModel("openai")).toThrow(/invalid model id/);
    expect(() => validateModel("openai:")).toThrow(/invalid model id/);
  });

  it("throws on missing provider", () => {
    expect(() => validateModel("gpt-4o-mini")).toThrow(/invalid model id/);
  });

  it("throws on unknown provider", () => {
    expect(() => validateModel("nope:foo")).toThrow(/unknown provider/);
  });

  it("marks ollama as apiKey-optional", () => {
    expect(PROVIDERS.ollama!.apiKeyRequired).toBe(false);
  });

  it("marks Cloudflare account id as required provider configuration", () => {
    expect(PROVIDERS.cloudflare!.requiredEnvVars).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(PROVIDERS.cloudflare!.optionalEnvVars).toContain("CLOUDFLARE_AI_GATEWAY_ID");
  });

  it("marks every other provider as apiKey-required (default)", () => {
    for (const [key, spec] of Object.entries(PROVIDERS)) {
      if (key === "ollama") continue;
      expect(spec.apiKeyRequired).not.toBe(false);
    }
  });
});

describe("DEFAULT_MODEL", () => {
  it("uses a bundled provider", () => {
    const provider = providerOf(DEFAULT_MODEL);
    expect(PROVIDERS[provider]).toBeDefined();
  });
});

describe("listProviders", () => {
  it("includes every bundled provider", () => {
    const out = listProviders();
    for (const key of Object.keys(PROVIDERS)) {
      expect(out).toContain(key);
    }
  });

  it("shows '(no key)' for keyless providers", () => {
    expect(listProviders()).toMatch(/ollama[\s\S]*\(no key\)/);
  });
});
