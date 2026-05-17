import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isGitRepo,
  repoRoot,
  addPaths,
  stagedDiff,
  stagedFiles,
  commitWithMessage,
  GitError,
} from "../src/git.js";

function gitOk(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
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
    expect(realpathSync(repoRoot())).toBe(realpathSync(tmp));
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

  it("stagedDiff returns diff content for staged changes", () => {
    writeFileSync(join(tmp, "a.txt"), "alpha\n");
    addPaths(["a.txt"]);
    const diff = stagedDiff();
    expect(diff).toContain("alpha");
    expect(diff).toContain("a.txt");
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
