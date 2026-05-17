import { MAX_DIFF_CHARS } from "./config.js";
import type { ReleasePleaseContext } from "./releasePlease.js";
import { renderReleasePleasePrompt } from "./releasePlease.js";

export function truncateDiff(diff: string, max = MAX_DIFF_CHARS): string {
  if (diff.length <= max) return diff;
  return diff.slice(0, max) + "\n\n[... diff truncated ...]";
}

export function cleanMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:[\w-]+)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export function buildUserPrompt(
  diff: string,
  files: string,
  hint?: string,
  releasePlease?: ReleasePleaseContext,
): string {
  const parts = [
    "Files changed (`git diff --staged --name-status`):",
    files.trim(),
    "",
    "Diff:",
    "```diff",
    truncateDiff(diff),
    "```",
  ];
  if (releasePlease?.detected) {
    parts.push("", renderReleasePleasePrompt(releasePlease));
  }
  if (hint && hint.trim()) {
    parts.push("", `Extra context from the developer: ${hint.trim()}`);
  }
  return parts.join("\n");
}
