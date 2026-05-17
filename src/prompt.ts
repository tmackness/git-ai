import { createInterface } from "node:readline/promises";
import {
  createInterface as createInterfaceSync,
  emitKeypressEvents,
} from "node:readline";
import { c } from "./colors.js";

export type Choice = "yes" | "no" | "edit" | "regen" | "instruct" | "unknown";

export function parseChoice(input: string): Choice {
  const s = input.trim().toLowerCase();
  if (s === "" || s === "y" || s === "yes") return "yes";
  if (s === "n" || s === "no") return "no";
  if (s === "e" || s === "edit") return "edit";
  if (s === "r" || s === "regen" || s === "regenerate" || s === "try again") return "regen";
  if (s === "i" || s === "instruct" || s === "instruction") return "instruct";
  return "unknown";
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await ask(`${question} ${suffix} `)).toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

export async function selectFromList<T>(
  prompt: string,
  items: T[],
  render: (item: T, idx: number) => string,
): Promise<T | null> {
  return selectFromSections(
    prompt,
    [{ label: undefined, items }],
    render,
  );
}

export interface SelectSection<T> {
  label?: string;
  items: T[];
}

interface SelectRow<T> {
  type: "item";
  item: T;
  itemIndex: number;
  label?: string;
}

export async function selectFromSections<T>(
  prompt: string,
  sections: SelectSection<T>[],
  render: (item: T, idx: number) => string,
): Promise<T | null> {
  const rows = selectRows(sections);
  const items = rows.map((row) => row.item);
  if (items.length === 0) return null;
  const stdin = process.stdin;
  const stdout = process.stdout;
  const isTTY =
    Boolean(stdin.isTTY) &&
    Boolean(stdout.isTTY) &&
    typeof stdin.setRawMode === "function";

  if (isTTY) {
    return selectFromSectionsTTY(prompt, sections, render);
  }

  stdout.write(prompt + "\n");
  const width = rows.length.toString().length;
  let n = 1;
  for (const section of sections) {
    if (section.label) stdout.write(`${c.dim(section.label)}\n`);
    for (const item of section.items) {
      stdout.write(`  ${n.toString().padStart(width)}) ${render(item, n - 1)}\n`);
      n++;
    }
  }
  const ans = await ask(`\nChoice [1-${items.length}]: `);
  const selected = Number.parseInt(ans, 10);
  if (!Number.isFinite(selected) || selected < 1 || selected > items.length) return null;
  return items[selected - 1] ?? null;
}

function selectRows<T>(sections: SelectSection<T>[]): SelectRow<T>[] {
  const rows: SelectRow<T>[] = [];
  let itemIndex = 0;
  for (const section of sections) {
    for (const item of section.items) {
      rows.push({ type: "item", item, itemIndex, label: section.label });
      itemIndex++;
    }
  }
  return rows;
}

interface Keypress {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

async function selectFromSectionsTTY<T>(
  prompt: string,
  sections: SelectSection<T>[],
  render: (item: T, idx: number) => string,
): Promise<T | null> {
  const rows = selectRows(sections);
  const stdin = process.stdin;
  const stdout = process.stdout;
  let selected = 0;
  let renderedRows = 0;
  const wasRaw = stdin.isRaw;
  const visibleLimit = Math.max(
    6,
    Math.min(12, (stdout.rows ?? 24) - 6),
  );

  const visibleRange = () => {
    const half = Math.floor(visibleLimit / 2);
    let start = Math.max(0, selected - half);
    const end = Math.min(rows.length, start + visibleLimit);
    start = Math.max(0, end - visibleLimit);
    return { start, end };
  };

  const renderList = () => {
    if (renderedRows > 0) {
      stdout.write(`\x1b[${renderedRows}A\x1b[J`);
    }
    const lines = [prompt, c.dim("Use ↑/↓ and Enter to select.")];
    const { start, end } = visibleRange();
    if (start > 0) lines.push(c.dim(`… ${start} more above`));
    let lastLabel: string | undefined;
    for (let rowIdx = start; rowIdx < end; rowIdx++) {
      const row = rows[rowIdx]!;
      if (row.label && row.label !== lastLabel) {
        if (rowIdx > 0) lines.push(c.dim("─".repeat(24)));
        lines.push(c.dim(row.label));
        lastLabel = row.label;
      }
      const prefix = rowIdx === selected ? c.cyan("›") : " ";
      const content = render(row.item, row.itemIndex);
      lines.push(`${prefix} ${rowIdx === selected ? c.bold(content) : content}`);
    }
    if (end < rows.length) lines.push(c.dim(`… ${rows.length - end} more below`));
    stdout.write(lines.join("\n") + "\n");
    renderedRows = lines.length;
  };

  return new Promise<T | null>((resolve) => {
    const cleanup = () => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("keypress", onKeypress);
      stdout.write("\n");
    };
    const onKeypress = (_str: string, key: Keypress) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
      if (key.name === "up") {
        selected = selected === 0 ? rows.length - 1 : selected - 1;
        renderList();
        return;
      }
      if (key.name === "down") {
        selected = selected === rows.length - 1 ? 0 : selected + 1;
        renderList();
        return;
      }
      if (key.name === "return" || key.name === "enter" || key.sequence === "\r") {
        const item = rows[selected]?.item ?? null;
        cleanup();
        resolve(item);
      }
    };

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
    renderList();
  });
}

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(8);
const DEL = String.fromCharCode(127);

/**
 * Read a single line without echoing characters. Falls back to a plain
 * line read when stdin is not a TTY (e.g. piped input or CI).
 */
export async function readSecret(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  const stdin = process.stdin;
  const isTTY = Boolean(stdin.isTTY) && typeof stdin.setRawMode === "function";

  if (!isTTY) {
    return new Promise<string>((resolve) => {
      const rl = createInterfaceSync({ input: stdin });
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
    });
  }

  return new Promise<string>((resolve) => {
    let buf = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");
      for (const ch of str) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === DEL || ch === BACKSPACE) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        buf += ch;
        process.stdout.write("*");
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
