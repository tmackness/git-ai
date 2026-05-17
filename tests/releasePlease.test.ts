import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectReleasePlease,
  renderReleasePleasePrompt,
} from "../src/releasePlease.js";

const temps: string[] = [];

function tempRepo(): string {
  const tmp = mkdtempSync(join(tmpdir(), "gitai-release-please-"));
  temps.push(tmp);
  return tmp;
}

afterEach(() => {
  for (const tmp of temps.splice(0)) {
    rmSync(tmp, { recursive: true, force: true });
  }
});

describe("detectReleasePlease", () => {
  it("returns an empty context when release-please is not configured", () => {
    expect(detectReleasePlease(tempRepo()).detected).toBe(false);
  });

  it("detects manifest and config files", () => {
    const repo = tempRepo();
    writeFileSync(join(repo, ".release-please-manifest.json"), "{}\n");
    writeFileSync(
      join(repo, "release-please-config.json"),
      JSON.stringify({
        packages: {
          "packages/cli": {
            "release-type": "node",
            "package-name": "cli",
            "changelog-types": [
              { type: "feat", section: "Features" },
              { type: "fix", section: "Bug Fixes" },
              { type: "chore", section: "Chores", hidden: true },
            ],
          },
        },
      }),
    );

    const context = detectReleasePlease(
      repo,
      "M\tpackages/cli/src/main.ts\nM\tREADME.md\n",
    );

    expect(context.detected).toBe(true);
    expect(context.sources).toEqual([
      "release-please-config.json",
      ".release-please-manifest.json",
    ]);
    expect(context.packagePaths).toEqual(["packages/cli"]);
    expect(context.releaseTypes).toEqual(["node"]);
    expect(context.changelogTypes).toEqual(["feat", "fix"]);
    expect(context.affectedPackages).toEqual(["cli"]);
  });

  it("detects release-please workflows", () => {
    const repo = tempRepo();
    const workflows = join(repo, ".github", "workflows");
    mkdirSync(workflows, { recursive: true });
    writeFileSync(
      join(workflows, "release.yml"),
      "steps:\n  - uses: googleapis/release-please-action@v4\n",
    );

    const context = detectReleasePlease(repo);

    expect(context.detected).toBe(true);
    expect(context.sources).toEqual([".github/workflows/release.yml"]);
  });

  it("treats a root release config as the root package", () => {
    const repo = tempRepo();
    writeFileSync(
      join(repo, "release-please-config.json"),
      JSON.stringify({ "release-type": "node", "package-name": "root-app" }),
    );

    const context = detectReleasePlease(repo, "M\tsrc/main.ts\n");

    expect(context.packagePaths).toEqual(["."]);
    expect(context.affectedPackages).toEqual(["root-app"]);
  });
});

describe("renderReleasePleasePrompt", () => {
  it("explains release-impact types without forcing releases", () => {
    const prompt = renderReleasePleasePrompt({
      detected: true,
      sources: ["--release-please"],
      packagePaths: [],
      releaseTypes: [],
      changelogTypes: [],
      affectedPackages: [],
    });

    expect(prompt).toContain("feat: user-visible new capability");
    expect(prompt).toContain("do not use feat/fix just to force a release");
    expect(prompt).toContain("BREAKING CHANGE footer");
  });
});
