import { describe, it, expect } from "vitest";
import { defaultEditor, resolveEditor } from "../src/editor.js";

describe("defaultEditor", () => {
  it("returns notepad on win32", () => {
    expect(defaultEditor("win32")).toBe("notepad");
  });

  it("returns vi on unix-like platforms", () => {
    expect(defaultEditor("darwin")).toBe("vi");
    expect(defaultEditor("linux")).toBe("vi");
    expect(defaultEditor("freebsd")).toBe("vi");
  });
});

describe("resolveEditor", () => {
  it("prefers GIT_EDITOR over VISUAL and EDITOR", () => {
    const r = resolveEditor({ GIT_EDITOR: "code --wait", VISUAL: "nano", EDITOR: "vim" }, "darwin");
    expect(r.cmd).toBe("code");
    expect(r.args).toEqual(["--wait"]);
  });

  it("falls back to VISUAL when GIT_EDITOR unset", () => {
    const r = resolveEditor({ VISUAL: "nano", EDITOR: "vim" }, "darwin");
    expect(r.cmd).toBe("nano");
    expect(r.args).toEqual([]);
  });

  it("falls back to EDITOR when GIT_EDITOR and VISUAL unset", () => {
    const r = resolveEditor({ EDITOR: "vim" }, "darwin");
    expect(r.cmd).toBe("vim");
  });

  it("falls back to platform default when no env var is set", () => {
    expect(resolveEditor({}, "darwin").cmd).toBe("vi");
    expect(resolveEditor({}, "win32").cmd).toBe("notepad");
  });

  it("splits a multi-word editor command into cmd and args", () => {
    const r = resolveEditor({ EDITOR: "subl -n -w" }, "darwin");
    expect(r.cmd).toBe("subl");
    expect(r.args).toEqual(["-n", "-w"]);
  });
});
