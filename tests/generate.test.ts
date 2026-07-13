import { beforeEach, describe, expect, it, vi } from "vitest";

const streamTextMock = vi.hoisted(() => vi.fn());
const streamCalls = vi.hoisted(() => [] as Array<{ system: string; prompt: string }>);
const modelFactory = vi.hoisted(() => (name: string) => () => ({
  provider: name,
  modelId: "test-model",
}));

function textStream(text: string) {
  return (async function* () {
    yield text;
  })();
}

vi.mock("ai", () => ({
  streamText: streamTextMock,
}));

vi.mock("@ai-sdk/openai", () => ({ openai: modelFactory("openai") }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: modelFactory("anthropic") }));
vi.mock("@ai-sdk/google", () => ({ google: modelFactory("google") }));
vi.mock("@ai-sdk/mistral", () => ({ mistral: modelFactory("mistral") }));
vi.mock("@ai-sdk/groq", () => ({ groq: modelFactory("groq") }));
vi.mock("@ai-sdk/xai", () => ({ xai: modelFactory("xai") }));
vi.mock("@ai-sdk/deepseek", () => ({ deepseek: modelFactory("deepseek") }));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => modelFactory("compatible"),
}));

function chunkWithDiffOfLength(path: string, length: number) {
  const header = `diff --git a/${path} b/${path}\n`;
  return {
    status: "M",
    path,
    diff: header + "+x".repeat(Math.ceil((length - header.length) / 2)),
  };
}

describe("generateMessage", () => {
  beforeEach(() => {
    streamCalls.length = 0;
    streamTextMock.mockImplementation((opts: { system: string; prompt: string }) => {
      streamCalls.push({ system: opts.system, prompt: opts.prompt });
      const text = opts.system.includes("summarize staged git diff chunks")
        ? "- src/foo.ts: adds foo behavior"
        : "feat(foo): add foo behavior";
      return {
        textStream: textStream(text),
        usage: Promise.resolve({ promptTokens: 100, completionTokens: 10, totalTokens: 110 }),
      };
    });
  });

  it("sends a small staged diff in a single request without summarization", async () => {
    const { generateMessage } = await import("../src/generate.js");

    const result = await generateMessage({
      modelId: "openai:gpt-4o-mini",
      diff: "",
      files: "M\tsrc/foo.ts",
      summary: " src/foo.ts | 1 +",
      diffChunks: [
        {
          status: "M",
          path: "src/foo.ts",
          diff: "diff --git a/src/foo.ts b/src/foo.ts\n+export const foo = 1;\n",
        },
      ],
    });

    expect(result.message).toBe("feat(foo): add foo behavior");
    expect(result.checklist).toBeUndefined();
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      requests: 1,
    });
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0]!.system).toContain("You write git commit messages");
    expect(streamCalls[0]!.prompt).toContain("+export const foo = 1;");
    expect(streamCalls[0]!.prompt).not.toContain("Intermediate staged-change checklist");
  });

  it("summarizes in batches when the staged diff exceeds the single-request budget", async () => {
    const { generateMessage } = await import("../src/generate.js");
    const progress: Array<[number, number]> = [];

    const result = await generateMessage({
      modelId: "openai:gpt-4o-mini",
      diff: "",
      files: "M\tsrc/a.ts\nM\tsrc/b.ts\nM\tsrc/c.ts",
      summary: " 3 files changed",
      diffChunks: [
        chunkWithDiffOfLength("src/a.ts", 40_000),
        chunkWithDiffOfLength("src/b.ts", 40_000),
        chunkWithDiffOfLength("src/c.ts", 40_000),
      ],
      onSummaryProgress: (done, total) => progress.push([done, total]),
    });

    expect(result.message).toBe("feat(foo): add foo behavior");
    expect(result.checklist).toContain("Batch 1:");
    expect(result.checklist).toContain("Batch 3:");
    expect(result.usage).toEqual({
      promptTokens: 400,
      completionTokens: 40,
      totalTokens: 440,
      requests: 4,
    });

    const summaryCalls = streamCalls.filter((call) =>
      call.system.includes("summarize staged git diff chunks"),
    );
    const finalCalls = streamCalls.filter((call) =>
      call.system.includes("You write git commit messages"),
    );
    expect(summaryCalls).toHaveLength(3);
    expect(finalCalls).toHaveLength(1);
    expect(finalCalls[0]!.prompt).toContain("Intermediate staged-change checklist");
    expect(finalCalls[0]!.prompt).toContain("adds foo behavior");
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("reuses a provided checklist instead of re-summarizing", async () => {
    const { generateMessage } = await import("../src/generate.js");

    const result = await generateMessage({
      modelId: "openai:gpt-4o-mini",
      diff: "",
      files: "M\tsrc/a.ts\nM\tsrc/b.ts\nM\tsrc/c.ts",
      summary: " 3 files changed",
      diffChunks: [
        chunkWithDiffOfLength("src/a.ts", 40_000),
        chunkWithDiffOfLength("src/b.ts", 40_000),
        chunkWithDiffOfLength("src/c.ts", 40_000),
      ],
      checklist: "Batch 1:\n- src/a.ts: cached checklist entry",
    });

    expect(result.message).toBe("feat(foo): add foo behavior");
    expect(result.checklist).toBe("Batch 1:\n- src/a.ts: cached checklist entry");
    expect(result.usage.requests).toBe(1);
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0]!.prompt).toContain("cached checklist entry");
  });

  it("reports zero tokens when the provider does not return usage", async () => {
    streamTextMock.mockImplementation((opts: { system: string; prompt: string }) => {
      streamCalls.push({ system: opts.system, prompt: opts.prompt });
      return {
        textStream: textStream("feat(foo): add foo behavior"),
        usage: Promise.resolve({
          promptTokens: Number.NaN,
          completionTokens: Number.NaN,
          totalTokens: Number.NaN,
        }),
      };
    });
    const { generateMessage } = await import("../src/generate.js");

    const result = await generateMessage({
      modelId: "openai:gpt-4o-mini",
      diff: "",
      files: "M\tsrc/foo.ts",
      diffChunks: [
        {
          status: "M",
          path: "src/foo.ts",
          diff: "diff --git a/src/foo.ts b/src/foo.ts\n+export const foo = 1;\n",
        },
      ],
    });

    expect(result.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 1,
    });
  });
});
