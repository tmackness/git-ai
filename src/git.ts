import { spawnSync, type SpawnSyncOptions } from "node:child_process";

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
  const r = run(["diff", "--staged"]);
  if (r.status !== 0) {
    throw new GitError("git diff --staged failed", r.status, r.stderr);
  }
  return r.stdout;
}

export function stagedFiles(): string {
  const r = run(["diff", "--staged", "--name-status"]);
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
