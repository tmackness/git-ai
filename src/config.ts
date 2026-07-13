export const DEFAULT_MODEL = "openai:gpt-4o-mini";

// ~25k tokens — fits every provider's 32k+ context with room for the
// system prompt and output. Diffs larger than this go through batched
// summarization instead of truncation.
export const MAX_DIFF_CHARS = 100_000;

export interface ProviderSpec {
  /** Env var that holds the API key. */
  envVar: string;
  /** Human-friendly label for help text. */
  label: string;
  /** Example model id (without the `<provider>:` prefix). */
  example: string;
  /** Custom OpenAI-compatible base URL. Native SDKs leave this undefined. */
  baseURL?: string;
  /** Some providers (Ollama) don't need an API key. */
  apiKeyRequired?: boolean;
  /** Non-secret environment variables needed to construct the provider. */
  requiredEnvVars?: readonly string[];
  /** Optional environment variables that customize the provider. */
  optionalEnvVars?: readonly string[];
}

/**
 * Registry of providers the CLI knows how to instantiate.
 * Native providers use their first-party `@ai-sdk/*` package.
 * Providers with a `baseURL` are routed through `@ai-sdk/openai-compatible`.
 */
export const PROVIDERS: Readonly<Record<string, ProviderSpec>> = Object.freeze({
  openai: {
    envVar: "OPENAI_API_KEY",
    label: "OpenAI",
    example: "gpt-4o-mini",
  },
  anthropic: {
    envVar: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    example: "claude-3-5-haiku-latest",
  },
  google: {
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    label: "Google Gemini",
    example: "gemini-1.5-flash",
  },
  mistral: {
    envVar: "MISTRAL_API_KEY",
    label: "Mistral",
    example: "mistral-small-latest",
  },
  groq: {
    envVar: "GROQ_API_KEY",
    label: "Groq",
    example: "llama-3.3-70b-versatile",
  },
  xai: {
    envVar: "XAI_API_KEY",
    label: "xAI (Grok)",
    example: "grok-2-latest",
  },
  deepseek: {
    envVar: "DEEPSEEK_API_KEY",
    label: "DeepSeek",
    example: "deepseek-chat",
  },
  kimi: {
    envVar: "MOONSHOT_API_KEY",
    label: "Moonshot (Kimi)",
    example: "moonshot-v1-8k",
    baseURL: "https://api.moonshot.cn/v1",
  },
  qwen: {
    envVar: "DASHSCOPE_API_KEY",
    label: "Qwen (DashScope)",
    example: "qwen-plus",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
  minimax: {
    envVar: "MINIMAX_API_KEY",
    label: "MiniMax",
    example: "MiniMax-Text-01",
    baseURL: "https://api.minimax.io/v1",
  },
  openrouter: {
    envVar: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    example: "anthropic/claude-3.5-sonnet",
    baseURL: "https://openrouter.ai/api/v1",
  },
  cloudflare: {
    envVar: "CLOUDFLARE_AI_GATEWAY_API_KEY",
    label: "Cloudflare AI Gateway",
    example: "openai/gpt-4o-mini",
    requiredEnvVars: ["CLOUDFLARE_ACCOUNT_ID"],
    optionalEnvVars: ["CLOUDFLARE_AI_GATEWAY_ID"],
  },
  ollama: {
    envVar: "OLLAMA_API_KEY",
    label: "Ollama (local)",
    example: "llama3.2",
    baseURL: "http://localhost:11434/v1",
    apiKeyRequired: false,
  },
});

export const SYSTEM_PROMPT = `You write git commit messages from diffs.

Output format (Conventional Commits):
  <type>(<scope>): <subject>

  <optional body explaining why and/or summarizing distinct changes, wrapped at 72 chars>

Rules:
- type ∈ {feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert}
- scope is optional; use a short noun (e.g. auth, api, cli) when one component dominates
- subject: imperative mood, lowercase after the type, no trailing period, ≤72 chars
- first identify every distinct staged change, then group related changes by
  user intent before writing the message
- use the staged overview and file list as a coverage checklist; do not ignore
  later files because an earlier diff hunk was more detailed
- when an intermediate staged-change checklist is provided, treat it as the
  source of truth for coverage
- choose the header type for the dominant or highest-release-impact change
- include a body when the diff contains multiple distinct changes
- body bullets must cover every notable user-visible behavior change, bug fix,
  performance change, config/build/doc/test change, and breaking change, grouping
  related file-level changes when that is clearer than a file-by-file walkthrough
- if the diff is truncated, still summarize the known effect of every changed
  file or related file group from paths, statuses, and stat summary
- when feature and bug-fix changes are both present, mention both in the body
  even though the header has one type
- omit the body only for a small, single-purpose diff whose effect is fully
  captured by the subject
- describe intent and effect, not a file-by-file walkthrough
- output ONLY the commit message — no preamble, no markdown fences, no commentary`;

export function providerOf(modelId: string): string {
  const idx = modelId.indexOf(":");
  if (idx <= 0) return "";
  return modelId.slice(0, idx);
}

export function modelNameOf(modelId: string): string {
  const idx = modelId.indexOf(":");
  if (idx <= 0) return "";
  return modelId.slice(idx + 1);
}

export interface ValidatedModel {
  provider: string;
  spec: ProviderSpec;
}

export function validateModel(modelId: string): ValidatedModel {
  const provider = providerOf(modelId);
  if (!provider || !modelNameOf(modelId)) {
    throw new Error(`invalid model id "${modelId}" — expected "<provider>:<model>"`);
  }
  const spec = PROVIDERS[provider];
  if (!spec) {
    throw new Error(`unknown provider "${provider}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return { provider, spec };
}

export function listProviders(): string {
  const rows = Object.entries(PROVIDERS).map(([key, spec]) => {
    const envHint =
      spec.apiKeyRequired === false
        ? "(no key)"
        : [spec.envVar, ...(spec.requiredEnvVars ?? [])].join(" + ");
    return `  ${key.padEnd(12)} ${spec.label.padEnd(22)} ${envHint.padEnd(32)} e.g. ${key}:${spec.example}`;
  });
  return rows.join("\n");
}
