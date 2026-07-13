import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetupWizard } from "../src/setup.js";

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
    getStdout: () => stdoutChunks.join(""),
    getStderr: () => stderrChunks.join(""),
  };
}

describe("runSetupWizard", () => {
  it("saves the chosen model and API key", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-setup-"));
    const config = join(tmp, "config.json");
    const streams = captureStreams();

    try {
      const code = await runSetupWizard({
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: { GITAI_CONFIG: config },
        prompts: {
          selectMode: async (options) => options.find((option) => option.mode === "direct") ?? null,
          selectModel: async (options) =>
            options.find((option) => option.provider === "anthropic") ?? null,
          readText: async () => {
            throw new Error("should not read text");
          },
          readSecret: async () => "test-key",
        },
      });

      expect(code).toBe(0);
      expect(streams.getStdout()).toContain("anthropic:claude-3-5-haiku-latest");
      expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
        defaultModel: "anthropic:claude-3-5-haiku-latest",
        apiKeys: {
          ANTHROPIC_API_KEY: "test-key",
        },
        env: {},
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not require an API key for Ollama", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-setup-"));
    const config = join(tmp, "config.json");
    const streams = captureStreams();

    try {
      const code = await runSetupWizard({
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: { GITAI_CONFIG: config },
        prompts: {
          selectMode: async (options) => options.find((option) => option.mode === "direct") ?? null,
          selectModel: async (options) =>
            options.find((option) => option.provider === "ollama") ?? null,
          readText: async () => {
            throw new Error("should not read text");
          },
          readSecret: async () => {
            throw new Error("should not read a key");
          },
        },
      });

      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
        defaultModel: "ollama:llama3.2",
        apiKeys: {},
        env: {},
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects an empty API key", async () => {
    const streams = captureStreams();
    const code = await runSetupWizard({
      stdout: streams.stdout,
      stderr: streams.stderr,
      env: {},
      prompts: {
        selectMode: async (options) => options.find((option) => option.mode === "direct") ?? null,
        selectModel: async (options) =>
          options.find((option) => option.provider === "openai") ?? null,
        readText: async () => {
          throw new Error("should not read text");
        },
        readSecret: async () => "",
      },
    });

    expect(code).toBe(1);
    expect(streams.getStderr()).toMatch(/API key cannot be empty/);
  });

  it("saves Cloudflare AI Gateway settings", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-setup-"));
    const config = join(tmp, "config.json");
    const streams = captureStreams();

    try {
      const code = await runSetupWizard({
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: { GITAI_CONFIG: config },
        prompts: {
          selectMode: async (options) =>
            options.find((option) => option.mode === "cloudflare") ?? null,
          selectModel: async (options) =>
            options.find((option) => option.modelId === "cloudflare:openai/gpt-4o-mini") ?? null,
          readText: async (prompt) =>
            prompt.startsWith("CLOUDFLARE_ACCOUNT_ID") ? "account-123" : "my-gateway",
          readSecret: async () => "cf-token",
        },
      });

      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
        defaultModel: "cloudflare:openai/gpt-4o-mini",
        apiKeys: {
          CLOUDFLARE_AI_GATEWAY_API_KEY: "cf-token",
        },
        env: {
          CLOUDFLARE_ACCOUNT_ID: "account-123",
          CLOUDFLARE_AI_GATEWAY_ID: "my-gateway",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses Cloudflare setup values from env when present", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-setup-"));
    const config = join(tmp, "config.json");
    const streams = captureStreams();
    const confirmedKeys: string[] = [];

    try {
      const code = await runSetupWizard({
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: {
          GITAI_CONFIG: config,
          CLOUDFLARE_ACCOUNT_ID: "account-env",
          CLOUDFLARE_AI_GATEWAY_ID: "gateway-env",
          CLOUDFLARE_AI_GATEWAY_API_KEY: "token-env",
        },
        prompts: {
          selectMode: async (options) =>
            options.find((option) => option.mode === "cloudflare") ?? null,
          selectModel: async (options) =>
            options.find((option) => option.modelId === "cloudflare:openai/gpt-4o-mini") ?? null,
          confirmUseExisting: async (key) => {
            confirmedKeys.push(key);
            return true;
          },
          readText: async () => {
            throw new Error("should not read text");
          },
          readSecret: async () => {
            throw new Error("should not read a key");
          },
        },
      });

      expect(code).toBe(0);
      expect(confirmedKeys).toEqual([
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_AI_GATEWAY_ID",
        "CLOUDFLARE_AI_GATEWAY_API_KEY",
      ]);
      expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
        defaultModel: "cloudflare:openai/gpt-4o-mini",
        apiKeys: {
          CLOUDFLARE_AI_GATEWAY_API_KEY: "token-env",
        },
        env: {
          CLOUDFLARE_ACCOUNT_ID: "account-env",
          CLOUDFLARE_AI_GATEWAY_ID: "gateway-env",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("can replace an API key that is already set in env", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-setup-"));
    const config = join(tmp, "config.json");
    const streams = captureStreams();

    try {
      const code = await runSetupWizard({
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: {
          GITAI_CONFIG: config,
          ANTHROPIC_API_KEY: "old-key",
        },
        prompts: {
          selectMode: async (options) => options.find((option) => option.mode === "direct") ?? null,
          selectModel: async (options) =>
            options.find((option) => option.provider === "anthropic") ?? null,
          confirmUseExisting: async (key) => {
            expect(key).toBe("ANTHROPIC_API_KEY");
            return false;
          },
          readText: async () => {
            throw new Error("should not read text");
          },
          readSecret: async () => "new-key",
        },
      });

      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
        defaultModel: "anthropic:claude-3-5-haiku-latest",
        apiKeys: {
          ANTHROPIC_API_KEY: "new-key",
        },
        env: {},
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("can replace Cloudflare env vars that are already set", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gitai-setup-"));
    const config = join(tmp, "config.json");
    const streams = captureStreams();

    try {
      const code = await runSetupWizard({
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: {
          GITAI_CONFIG: config,
          CLOUDFLARE_ACCOUNT_ID: "account-old",
          CLOUDFLARE_AI_GATEWAY_ID: "gateway-old",
          CLOUDFLARE_AI_GATEWAY_API_KEY: "token-old",
        },
        prompts: {
          selectMode: async (options) =>
            options.find((option) => option.mode === "cloudflare") ?? null,
          selectModel: async (options) =>
            options.find((option) => option.modelId === "cloudflare:openai/gpt-4o-mini") ?? null,
          confirmUseExisting: async () => false,
          readText: async (prompt) =>
            prompt.startsWith("CLOUDFLARE_ACCOUNT_ID") ? "account-new" : "gateway-new",
          readSecret: async () => "token-new",
        },
      });

      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
        defaultModel: "cloudflare:openai/gpt-4o-mini",
        apiKeys: {
          CLOUDFLARE_AI_GATEWAY_API_KEY: "token-new",
        },
        env: {
          CLOUDFLARE_ACCOUNT_ID: "account-new",
          CLOUDFLARE_AI_GATEWAY_ID: "gateway-new",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
