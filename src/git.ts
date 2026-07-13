import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_DIFF_CHARS } from "./config.js";

const MAX_STAGED_FILES_CHARS = 200_000;
const MAX_STAGED_FILE_DIFF_CHARS = 20_000;
const MAX_COMBINED_DIFF_CHARS = 10_000_000;
const DIFF_TRUNCATED_MARKER = "\n\n[... diff truncated ...]";
const FILES_TRUNCATED_MARKER = "\n\n[... file list truncated ...]";
const FILE_DIFF_TRUNCATED_MARKER = "\n\n[... file diff truncated ...]";
const MAX_NAME_STATUS_BUFFER = 10_000_000;

export interface StagedDiffChunk {
  status: string;
  path: string;
  previousPath?: string;
  diff: string;
}

export class GitError extends Error {
  readonly code: number | null;
  readonly stderr: string;
  constructor(message: string, code: number | null, stderr: string) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.stderr = stderr;
  }
}

function run(
  args: string[],
  options: SpawnSyncOptions & { input?: string } = {},
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    shell: false,
    ...options,
  });
  if (result.error) {
    throw new GitError(`failed to spawn git: ${result.error.message}`, null, "");
  }
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    status: result.status,
  };
}

function truncateWithMarker(output: string, maxChars: number, marker: string): string {
  if (output.length <= maxChars) return output;
  const prefixLength = Math.max(0, maxChars - marker.length);
  return output.slice(0, prefixLength).trimEnd() + marker;
}

function readBoundedOutput(path: string, fd: number, maxChars: number, marker: string): string {
  const maxBytes = (maxChars + marker.length + 1) * 4;
  const buffer = Buffer.alloc(maxBytes);
  const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
  const output = buffer.subarray(0, bytesRead).toString("utf8");
  if (statSync(path).size <= bytesRead && output.length <= maxChars) return output;
  return truncateWithMarker(output, maxChars, marker);
}

function runWithBoundedStdout(
  args: string[],
  maxChars: number,
  marker: string,
): { stdout: string; stderr: string; status: number | null } {
  const dir = mkdtempSync(join(tmpdir(), "gitai-git-"));
  const stdoutPath = join(dir, "stdout");
  const stdoutFd = openSync(stdoutPath, "w+");
  try {
    const result = spawnSync("git", args, {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", stdoutFd, "pipe"],
    });
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    if (result.error) {
      throw new GitError(`failed to spawn git: ${result.error.message}`, null, stderr);
    }
    return {
      stdout: readBoundedOutput(stdoutPath, stdoutFd, maxChars, marker),
      stderr,
      status: result.status,
    };
  } finally {
    closeSync(stdoutFd);
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseStagedPathRecords(output: string): Array<Omit<StagedDiffChunk, "diff">> {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") tokens.pop();

  const records: Array<Omit<StagedDiffChunk, "diff">> = [];
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++];
    if (!status) break;
    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = tokens[i++];
      const path = tokens[i++];
      if (previousPath && path) records.push({ status, previousPath, path });
      continue;
    }

    const path = tokens[i++];
    if (path) records.push({ status, path });
  }

  return records;
}

function stagedPathRecords(): Array<Omit<StagedDiffChunk, "diff">> {
  const r = run(["diff", "--staged", "--name-status", "-z"], {
    maxBuffer: MAX_NAME_STATUS_BUFFER,
  });
  if (r.status !== 0) {
    throw new GitError("git diff --staged --name-status -z failed", r.status, r.stderr);
  }
  return parseStagedPathRecords(r.stdout);
}

