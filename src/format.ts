import { MAX_DIFF_CHARS } from "./config.js";
import type { ReleasePleaseContext } from "./releasePlease.js";
import { renderReleasePleasePrompt } from "./releasePlease.js";

export interface DiffChunkForPrompt {
  status: string;
  path: string;
  previousPath?: string;
  diff: string;
}

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
  summary?: string,
): string {
  const parts =
    mode === "initial-summary"
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
          "Review all staged inputs before drafting. Treat the overview and file list as a coverage checklist, then use the diff for detail.",
          "",
          "Staged change overview (`git diff --staged --stat=80,60,200`):",
          summary?.trim() || "(not provided)",
          "",
          "Files changed (`git diff --staged --name-status`):",
          files.trim(),
          "",
          "Diff (may be truncated for very large staged changes):",
          "```diff",
          truncateDiff(diff),
          "```",
          "",
          "If the diff is truncated, still cover every listed file or related file group whose purpose can be inferred from the overview, paths, and statuses. Do not focus only on the first diff hunk.",
        ];
  if (releasePlease?.detected) {
    parts.push("", renderReleasePleasePrompt(releasePlease));
  }
  if (hint && hint.trim()) {
    parts.push("", `Extra context from the developer: ${hint.trim()}`);
  }
  return parts.join("\n");
}

function renderChunkHeading(chunk: DiffChunkForPrompt): string {
  return chunk.previousPath
    ? `${chunk.status} ${chunk.previousPath} -> ${chunk.path}`
    : `${chunk.status} ${chunk.path}`;
}

export function renderDiffChunk(chunk: DiffChunkForPrompt): string {
  return [
    `File: ${renderChunkHeading(chunk)}`,
    "```diff",
    chunk.diff.trim() || "(no textual diff)",
    "```",
  ].join("\n");
}

export function buildChangeSummaryPrompt(
  chunks: readonly DiffChunkForPrompt[],
  files: string,
  summary?: string,
  hint?: string,
): string {
  const parts = [
    "Summarize the staged changes in this diff batch before a final commit message is written.",
    "Return a concise checklist, with one bullet per changed file or tightly related file group.",
    "Each bullet must name the relevant path(s), status, and inferred effect. If a diff is truncated or binary, summarize what can be inferred from the path, status, and stat overview.",
    "Do not write a commit message yet.",
    "",
    "Complete staged change overview (`git diff --staged --stat=80,60,200`):",
    summary?.trim() || "(not provided)",
    "",
    "Complete staged file list (`git diff --staged --name-status`):",
    files.trim(),
    "",
    "Diff batch:",
    chunks.map(renderDiffChunk).join("\n\n"),
  ];

  if (hint && hint.trim()) {
    parts.push("", `Extra context from the developer: ${hint.trim()}`);
  }

  return parts.join("\n");
}

export function buildChecklistCommitPrompt(
  checklist: string,
  files: string,
  summary?: string,
  hint?: string,
  releasePlease?: ReleasePleaseContext,
): string {
  const parts = [
    "Write the final Conventional Commit message from this staged-change checklist.",
    "Use the checklist as the source of truth for coverage, then group related file-level changes by user intent.",
    "",
    "Staged change overview (`git diff --staged --stat=80,60,200`):",
    summary?.trim() || "(not provided)",
    "",
    "Files changed (`git diff --staged --name-status`):",
    files.trim(),
    "",
    "Intermediate staged-change checklist:",
    checklist.trim() || "(not provided)",
    "",
    "Cover every notable change or related group represented in the checklist. Do not fall back to a file-by-file walkthrough unless that is the clearest summary.",
  ];

  if (releasePlease?.detected) {
    parts.push("", renderReleasePleasePrompt(releasePlease));
  }
  if (hint && hint.trim()) {
    parts.push("", `Extra context from the developer: ${hint.trim()}`);
  }

  return parts.join("\n");
}
