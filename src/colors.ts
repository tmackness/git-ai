import pc from "picocolors";

let enabled = pc.isColorSupported;

export function setColorEnabled(value: boolean): void {
  enabled = value;
}

const wrap = (fn: (s: string) => string) => (s: string) => (enabled ? fn(s) : s);

export const c = {
  bold: wrap(pc.bold),
  dim: wrap(pc.dim),
  italic: wrap(pc.italic),
  red: wrap(pc.red),
  green: wrap(pc.green),
  yellow: wrap(pc.yellow),
  blue: wrap(pc.blue),
  cyan: wrap(pc.cyan),
  magenta: wrap(pc.magenta),
  gray: wrap(pc.gray),
};

export const sym = {
  check: "✓",
  cross: "✗",
  arrow: "›",
  bullet: "•",
  sparkle: "✦",
};
