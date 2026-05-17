import { describe, it, expect } from "vitest";
import { truncateDiff, cleanMessage, buildUserPrompt } from "../src/format.js";

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
    const out = buildUserPrompt(
      "d",
      "M  packages/cli/src/main.ts",
      undefined,
      {
        detected: true,
        sources: ["release-please-config.json"],
        packagePaths: ["packages/cli"],
        releaseTypes: ["node"],
        changelogTypes: ["feat", "fix"],
        affectedPackages: ["cli"],
      },
    );

    expect(out).toContain("This repository uses release-please.");
    expect(out).toContain("Affected release package(s): cli");
    expect(out).toContain("never generate chore(release): messages");
  });
});
