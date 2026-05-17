import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface GitaiConfig {
  defaultModel?: string;
  apiKeys?: Record<string, string>;
  env?: Record<string, string>;
}

export function configPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.GITAI_CONFIG) return env.GITAI_CONFIG;

  if (platform === "win32") {
    const base = env.APPDATA ?? join(env.USERPROFILE ?? homedir(), "AppData", "Roaming");
    return join(base, "gitai", "config.json");
  }

  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "gitai", "config.json");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): GitaiConfig {
  try {
    const path = configPath(env, platform);
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as GitaiConfig;
    return {
      defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : undefined,
      apiKeys:
        parsed.apiKeys && typeof parsed.apiKeys === "object"
          ? Object.fromEntries(
              Object.entries(parsed.apiKeys).filter(
                ([, v]) => typeof v === "string" && v.length > 0,
              ),
            )
          : undefined,
      env:
        parsed.env && typeof parsed.env === "object"
          ? Object.fromEntries(
              Object.entries(parsed.env).filter(
                ([, v]) => typeof v === "string" && v.length > 0,
              ),
            )
          : undefined,
    };
  } catch {
    return {};
  }
}

export function saveConfig(
  config: GitaiConfig,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const path = configPath(env, platform);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore on systems that don't support chmod (Windows in some configs)
  }
  return path;
}

export function mergeConfig(base: GitaiConfig, overlay: GitaiConfig): GitaiConfig {
  return {
    defaultModel: overlay.defaultModel ?? base.defaultModel,
    apiKeys: { ...(base.apiKeys ?? {}), ...(overlay.apiKeys ?? {}) },
    env: { ...(base.env ?? {}), ...(overlay.env ?? {}) },
  };
}