export function isGitRepo(): boolean {
  const r = run(["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  return r.status === 0;
}

export function repoRoot(): string {
  const r = run(["rev-parse", "--show-toplevel"]);
  if (r.status !== 0) {
    throw new GitError("git rev-parse --show-toplevel failed", r.status, r.stderr);
  }
  return r.stdout.trim();
}

export function hasCommits(): boolean {
  const r = run(["rev-parse", "--verify", "HEAD"], { stdio: "ignore" });
  return r.status === 0;
}

export function addPaths(paths: string[]): void {
  if (paths.length === 0) return;
  const r = run(["add", "--", ...paths], { stdio: "inherit" });
  if (r.status !== 0) {
    throw new GitError(`git add ${paths.join(" ")} failed`, r.status, r.stderr);
  }
}

export function hasStagedChanges(): boolean {
  const r = run(["diff", "--staged", "--quiet", "--exit-code"], { stdio: "ignore" });
  if (r.status === 0) return false;
  if (r.status === 1) return true;
  throw new GitError("git diff --staged --quiet failed", r.status, r.stderr);
}

export function stagedDiff(): string {
  const r = runWithBoundedStdout(["diff", "--staged"], MAX_DIFF_CHARS, DIFF_TRUNCATED_MARKER);
  if (r.status !== 0) {
    throw new GitError("git diff --staged failed", r.status, r.stderr);
  }
  return r.stdout;
}

function splitCombinedDiff(combined: string): string[] {
  if (!combined.startsWith("diff --git ")) return [];
  const segments: string[] = [];
  let start = 0;
  while (start < combined.length) {
    const next = combined.indexOf("\ndiff --git ", start);
    const end = next === -1 ? combined.length : next + 1;
    segments.push(combined.slice(start, end));
    start = end;
  }
  return segments;
}

function stagedDiffChunksPerFile(
  records: Array<Omit<StagedDiffChunk, "diff">>,
): StagedDiffChunk[] {
  return records.map((record) => {
    const paths = record.previousPath ? [record.previousPath, record.path] : [record.path];
    const r = runWithBoundedStdout(
      ["diff", "--staged", "--", ...paths],
      MAX_STAGED_FILE_DIFF_CHARS,
      FILE_DIFF_TRUNCATED_MARKER,
    );
    if (r.status !== 0) {
      throw new GitError(`git diff --staged -- ${paths.join(" ")} failed`, r.status, r.stderr);
    }
    return { ...record, diff: r.stdout };
  });
}

export function stagedDiffChunks(): StagedDiffChunk[] {
  const records = stagedPathRecords();
  if (records.length === 0) return [];

  const r = runWithBoundedStdout(["diff", "--staged"], MAX_COMBINED_DIFF_CHARS, DIFF_TRUNCATED_MARKER);
  if (r.status !== 0) {
    throw new GitError("git diff --staged failed", r.status, r.stderr);
  }

  // One git spawn instead of one per file. Diff segments and name-status
  // records come from the same diff queue, so they align by order; if they
  // don't (index changed mid-read, combined output truncated), fall back to
  // the slower per-file reads rather than mislabeling diffs.
  const segments = splitCombinedDiff(r.stdout);
  if (segments.length !== records.length) return stagedDiffChunksPerFile(records);

  return records.map((record, i) => ({
    ...record,
    diff: truncateWithMarker(
      segments[i]!,
      MAX_STAGED_FILE_DIFF_CHARS,
      FILE_DIFF_TRUNCATED_MARKER,
    ),
  }));
}

export function stagedFiles(): string {
  const r = runWithBoundedStdout(
    ["diff", "--staged", "--name-status"],
    MAX_STAGED_FILES_CHARS,
    FILES_TRUNCATED_MARKER,
  );
  if (r.status !== 0) {
    throw new GitError("git diff --staged --name-status failed", r.status, r.stderr);
  }
  return r.stdout;
}

export function stagedSummary(): string {
  const r = run(["diff", "--staged", "--stat=80,60,200"]);
  if (r.status !== 0) {
    throw new GitError("git diff --staged --stat failed", r.status, r.stderr);
  }
  return r.stdout;
}

export function commitWithMessage(message: string): void {
  const r = run(["commit", "-F", "-"], {
    input: message,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    throw new GitError("git commit failed", r.status, r.stderr);
  }
}
