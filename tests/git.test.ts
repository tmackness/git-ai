import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_DIFF_CHARS } from "../src/config.js";
import {
  isGitRepo,
  repoRoot,
  hasCommits,
  addPaths,
  hasStagedChanges,
  stagedDiff,
  stagedDiffChunks,
  stagedFiles,
  stagedSummary,
  commitWithMessage,
  GitError,
} from "../src/git.js";

function gitOk(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
}

function expectSameDirectory(actual: string, expected: string): void {
  const actualStat = statSync(actual);
  const expectedStat = statSync(expected);
  expect(actualStat.dev).toBe(expectedStat.dev);
  expect(actualStat.ino).toBe(expectedStat.ino);
}

describe("git module (integration against a real temp repo)", () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), "gitai-test-"));
    process.chdir(tmp);
    gitOk(["init", "-q", "-b", "main"], tmp);
    gitOk(["config", "user.email", "test@example.com"], tmp);
    gitOk(["config", "user.name", "Test User"], tmp);
    gitOk(["config", "commit.gpgsign", "false"], tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("isGitRepo returns true inside a repo", () => {
    expect(isGitRepo()).toBe(true);
  });

  it("repoRoot returns the top-level repo path", () => {
    expectSameDirectory(repoRoot(), tmp);
  });

  it("hasCommits is false before the first commit and true after", () => {
    expect(hasCommits()).toBe(false);
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    addPaths(["a.txt"]);
    commitWithMessage("chore: initial commit");
    expect(hasCommits()).toBe(true);
  });

  it("isGitRepo returns false outside a repo", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "gitai-nonrepo-"));
    process.chdir(nonRepo);
    try {
      expect(isGitRepo()).toBe(false);
    } finally {
      process.chdir(tmp);
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it("addPaths('.') stages every new file in the tree", () => {
    writeFileSync(join(tmp, "hello.txt"), "world\n");
    writeFileSync(join(tmp, "second.txt"), "two\n");
    addPaths(["."]);
    const files = stagedFiles();
    expect(files).toMatch(/A\s+hello\.txt/);
    expect(files).toMatch(/A\s+second\.txt/);
  });

  it("addPaths with explicit paths stages only those paths", () => {
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    writeFileSync(join(tmp, "b.txt"), "beta\n");
    addPaths(["a.txt"]);
    const files = stagedFiles();
    expect(files).toMatch(/A\s+a\.txt/);
    expect(files).not.toMatch(/b\.txt/);
  });

  it("addPaths([]) is a no-op", () => {
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    addPaths([]);
    expect(stagedFiles()).toBe("");
  });

  it("stagedDiff returns empty when nothing is staged", () => {
    expect(stagedDiff()).toBe("");
  });

  it("hasStagedChanges checks the index without reading the diff", () => {
    expect(hasStagedChanges()).toBe(false);
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    addPaths(["a.txt"]);
    expect(hasStagedChanges()).toBe(true);
  });

  it("stagedDiff returns diff content for staged changes", () => {
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    addPaths(["a.txt"]);
    const diff = stagedDiff();
    expect(diff).toContain("alpha");
    expect(diff).toContain("a.txt");
  });

  it("stagedDiffChunks returns one bounded diff per staged file", () => {
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    writeFileSync(join(tmp, "b.txt"), "beta\n");
    addPaths(["a.txt", "b.txt"]);

    const chunks = stagedDiffChunks();
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.path)).toEqual(["a.txt", "b.txt"]);
    expect(chunks[0]!.status).toBe("A");
    expect(chunks[0]!.diff).toContain("alpha");
    expect(chunks[1]!.diff).toContain("beta");
  });

  it("stagedDiffChunks preserves rename metadata", () => {
    writeFileSync(join(tmp, "old.txt"), "alpha\n");
    addPaths(["old.txt"]);
    commitWithMessage("chore: add old file");

    gitOk(["mv", "old.txt", "new.txt"], tmp);
    const chunks = stagedDiffChunks();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.status).toMatch(/^R/);
    expect(chunks[0]!.previousPath).toBe("old.txt");
    expect(chunks[0]!.path).toBe("new.txt");
    expect(chunks[0]!.diff).toContain("old.txt");
    expect(chunks[0]!.diff).toContain("new.txt");
  });

  it("stagedDiff returns a bounded diff for changes larger than spawnSync's default buffer", () => {
    writeFileSync(join(tmp, "big.txt"), "alpha\n".repeat(220_000));
    addPaths(["big.txt"]);
    const diff = stagedDiff();
    expect(diff).toContain("big.txt");
    expect(diff).toContain("[... diff truncated ...]");
    expect(diff.length).toBeLessThanOrEqual(MAX_DIFF_CHARS);
  });

  it("stagedDiffChunks bounds each large file diff independently", () => {
    writeFileSync(join(tmp, "first.txt"), "alpha\n".repeat(80_000));
    writeFileSync(join(tmp, "second.txt"), "beta\n".repeat(80_000));
    addPaths(["first.txt", "second.txt"]);

    const chunks = stagedDiffChunks();
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.diff).toContain("[... file diff truncated ...]");
    expect(chunks[1]!.diff).toContain("[... file diff truncated ...]");
    expect(chunks[0]!.diff).toContain("first.txt");
    expect(chunks[1]!.diff).toContain("second.txt");
  });

  it("stagedDiffChunks is not confused by content lines that look like diff headers", () => {
    writeFileSync(join(tmp, "a.txt"), "diff --git a/x b/x\nplain line\n");
    writeFileSync(join(tmp, "b.txt"), "beta\n");
    addPaths(["a.txt", "b.txt"]);

    const chunks = stagedDiffChunks();
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.path).toBe("a.txt");
    expect(chunks[0]!.diff).toContain("+diff --git a/x b/x");
    expect(chunks[1]!.path).toBe("b.txt");
    expect(chunks[1]!.diff).toContain("beta");
  });

  it("stagedSummary returns a bounded stat summary for staged changes", () => {
    writeFileSync(join(tmp, "a.txt"), `${"alpha\n".repeat(1000)}`);
    addPaths(["a.txt"]);
    const summary = stagedSummary();
    expect(summary).toContain("a.txt");
    expect(summary.length).toBeLessThan(1000);
  });

  it("commitWithMessage creates a commit and clears the staged diff", () => {
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    addPaths(["a.txt"]);
    commitWithMessage("feat: add alpha");
    expect(stagedDiff()).toBe("");
    const log = spawnSync("git", ["log", "-1", "--pretty=%s"], { cwd: tmp, encoding: "utf8" });
    expect(log.stdout.trim()).toBe("feat: add alpha");
  });

  it("commitWithMessage preserves a multi-line body", () => {
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    addPaths(["a.txt"]);
    const msg = "feat(api): add alpha\n\nWhy: needed for the X workflow.";
    commitWithMessage(msg);
    const log = spawnSync("git", ["log", "-1", "--pretty=%B"], { cwd: tmp, encoding: "utf8" });
    expect(log.stdout.trim()).toBe(msg);
  });

  it("commitWithMessage throws GitError when there is nothing to commit", () => {
    expect(() => commitWithMessage("noop")).toThrow(GitError);
  });

  it("addPaths refuses to interpret a path as a flag (-- separator)", () => {
    writeFileSync(join(tmp, "--weird.txt"), "x\n");
    addPaths(["--weird.txt"]);
    expect(stagedFiles()).toMatch(/--weird\.txt/);
  });
});
