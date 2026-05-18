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
  const parts = parseEditorCommand(raw);
  const cmd = parts[0] || defaultEditor(platform);
  return { cmd, args: parts.slice(1) };
}

function parseEditorCommand(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  const input = raw.trim();
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "\\") {
      if (quote === "'") {
        current += ch;
        continue;
      }
      const next = input[i + 1];
      if (next && (/\s/.test(next) || next === "'" || next === '"' || next === "\\")) {
        current += next;
        i++;
      } else {
        current += ch;
      }
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = undefined;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current) parts.push(current);
  return parts;
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
