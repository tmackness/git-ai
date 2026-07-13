import { describe, it, expect } from "vitest";
import {
  truncateDiff,
  cleanMessage,
  buildUserPrompt,
  buildChangeSummaryPrompt,
  buildChecklistCommitPrompt,
} from "../src/format.js";

describe("truncateDiff", () => {
  it("leaves a short diff unchanged", () => {
    const diff = "diff --git a/x b/x\n";
    expect(truncateDiff(diff, 1000)).toBe(diff);
  });

  it("truncates when the diff exceeds the limit", () => {
    const big = "x".repeat(100);
    const result = truncateDiff(big, 20);
    expect(result.startsWith("x".repeat(20))).toBe(true);
    expect(result).toMatch(/diff truncated/);
  });

  it("respects the limit exactly at the boundary", () => {
    const exact = "x".repeat(50);
    expect(truncateDiff(exact, 50)).toBe(exact);
    expect(truncateDiff(exact + "y", 50)).toMatch(/diff truncated/);
  });
});

describe("cleanMessage", () => {
  it("trims surrounding whitespace", () => {
    expect(cleanMessage("  feat: hi  \n")).toBe("feat: hi");
  });

  it("strips a leading code fence", () => {
    expect(cleanMessage("```\nfeat: hi\n```")).toBe("feat: hi");
  });

  it("strips a language-tagged fence", () => {
    expect(cleanMessage("```text\nfeat: hi\n```")).toBe("feat: hi");
  });

  it("leaves an unfenced message alone", () => {
    expect(cleanMessage("fix: bug")).toBe("fix: bug");
  });

  it("preserves multi-line body content", () => {
    const msg = "feat(api): add endpoint\n\nWhy: needed for X";
    expect(cleanMessage(msg)).toBe(msg);
  });
});

describe("buildUserPrompt", () => {
  it("includes files and diff", () => {
    const out = buildUserPrompt("DIFF_BODY", "M  src/foo.ts");
    expect(out).toContain("M  src/foo.ts");
    expect(out).toContain("DIFF_BODY");
    expect(out).toContain("```diff");
  });

  it("includes the staged overview as a coverage checklist", () => {
    const out = buildUserPrompt(
      "DIFF_BODY",
      "M  src/foo.ts\nA  tests/foo.test.ts",
      undefined,
      undefined,
      "diff",
      " src/foo.ts | 8 ++++++++\n tests/foo.test.ts | 20 ++++++++++++++++++++",
    );

    expect(out).toContain("Treat the overview and file list as a coverage checklist");
    expect(out).toContain("Staged change overview");
    expect(out).toContain("tests/foo.test.ts | 20");
    expect(out).toContain("Do not focus only on the first diff hunk");
  });

  it("uses a bounded summary prompt for initial commits", () => {
    const out = buildUserPrompt(
      "",
      " package.json | 20 +++++",
      undefined,
      undefined,
      "initial-summary",
    );
    expect(out).toContain("Initial commit");
    expect(out).toContain("package.json");
    expect(out).toContain("chore: initial commit");
    expect(out).not.toContain("```diff");
  });

  it("appends developer hint when provided", () => {
    const out = buildUserPrompt("d", "f", "fixes bug 123");
    expect(out).toMatch(/Extra context from the developer: fixes bug 123/);
  });

  it("omits hint section when hint is empty or whitespace", () => {
    expect(buildUserPrompt("d", "f", "")).not.toMatch(/Extra context/);
    expect(buildUserPrompt("d", "f", "   ")).not.toMatch(/Extra context/);
    expect(buildUserPrompt("d", "f", undefined)).not.toMatch(/Extra context/);
  });

  it("adds release-please guidance when provided", () => {
    const out = buildUserPrompt("d", "M  packages/cli/src/main.ts", undefined, {
      detected: true,
      sources: ["release-please-config.json"],
      packagePaths: ["packages/cli"],
      releaseTypes: ["node"],
      changelogTypes: ["feat", "fix"],
      affectedPackages: ["cli"],
    });

    expect(out).toContain("This repository uses release-please.");
    expect(out).toContain("Affected release package(s): cli");
    expect(out).toContain("never generate chore(release): messages");
  });
});

describe("two-pass broad diff prompts", () => {
  it("builds a per-file summary prompt from diff chunks", () => {
    const out = buildChangeSummaryPrompt(
      [
        {
          status: "M",
          path: "src/foo.ts",
          diff: "diff --git a/src/foo.ts b/src/foo.ts\n+export const foo = 1;\n",
        },
        {
          status: "R100",
          previousPath: "src/old.ts",
          path: "src/new.ts",
          diff: "diff --git a/src/old.ts b/src/new.ts\nsimilarity index 100%\n",
        },
      ],
      "M\tsrc/foo.ts\nR100\tsrc/old.ts\tsrc/new.ts",
      " src/foo.ts | 1 +",
      "prefer cli scope",
    );

    expect(out).toContain("one bullet per changed file");
    expect(out).toContain("Complete staged file list");
    expect(out).toContain("File: M src/foo.ts");
    expect(out).toContain("File: R100 src/old.ts -> src/new.ts");
    expect(out).toContain("Extra context from the developer: prefer cli scope");
    expect(out).not.toContain("Write the final Conventional Commit");
  });

  it("builds the final commit prompt from the intermediate checklist", () => {
    const out = buildChecklistCommitPrompt(
      "- src/foo.ts: adds foo behavior\n- tests/foo.test.ts: covers foo",
      "M\tsrc/foo.ts\nA\ttests/foo.test.ts",
      " src/foo.ts | 5 +++++",
    );

    expect(out).toContain("source of truth for coverage");
    expect(out).toContain("Intermediate staged-change checklist");
    expect(out).toContain("tests/foo.test.ts: covers foo");
    expect(out).not.toContain("```diff");
  });
});
