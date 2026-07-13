import { validateModel } from "./config.js";
import { loadConfig, mergeConfig, saveConfig } from "./configFile.js";
import { cloudflareModelOptions, directModelOptions, type ModelOption } from "./modelOptions.js";
import { ask, askYesNo, readSecret, selectFromList } from "./prompt.js";
import { c, sym } from "./colors.js";

type SetupMode = "direct" | "cloudflare";

interface SetupModeOption {
  mode: SetupMode;
  label: string;
  description: string;
}

export interface SetupPrompts {
  selectMode(options: SetupModeOption[]): Promise<SetupModeOption | null>;
  selectModel(options: ModelOption[]): Promise<ModelOption | null>;
  confirmUseExisting?(key: string): Promise<boolean>;
  readText(prompt: string): Promise<string>;
  readSecret(prompt: string): Promise<string>;
}

export interface SetupOptions {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  prompts?: SetupPrompts;
}

function setupModes(): SetupModeOption[] {
  return [
    {
      mode: "cloudflare",
      label: "Cloudflare AI Gateway",
      description: "one Cloudflare Gateway token can route to multiple providers",
    },
    {
      mode: "direct",
      label: "Direct provider API keys",
      description: "use OpenAI, Anthropic, Groq, and others directly",
    },
  ];
}

function renderModelOption(option: ModelOption): string {
  const keyHint = option.spec.apiKeyRequired === false ? "no API key" : option.spec.envVar;
  return `${option.modelId.padEnd(44)} ${c.dim(option.spec.label)} ${c.dim(`(${keyHint})`)}`;
}

function defaultPrompts(): SetupPrompts {
  return {
    selectMode(options) {
      return selectFromList(
        "How should gitai call models?",
        options,
        (option) => `${option.label} ${c.dim(`- ${option.description}`)}`,
      );
    },
    selectModel(options) {
      return selectFromList("Choose a default model:", options, renderModelOption);
    },
    confirmUseExisting(key) {
      return askYesNo(`${key} is already set. Keep it?`, true);
    },
    readText(prompt) {
      return ask(prompt);
    },
    readSecret,
  };
}

async function readRequiredText(
  prompts: SetupPrompts,
  env: NodeJS.ProcessEnv,
  key: string,
): Promise<string> {
  const existing = env[key];
  if (existing && (await confirmUseExisting(prompts, key))) return existing;
  return (await prompts.readText(`${key}: `)).trim();
}

async function readTextWithDefault(
  prompts: SetupPrompts,
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): Promise<string> {
  const existing = env[key];
  if (existing && (await confirmUseExisting(prompts, key))) return existing;
  const answer = (await prompts.readText(`${key} [${fallback}]: `)).trim();
  return answer || fallback;
}

async function confirmUseExisting(prompts: SetupPrompts, key: string): Promise<boolean> {
  return prompts.confirmUseExisting ? prompts.confirmUseExisting(key) : true;
}

export async function runSetupWizard(options: SetupOptions): Promise<number> {
  const { stdout, stderr, env, platform = process.platform } = options;
  const prompts = options.prompts ?? defaultPrompts();

  stdout.write(`${c.bold("gitai setup")}\n\n`);

  const mode = await prompts.selectMode(setupModes());
  if (!mode) {
    stderr.write(`${c.red(c.bold("gitai:"))} invalid setup choice\n`);
    return 1;
  }

  const selected = await prompts.selectModel(
    mode.mode === "cloudflare" ? cloudflareModelOptions() : directModelOptions(),
  );
  if (!selected) {
    stderr.write(`${c.red(c.bold("gitai:"))} invalid model choice\n`);
    return 1;
  }

  try {
    validateModel(selected.modelId);
  } catch (err) {
    stderr.write(`${c.red(c.bold("gitai:"))} ${(err as Error).message}\n`);
    return 1;
  }

  const overlay = {
    defaultModel: selected.modelId,
    apiKeys: {} as Record<string, string>,
    env: {} as Record<string, string>,
  };

  if (mode.mode === "cloudflare") {
    const accountId = await readRequiredText(prompts, env, "CLOUDFLARE_ACCOUNT_ID");
    if (!accountId) {
      stderr.write(`${c.red(c.bold("gitai:"))} CLOUDFLARE_ACCOUNT_ID cannot be empty\n`);
      return 1;
    }
    overlay.env.CLOUDFLARE_ACCOUNT_ID = accountId;

    const gatewayId = await readTextWithDefault(
      prompts,
      env,
      "CLOUDFLARE_AI_GATEWAY_ID",
      "default",
    );
    overlay.env.CLOUDFLARE_AI_GATEWAY_ID = gatewayId;
  }

  if (selected.spec.apiKeyRequired !== false) {
    const existingKey = env[selected.spec.envVar];
    const key =
      existingKey && (await confirmUseExisting(prompts, selected.spec.envVar))
        ? existingKey.trim()
        : (await prompts.readSecret(`${selected.spec.envVar}: `)).trim();
    if (!key) {
      stderr.write(`${c.red(c.bold("gitai:"))} API key cannot be empty\n`);
      return 1;
    }
    overlay.apiKeys[selected.spec.envVar] = key;
  }

  const saved = saveConfig(mergeConfig(loadConfig(env, platform), overlay), env, platform);
  stdout.write(`\n${c.green(sym.check)} saved ${c.bold(selected.modelId)} to ${saved}\n`);
  return 0;
}
