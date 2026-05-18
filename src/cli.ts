#!/usr/bin/env node
import { main } from "./main.js";

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`gitai: error — ${msg}\n`);
    process.exit(1);
  },
);
