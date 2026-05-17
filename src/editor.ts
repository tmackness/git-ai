import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function defaultEditor(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "notepad" : "vi";
}

export function resolveEditor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
  const raw = env.GIT_EDITOR || env.VISUAL || env.EDITOR || defaultEditor(platform);
  const parts = raw.trim().split(/\s+/);
  const cmd = parts[0] ?? defaultEditor(platform);
  return { cmd, args: parts.slice(1) };
}

export function editInEditor(initial: string): string {
  const file = join(tmpdir(), `git-ai-${process.pid}-${Date.now()}.txt`);
  writeFileSync(file, initial, "utf8");

  try {
    const { cmd, args } = resolveEditor();
    const result = spawnSync(cmd, [...args, file], {
      stdio: "inherit",
      shell: false,
    });
    if (result.error) {
      throw new Error(`failed to launch editor "${cmd}": ${result.error.message}`);
    }
    if (typeof result.status === "number" && result.status !== 0) {
      throw new Error(`editor "${cmd}" exited with status ${result.status}`);
    }

    const edited = readFileSync(file, "utf8").trim();
    return edited || initial;
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // best effort
    }
  }
}
