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

describe("generateMessage", () => {
  beforeEach(() => {
    streamCalls.length = 0;
    streamTextMock.mockImplementation((opts: { system: string; prompt: string }) => {
      streamCalls.push({ system: opts.system, prompt: opts.prompt });
      const text =
        streamCalls.length === 1
          ? "- src/foo.ts: adds foo behavior"
          : "feat(foo): add foo behavior";
      return { textStream: textStream(text) };
    });
  });

  it("summarizes staged diff chunks before generating the final commit message", async () => {
    const { generateMessage } = await import("../src/generate.js");

    const message = await generateMessage({
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

    expect(message).toBe("feat(foo): add foo behavior");
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[0]!.system).toContain("summarize staged git diff chunks");
    expect(streamCalls[0]!.prompt).toContain("File: M src/foo.ts");
    expect(streamCalls[1]!.system).toContain("You write git commit messages");
    expect(streamCalls[1]!.prompt).toContain("Intermediate staged-change checklist");
    expect(streamCalls[1]!.prompt).toContain("adds foo behavior");
  });
});
