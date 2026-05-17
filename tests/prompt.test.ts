import { describe, it, expect } from "vitest";
import { parseChoice } from "../src/prompt.js";

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
  });

  it("returns unknown for anything else", () => {
    expect(parseChoice("maybe")).toBe("unknown");
    expect(parseChoice("xyz")).toBe("unknown");
  });
});
