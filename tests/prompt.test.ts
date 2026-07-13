import { describe, it, expect } from "vitest";
import { parseChoice, truncateToWidth } from "../src/prompt.js";

describe("parseChoice", () => {
  it("maps yes-aliases", () => {
    expect(parseChoice("")).toBe("yes");
    expect(parseChoice("y")).toBe("yes");
    expect(parseChoice("Y")).toBe("yes");
    expect(parseChoice("yes")).toBe("yes");
    expect(parseChoice(" YES \n")).toBe("yes");
  });

  it("maps no-aliases", () => {
    expect(parseChoice("n")).toBe("no");
    expect(parseChoice("No")).toBe("no");
  });

  it("maps edit-aliases", () => {
    expect(parseChoice("e")).toBe("edit");
    expect(parseChoice("edit")).toBe("edit");
  });

  it("maps regen-aliases", () => {
    expect(parseChoice("r")).toBe("regen");
    expect(parseChoice("regen")).toBe("regen");
    expect(parseChoice("regenerate")).toBe("regen");
    expect(parseChoice("try again")).toBe("regen");
  });

  it("maps instruct-aliases", () => {
    expect(parseChoice("i")).toBe("instruct");
    expect(parseChoice("instruct")).toBe("instruct");
    expect(parseChoice("instruction")).toBe("instruct");
  });

  it("returns unknown for anything else", () => {
    expect(parseChoice("maybe")).toBe("unknown");
    expect(parseChoice("xyz")).toBe("unknown");
  });
});

describe("truncateToWidth", () => {
  it("returns lines that fit unchanged", () => {
    expect(truncateToWidth("short", 10)).toBe("short");
    expect(truncateToWidth("exactly10!", 10)).toBe("exactly10!");
  });

  it("truncates long lines to the width with an ellipsis", () => {
    const out = truncateToWidth("a".repeat(100), 10);
    expect(out).toBe("a".repeat(9) + "…");
  });

  it("does not count ANSI codes toward the width", () => {
    const line = "\x1b[2mabcde\x1b[22m";
    expect(truncateToWidth(line, 5)).toBe(line);
  });

  it("keeps codes and appends a reset when truncating colored lines", () => {
    const line = "\x1b[2m" + "a".repeat(50) + "\x1b[22m";
    const out = truncateToWidth(line, 10);
    expect(out).toBe("\x1b[2m" + "a".repeat(9) + "…\x1b[0m");
  });
});
