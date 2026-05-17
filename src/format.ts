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
  mode: "diff" | "initial-summary" = "diff",
): string {
  const parts = mode === "initial-summary"
    ? [
        "Initial commit in a repository with no existing HEAD.",
        "",
        "Staged summary (`git diff --staged --stat=80,60,200`):",
        files.trim(),
        "",
        "The full first diff is intentionally omitted because initial imports can be very large.",
        "Write an appropriate Conventional Commit message, usually `chore: initial commit` unless the staged summary clearly indicates a narrower type.",
      ]
    : [
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
