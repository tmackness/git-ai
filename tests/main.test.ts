import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main, prepareArgs } from "../src/main.js";

let configCounter = 0;

function captureStreams() {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      stdoutChunks.push(chunk.toString());
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      stderrChunks.push(chunk.toString());
      cb();
    },
  });
  return {
    stdout,
    stderr,
    env: { GITAI_CONFIG: join(tmpdir(), `gitai-main-${configCounter++}.json`) },
    getStdout: () => stdoutChunks.join(""),
    getStderr: () => stderrChunks.join(""),
  };
}

describe("main (paths that don't hit the network or git)", () => {
  it("treats bare -m as a model picker request", () => {
    expect(prepareArgs(["-m"])).toEqual({ args: [], selectModel: true });
    expect(prepareArgs(["--model", "--yes"])).toEqual({
      args: ["--yes"],
      selectModel: true,
    });
  });

  it("keeps explicit -m values as model ids", () => {
    expect(prepareArgs(["-m", "openai:gpt-4o-mini"])).toEqual({
      args: ["-m", "openai:gpt-4o-mini"],
      selectModel: false,
    });
  });

  it("--help prints usage and exits 0", async () => {
    const s = captureStreams();
    const code = await main(["--help"], { stdout: s.stdout, stderr: s.stderr, env: s.env });
    expect(code).toBe(0);
    expect(s.getStdout()).toContain("AI-generated git commits");
    expect(s.getStdout()).toContain("gitai [paths...]");
    expect(s.getStdout()).toContain("--release-please");
  });

  it("-h shorthand prints help", async () => {
    const s = captureStreams();
    const code = await main(["-h"], { stdout: s.stdout, stderr: s.stderr, env: s.env });
    expect(code).toBe(0);
    expect(s.getStdout()).toContain("gitai");
  });

  it("--version prints a semver-shaped string", async () => {
    const s = captureStreams();
    const code = await main(["--version"], { stdout: s.stdout, stderr: s.stderr, env: s.env });
    expect(code).toBe(0);
    expect(s.getStdout().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--providers lists every bundled provider", async () => {
    const s = captureStreams();
    const code = await main(["--providers"], { stdout: s.stdout, stderr: s.stderr, env: s.env });
    expect(code).toBe(0);
    const out = s.getStdout();
    for (const key of [
      "openai",
      "anthropic",
      "google",
      "groq",
      "deepseek",
      "kimi",
      "qwen",
      "ollama",
      "openrouter",
      "cloudflare",
    ]) {
      expect(out).toContain(key);
    }
  });

  it("exits non-zero with helpful message on unknown provider", async () => {
    const s = captureStreams();
    const code = await main(["-m", "nope:foo"], { stdout: s.stdout, stderr: s.stderr, env: s.env });
    expect(code).toBe(1);
    expect(s.getStderr()).toMatch(/unknown provider/);
  });

  it("exits non-zero when the required API key is missing", async () => {
    const s = captureStreams();
    const code = await main(["-m", "openai:gpt-4o-mini"], {
      stdout: s.stdout,
      stderr: s.stderr,
      env: s.env,
    });
    expect(code).toBe(1);
    expect(s.getStderr()).toMatch(/OPENAI_API_KEY is not set/);
  });

  it("uses GITAI_MODEL env var when -m is not provided", async () => {
    const s = captureStreams();
    const code = await main([], {
      stdout: s.stdout,
      stderr: s.stderr,
      env: {
        ...s.env,
        GITAI_MODEL: "anthropic:claude-3-5-haiku-latest",
      },
    });
    expect(code).toBe(1);
    expect(s.getStderr()).toMatch(/ANTHROPIC_API_KEY is not set/);
  });

  it("uses saved config model when neither -m nor GITAI_MODEL is provided", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-main-"));
    const config = join(tmp, "config.json");
    const s = captureStreams();
    writeFileSync(config, JSON.stringify({ defaultModel: "groq:llama-3.3-70b-versatile" }));

    try {
      const code = await main([], {
        stdout: s.stdout,
        stderr: s.stderr,
        env: { GITAI_CONFIG: config },
      });
      expect(code).toBe(1);
      expect(s.getStderr()).toMatch(/GROQ_API_KEY is not set/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses saved config API key when env var is not provided", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-main-"));
    const config = join(tmp, "gitai", "config.json");
    const originalCwd = process.cwd();
    const s = captureStreams();
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(
      config,
      JSON.stringify({
        apiKeys: {
          OPENAI_API_KEY: "saved-key",
        },
      }),
      { flag: "w" },
    );

    try {
      process.chdir(tmp);
      const code = await main([], {
        stdout: s.stdout,
        stderr: s.stderr,
        env: { GITAI_CONFIG: config },
      });
      expect(code).toBe(1);
      expect(s.getStderr()).toMatch(/not inside a git repository/);
    } finally {
      process.chdir(originalCwd);
      delete process.env.OPENAI_API_KEY;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("requires Cloudflare account id for Cloudflare AI Gateway models", async () => {
    const s = captureStreams();
    const code = await main(["-m", "cloudflare:openai/gpt-4o-mini"], {
      stdout: s.stdout,
      stderr: s.stderr,
      env: {
        ...s.env,
        CLOUDFLARE_AI_GATEWAY_API_KEY: "cf-token",
      },
    });

    expect(code).toBe(1);
    expect(s.getStderr()).toMatch(/CLOUDFLARE_ACCOUNT_ID is not set/);
  });

  it("uses saved Cloudflare config when env vars are not provided", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-main-"));
    const config = join(tmp, "gitai", "config.json");
    const originalCwd = process.cwd();
    const s = captureStreams();
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(
      config,
      JSON.stringify({
        defaultModel: "cloudflare:openai/gpt-4o-mini",
        apiKeys: {
          CLOUDFLARE_AI_GATEWAY_API_KEY: "cf-token",
        },
        env: {
          CLOUDFLARE_ACCOUNT_ID: "account-123",
          CLOUDFLARE_AI_GATEWAY_ID: "gateway-123",
        },
      }),
    );

    try {
      process.chdir(tmp);
      const code = await main([], {
        stdout: s.stdout,
        stderr: s.stderr,
        env: { GITAI_CONFIG: config },
      });
      expect(code).toBe(1);
      expect(s.getStderr()).toMatch(/not inside a git repository/);
    } finally {
      process.chdir(originalCwd);
      delete process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_AI_GATEWAY_ID;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unknown flags via parseArgs", async () => {
    const s = captureStreams();
    const code = await main(["--bogus"], { stdout: s.stdout, stderr: s.stderr, env: s.env });
    expect(code).toBe(1);
    expect(s.getStderr()).toMatch(/gitai:/);
  });

  it("rejects conflicting release-please flags", async () => {
    const s = captureStreams();
    const code = await main(["--release-please", "--no-release-please"], {
      stdout: s.stdout,
      stderr: s.stderr,
      env: s.env,
    });

    expect(code).toBe(1);
    expect(s.getStderr()).toMatch(/either --release-please or --no-release-please/);
  });
});
